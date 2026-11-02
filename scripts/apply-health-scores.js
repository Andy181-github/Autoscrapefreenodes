#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_YAML_FILES = [
  'artifacts/subs/mihomo.yaml',
  'artifacts/subs/all.yaml',
  'artifacts/health/cloud/working.yaml',
  'artifacts/health/cloud/stable.yaml',
  'artifacts/health/cloud/quality.yaml'
];
const DEFAULT_TEXT_FILES = [
  'artifacts/subs/base64.txt',
  'artifacts/subs/byxiaoxi.txt',
  'artifacts/subs/kooker.jp.txt'
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function stripScoreSuffix(name) {
  return String(name || 'proxy').replace(/(?:\|Q(?:\d{1,3}|\?))+$/i, '');
}

function scoreToken(result) {
  const score = result && result.qualityScore;
  return Number.isInteger(score) && score >= 0 && score <= 100 ? String(score) : '?';
}

function makeScoredName(name, result, used = new Set(), maxLength = 64) {
  const base = stripScoreSuffix(name) || 'proxy';
  const suffix = '|Q' + scoreToken(result);
  const points = Array.from(base);
  let candidate = points.slice(0, Math.max(1, maxLength - Array.from(suffix).length)).join('').trim() + suffix;
  let duplicate = 2;
  while (used.has(candidate)) {
    const tail = '-' + duplicate++;
    candidate = points.slice(0, Math.max(1, maxLength - Array.from(suffix + tail).length)).join('').trim() + suffix + tail;
  }
  used.add(candidate);
  return candidate;
}

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function identityKey(type, server, port) {
  if (!type || !server || !Number.isFinite(Number(port))) return null;
  return [String(type).toLowerCase(), normalizeHost(server), Number(port)].join('\u0000');
}

function createReportIndex(report) {
  if (!report || !Array.isArray(report.nodes) || report.nodes.length === 0) {
    throw new Error('Health report must contain a non-empty nodes array');
  }
  const byName = new Map();
  const byIdentity = new Map();
  for (const node of report.nodes) {
    if (node && node.name) byName.set(stripScoreSuffix(node.name), node);
    const key = node && identityKey(node.type, node.server, node.port);
    if (!key) continue;
    if (byIdentity.has(key)) byIdentity.set(key, null);
    else byIdentity.set(key, node);
  }
  return { byName, byIdentity };
}

function resolveResult(index, proxy, name) {
  const named = index.byName.get(stripScoreSuffix(name));
  if (named) return named;
  const key = identityKey(proxy && proxy.type, proxy && proxy.server, proxy && proxy.port);
  return key && index.byIdentity.get(key) || null;
}

function writeAtomic(filePath, content) {
  const tempPath = filePath + '.score-' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}

function sortRanked(entries) {
  return entries.sort((a, b) => {
    const scoreA = Number.isInteger(a.result && a.result.qualityScore) ? a.result.qualityScore : -1;
    const scoreB = Number.isInteger(b.result && b.result.qualityScore) ? b.result.qualityScore : -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const latencyA = Number.isFinite(a.result && a.result.latencyMs) ? a.result.latencyMs : Number.POSITIVE_INFINITY;
    const latencyB = Number.isFinite(b.result && b.result.latencyMs) ? b.result.latencyMs : Number.POSITIVE_INFINITY;
    return latencyA - latencyB || a.index - b.index;
  });
}

function annotateYamlFile(filePath, index) {
  const doc = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!doc || !Array.isArray(doc.proxies)) throw new Error(filePath + ': expected a proxies array');

  const used = new Set();
  const renameMap = new Map();
  const ranked = doc.proxies.map((proxy, i) => {
    if (!proxy || typeof proxy !== 'object') throw new Error(filePath + ': invalid proxy at index ' + i);
    const oldName = String(proxy.name || 'proxy');
    const result = resolveResult(index, proxy, oldName);
    const newName = makeScoredName(oldName, result, used);
    renameMap.set(oldName, newName);
    proxy.name = newName;
    return { proxy, result, index: i };
  });

  // Mihomo proxy-groups reference proxy names; update references in the same transaction.
  if (Array.isArray(doc['proxy-groups'])) {
    for (const group of doc['proxy-groups']) {
      if (group && Array.isArray(group.proxies)) {
        group.proxies = group.proxies.map(name => renameMap.get(name) || name);
      }
    }
  }

  doc.proxies = sortRanked(ranked).map(entry => entry.proxy);
  writeAtomic(filePath, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
  return { file: filePath, nodes: doc.proxies.length, scored: ranked.filter(x => Number.isInteger(x.result && x.result.qualityScore)).length };
}

function parseUriLine(line) {
  const schemeEnd = line.indexOf('://');
  if (schemeEnd <= 0) return null;
  const scheme = line.slice(0, schemeEnd).toLowerCase();

  if (scheme === 'vmess') {
    const hashIndex = line.lastIndexOf('#');
    const payload = line.slice(schemeEnd + 3, hashIndex >= 0 ? hashIndex : undefined);
    try {
      const obj = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      const name = obj.ps || (hashIndex >= 0 ? decodeURIComponent(line.slice(hashIndex + 1)) : '');
      return {
        name,
        type: 'vmess',
        server: obj.add,
        port: Number(obj.port || 443),
        rewrite: nextName => 'vmess://' + Buffer.from(JSON.stringify({ ...obj, ps: nextName })).toString('base64') +
          (hashIndex >= 0 ? '#' + encodeURIComponent(nextName) : '')
      };
    } catch (_) { return null; }
  }

  try {
    const parsed = new URL(line);
    let name = '';
    if (parsed.hash) {
      try { name = decodeURIComponent(parsed.hash.slice(1)); }
      catch (_) { name = parsed.hash.slice(1); }
    }
    const typeMap = { https: 'http', socks: 'socks5' };
    const type = typeMap[scheme] || scheme;
    const defaultPorts = { http: 80, https: 443, ss: 8388, socks5: 1080, trojan: 443, vless: 443, hysteria: 443, hysteria2: 443, tuic: 443 };
    const port = Number(parsed.port || defaultPorts[scheme] || 0);
    const hashIndex = line.lastIndexOf('#');
    const prefix = line.slice(0, hashIndex >= 0 ? hashIndex : line.length);
    return {
      name, type, server: parsed.hostname, port,
      rewrite: nextName => prefix + '#' + encodeURIComponent(nextName)
    };
  } catch (_) { return null; }
}

function annotateTextFile(filePath, index) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /(?:\r\n|\n)$/.test(raw);
  const lines = raw.split(/\r\n|\n/);
  if (trailingNewline) lines.pop();
  let changed = 0;
  const used = new Set();

  const rewritten = lines.map(line => {
    if (!line.trim()) return line;
    const parsed = parseUriLine(line.trim());
    if (!parsed) return line;
    const result = resolveResult(index, parsed, parsed.name);
    const nextName = makeScoredName(parsed.name || 'proxy', result, used);
    if (nextName === parsed.name) return line;
    changed++;
    return parsed.rewrite(nextName);
  }).join(eol) + (trailingNewline ? eol : '');

  if (changed > 0) writeAtomic(filePath, rewritten);
  return { file: filePath, changed };
}

