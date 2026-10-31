#!/usr/bin/env node
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const http = require('http'), net = require('net'), crypto = require('crypto');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const DEFAULT_TARGETS = ['https://www.gstatic.com/generate_204', 'https://cp.cloudflare.com/generate_204'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
function classifyFailure(statusCode, message) {
  const t = String(message || '').toLowerCase();
  if (/timeout|timed out|deadline exceeded|context deadline/.test(t)) return 'timeout';
  if (/tls|x509|certificate|handshake/.test(t)) return 'tls_error';
  if (/auth|unauthorized|authentication|password|user name/.test(t)) return 'auth_error';
  if (/no such host|dns|lookup .* failed|name resolution/.test(t)) return 'dns_error';
  if (/connection refused|network is unreachable|no route to host|connection reset/.test(t)) return 'connect_error';
  if (statusCode >= 400) return 'http_error';
  return 'proxy_error';
}
function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
function wilsonLowerBound(successes, attempts, z = 1.96) {
  if (!attempts) return 0;
  const p = successes / attempts, z2 = z * z, n = attempts;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (center - margin) / denominator);
}
function medianAbsoluteDeviation(values, center = median(values)) {
  if (!values.length || center === null) return null;
  return median(values.map(value => Math.abs(value - center)));
}
function summarizeNode(proxy, samples) {
  const ok = samples.filter(x => x.ok), delays = ok.map(x => x.delayMs).filter(Number.isFinite);
  const attempts = samples.length, successes = ok.length;
  const rate = attempts ? successes / attempts : 0;
  const posteriorMean = attempts ? (successes + 1) / (attempts + 2) : 0;
  const confidenceLowerBound95 = wilsonLowerBound(successes, attempts);
  const latencyMs = median(delays);
  // MAD is robust to a single slow outlier; unlike max-min it does not let one spike dominate jitter.
  const jitterMs = delays.length > 1 ? medianAbsoluteDeviation(delays, latencyMs) : null;
  const targetNames = [...new Set(samples.map(x => x.target).filter(Boolean))];
  const successfulTargets = [...new Set(ok.map(x => x.target).filter(Boolean))];
  const targetCoverage = targetNames.length ? successfulTargets.length / targetNames.length : 0;
  const latencyComponent = latencyMs === null ? 0 : Math.exp(-latencyMs / 5000);
  const jitterComponent = jitterMs === null ? 0 : Math.exp(-jitterMs / 3000);
  const qualityBreakdown = {
    // Use the conservative 95% Wilson lower bound so small samples cannot earn near-perfect reliability points.
    reliability: Number((70 * confidenceLowerBound95).toFixed(2)),
    latency: Number((15 * latencyComponent).toFixed(2)),
    jitter: Number((10 * jitterComponent).toFixed(2)),
    targetCoverage: Number((5 * targetCoverage).toFixed(2))
  };
  const enoughEvidence = attempts >= 8;
  // Do not publish a numeric quality score when the minimum evidence threshold is not met.
  const qualityScore = enoughEvidence ? Math.round(Object.values(qualityBreakdown).reduce((sum, value) => sum + value, 0)) : null;
  const allTargetsPassed = targetNames.length >= 2 && targetCoverage === 1;
  let status = 'unreliable';
  if (!enoughEvidence) status = 'insufficient_data';
  else if (confidenceLowerBound95 >= 0.65 && allTargetsPassed) status = 'stable';
  else if (posteriorMean >= 0.6 && confidenceLowerBound95 >= 0.3 && allTargetsPassed) status = 'working';
  return {
    name: proxy.name, type: proxy.type, server: proxy.server, port: Number(proxy.port),
    attempts, successes, successRate: Number(rate.toFixed(3)),
    posteriorSuccessRate: Number(posteriorMean.toFixed(3)),
    confidenceLowerBound95: Number(confidenceLowerBound95.toFixed(3)),
    successfulTargets, targetCoverage: Number(targetCoverage.toFixed(3)),
    qualityScore, qualityBreakdown: enoughEvidence ? qualityBreakdown : null,
    latencyMs, latencyMinMs: delays.length ? Math.min(...delays) : null,
    latencyMaxMs: delays.length ? Math.max(...delays) : null, jitterMs,
    status,
    failures: samples.filter(x => !x.ok).map(x => x.failure),
    samples: samples.map(x => ({ round: x.round, target: x.target, ok: x.ok, delayMs: x.delayMs, failure: x.failure, statusCode: x.statusCode || null }))
  };
}
function requestJson(port, secret, requestPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET',
      headers: { Authorization: 'Bearer ' + secret } }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', c => { body += c; });
      res.on('end', () => {
        let obj = {}; try { obj = body ? JSON.parse(body) : {}; } catch (_) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const e = new Error('controller request failed'); e.statusCode = res.statusCode;
          e.safeMessage = String(obj.message || obj.error || ''); reject(e); return;
        }
        resolve(obj);
      });
    });
    req.setTimeout(timeoutMs + 1500, () => req.destroy(new Error('controller timeout')));
    req.on('error', reject); req.end();
  });
}
async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
  });
}
async function waitReady(port, secret, child) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Mihomo exited before controller became ready');
    try { const info = await requestJson(port, secret, '/version', 1000); return info.version || 'unknown'; }
    catch (_) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('Mihomo controller startup timed out');
}
async function probeOne(proxy, port, secret, opts) {
  const samples = [];
  for (let round = 0; round < opts.rounds; round++) {
    for (const target of opts.targets) {
      const apiPath = '/proxies/' + encodeURIComponent(proxy.name) + '/delay?url=' +
        encodeURIComponent(target) + '&timeout=' + opts.timeoutMs + '&expected=204';
      try {
        const result = await requestJson(port, secret, apiPath, opts.timeoutMs);
        const delay = Number(result.delay);
        samples.push(Number.isFinite(delay) && delay >= 0 ? { ok: true, delayMs: delay, target, round: round + 1 } : { ok: false, failure: 'http_error', target, round: round + 1 });
      } catch (e) {
        samples.push({ ok: false, failure: classifyFailure(e.statusCode, e.safeMessage || e.message), statusCode: e.statusCode || null, target, round: round + 1 });
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return summarizeNode(proxy, samples);
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  async function worker() {
    while (true) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const input = path.resolve(a.input || 'artifacts/subs/mihomo.yaml');
  const outputDir = path.resolve(a['output-dir'] || 'artifacts/health/cloud');
  const binArg = a['mihomo-bin'] || process.env.MIHOMO_BIN;
  const bin = binArg ? path.resolve(binArg) : '';
  if (!bin || !fs.existsSync(bin)) throw new Error('Mihomo binary missing; set --mihomo-bin or MIHOMO_BIN');
  if (!fs.existsSync(input)) throw new Error('Input subscription not found: ' + input);
  const doc = yaml.load(fs.readFileSync(input, 'utf8')) || {};
  const sourceProxies = Array.isArray(doc.proxies) ? doc.proxies.filter(p => p && p.name && p.server && p.port) : [];
  const limit = Math.max(0, Number(a.limit || 0));
  const proxies = limit > 0 ? sourceProxies.slice(0, limit) : sourceProxies;
  if (!proxies.length) throw new Error('No valid proxies in input subscription');
  const opts = {
    timeoutMs: Math.max(2000, Number(a.timeout || 8000)),
    rounds: Math.max(1, Math.min(4, Number(a.rounds || 4))),
    concurrency: Math.max(1, Math.min(50, Number(a.concurrency || 20))),
    targets: a.targets ? String(a.targets).split(',').filter(Boolean) : DEFAULT_TARGETS
  };
  if (opts.targets.length < 2) throw new Error('At least two independent probe targets are required');
  const port = await reservePort(), secret = crypto.randomBytes(24).toString('hex');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asfn-probe-'));
  const configPath = path.join(temp, 'config.yaml');
  const config = {
    'allow-lan': false, 'bind-address': '127.0.0.1', mode: 'rule', 'log-level': 'silent',
    'external-controller': '127.0.0.1:' + port, secret, proxies
  };
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true }), { mode: 0o600 });
  let child;
  try {
    child = spawn(bin, ['-d', temp, '-f', configPath], { cwd: temp, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => {});
    const mihomoVersion = await waitReady(port, secret, child);
    const startedAt = new Date().toISOString(); let completed = 0;
    const results = await mapLimit(proxies, opts.concurrency, async p => {
      const result = await probeOne(p, port, secret, opts); completed++;
      if (completed % 50 === 0 || completed === proxies.length) process.stdout.write('[Probe] ' + completed + '/' + proxies.length + '\r');
      return result;
    });
    process.stdout.write('\n');
    const working = results.filter(x => x.status === 'working' || x.status === 'stable');
    const stable = results.filter(x => x.status === 'stable');
    const unreliable = results.filter(x => x.status === 'unreliable');
    const insufficientData = results.filter(x => x.status === 'insufficient_data');
    const qualityScores = results.map(x => x.qualityScore).filter(Number.isFinite);
    fs.mkdirSync(outputDir, { recursive: true });
    const failureCounts = {};
    for (const node of results) for (const failure of node.failures) failureCounts[failure] = (failureCounts[failure] || 0) + 1;
    const statusCounts = { stable: stable.length, working: working.length - stable.length, unreliable: unreliable.length, insufficient_data: insufficientData.length };
    const report = {
      schemaVersion: 2, mode: a.mode || 'cloud', startedAt, completedAt: new Date().toISOString(),
      mihomoVersion, source: path.basename(input),
      qualityModel: {
        name: 'asfn-health-quality-v2', range: '0-100',
        formula: '70*Wilson95LowerBound(successes,attempts) + 15*exp(-medianLatencyMs/5000) + 10*exp(-MADLatencyMs/3000) + 5*(successfulTargets/configuredTargets)',
        confidence: 'Two-sided 95% Wilson lower bound (z=1.96); repeated target requests may be correlated, so treat as a conservative evidence score, not a formal SLA guarantee',
        dispersion: 'Median absolute deviation (MAD) of successful latency samples; robust to isolated latency spikes',
        minimumAttemptsForClassification: 8,
        stableRule: 'Wilson lower bound >= 0.65 and every configured target succeeded at least once',
        workingRule: 'Beta-smoothed success rate >= 0.60, Wilson lower bound >= 0.30, and every configured target succeeded at least once'
      },
      probe: { targets: opts.targets, rounds: opts.rounds, attemptsPerNode: opts.targets.length * opts.rounds,
        timeoutMs: opts.timeoutMs, concurrency: opts.concurrency, minimumAttemptsForClassification: 8,
        confidenceLevel: 0.95, stableWilsonLowerBound: 0.65, workingPosteriorSuccessRate: 0.6, workingWilsonLowerBound: 0.3 },
      summary: {
        inputTotal: sourceProxies.length, tested: results.length, total: results.length,
        working: working.length, stable: stable.length, unreliable: unreliable.length, insufficientData: insufficientData.length,
        meanNodeSuccessRate: Number((results.reduce((sum, x) => sum + x.successRate, 0) / results.length).toFixed(3)),
        scoredNodes: qualityScores.length,
        meanQualityScore: qualityScores.length ? Number((qualityScores.reduce((sum, x) => sum + x, 0) / qualityScores.length).toFixed(1)) : null,
        medianQualityScore: median(qualityScores), statusCounts, failureCounts
      },
      nodes: results
    };
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const workingNames = new Set(working.map(x => x.name)), stableNames = new Set(stable.map(x => x.name));
    fs.writeFileSync(path.join(outputDir, 'working.yaml'), yaml.dump({ proxies: proxies.filter(p => workingNames.has(p.name)) }, { lineWidth: -1, noRefs: true }));
    fs.writeFileSync(path.join(outputDir, 'stable.yaml'), yaml.dump({ proxies: proxies.filter(p => stableNames.has(p.name)) }, { lineWidth: -1, noRefs: true }));
    console.log('[Probe] ' + report.mode + ': total=' + results.length + ', working=' + working.length + ', stable=' + stable.length);
    console.log('[Probe] Results: ' + outputDir);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise(resolve => { const t = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (require.main === module) main().catch(e => { console.error('[Probe] Failed: ' + e.message); process.exitCode = 1; });
module.exports = { classifyFailure, median, medianAbsoluteDeviation, wilsonLowerBound, summarizeNode, mapLimit };