function applyHealthScores(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const reportPath = path.resolve(root, options.report || 'artifacts/health/cloud/report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const index = createReportIndex(report);
  const yamlFiles = options.yamlFiles || DEFAULT_YAML_FILES;
  const textFiles = options.textFiles || DEFAULT_TEXT_FILES;
  const results = [];

  for (const relativePath of yamlFiles) {
    const filePath = path.resolve(root, relativePath);
    if (!fs.existsSync(filePath)) {
      if (relativePath === 'artifacts/subs/mihomo.yaml' || relativePath === 'artifacts/subs/all.yaml') {
        throw new Error('Required subscription file missing: ' + filePath);
      }
      continue;
    }
    results.push(annotateYamlFile(filePath, index));
  }
  for (const relativePath of textFiles) {
    const filePath = path.resolve(root, relativePath);
    if (fs.existsSync(filePath)) results.push(annotateTextFile(filePath, index));
  }
  return results;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const results = applyHealthScores({ report: args.report || 'artifacts/health/cloud/report.json' });
    for (const result of results) console.log('[ScoreLabel] ' + JSON.stringify(result));
    console.log('[ScoreLabel] Naming rule: |Q0..100 = measured health score; |Q? = insufficient or unmatched evidence.');
  } catch (error) {
    console.error('[ScoreLabel] Failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  stripScoreSuffix, scoreToken, makeScoredName, createReportIndex,
  resolveResult, annotateYamlFile, annotateTextFile, applyHealthScores
};
