#!/usr/bin/env node
/**
 * Post-release validation: verifies artifacts/subs/all.yaml (published file)
 * - All VMess have alterId
 * - No invalid auth values (null/None/empty strings)
 * - No metadata field leakage
 * - YAML parses cleanly
 * - Node stats (kept / rejected / rejection reasons)
 * Run: node validate-released.js
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const scraper = require('./scraper');

const ALL_YAML = path.join(__dirname, 'artifacts', 'subs', 'all.yaml');
const MIHOMO_YAML = path.join(__dirname, 'artifacts', 'subs', 'mihomo.yaml');

let errors = [];
let warnings = [];

// ---------- all.yaml ----------
console.log('=== Validating ' + ALL_YAML + ' ===');
const allRaw = fs.readFileSync(ALL_YAML, 'utf8');
let doc;
try {
  doc = yaml.load(allRaw);
} catch (e) {
  console.error('FATAL: all.yaml YAML parse error:', e.message);
  process.exit(1);
}

if (!doc || !Array.isArray(doc.proxies)) {
  console.error('FATAL: all.yaml has no proxies array');
  process.exit(1);
}

const proxies = doc.proxies;
console.log('Total proxies in all.yaml:', proxies.length);

// --- Check 0: exact standard-Clash type set (SOCKS5 is socks5, HTTPS is http+tls) ---
const STANDARD_CLASH_TYPES = new Set(['ss', 'vmess', 'trojan', 'http', 'socks5']);
const invalidTypes = proxies.filter(p => !STANDARD_CLASH_TYPES.has(p.type));
if (invalidTypes.length > 0) {
  errors.push('all.yaml: unsupported proxy types: ' + [...new Set(invalidTypes.map(p => p.type))].join(', '));
} else {
  console.log('✓ all.yaml contains only standard Clash proxy types');
}


// Count by type
const byType = {};
for (const p of proxies) byType[p.type] = (byType[p.type] || 0) + 1;
console.log('By type:', JSON.stringify(byType, null, 2));

// --- Check 1: all VMess have alterId ---
const vmessMissingAlterId = proxies.filter(p => p.type === 'vmess' && (p.alterId === undefined || p.alterId === null || p.alterId === ''));
if (vmessMissingAlterId.length > 0) {
  errors.push('all.yaml: ' + vmessMissingAlterId.length + ' VMess proxies missing alterId: ' + vmessMissingAlterId.slice(0, 5).map(p => p.name).join(', '));
} else {
  console.log('✓ All ' + (byType['vmess'] || 0) + ' VMess proxies have alterId');
}

// --- Check 2: no invalid auth values ---
const invalidAuth = [];
for (const p of proxies) {
  for (const f of ['password', 'username']) {
    if (p[f] !== undefined) {
      const s = String(p[f]).trim().toLowerCase();
      if (['null', 'none', 'undefined', ''].includes(s)) {
        invalidAuth.push({ name: p.name, field: f, value: p[f] });
      }
    }
  }
}
if (invalidAuth.length > 0) {
  errors.push('all.yaml: ' + invalidAuth.length + ' proxies with invalid auth values, e.g.: ' + JSON.stringify(invalidAuth.slice(0, 3)));
} else {
  console.log('✓ No invalid auth values (null/None/empty) in all.yaml');
}

// --- Check 3: no metadata leakage ---
const META_FIELDS = ['_region', 'speed', 'latency', 'qualityScore', 'fraudScore', 'detectLevel', '_orig'];
const metaLeak = proxies.filter(p => META_FIELDS.some(f => p[f] !== undefined));
if (metaLeak.length > 0) {
  errors.push('all.yaml: ' + metaLeak.length + ' proxies with metadata field leakage: ' + metaLeak.slice(0, 3).map(p => p.name + '[' + META_FIELDS.find(f => p[f] !== undefined) + ']').join(', '));
} else {
  console.log('✓ No metadata fields leaked to all.yaml');
}

// --- Check 4: VMess required fields (uuid, server, port) ---
const vmessIncomplete = proxies.filter(p => p.type === 'vmess' && (!p.uuid || !p.server || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535));
if (vmessIncomplete.length > 0) {
  errors.push('all.yaml: ' + vmessIncomplete.length + ' VMess proxies missing uuid/server/valid port');
} else {
  console.log('✓ All VMess proxies have valid uuid/server/port');
}

// --- Check 5: SS/Trojan have password ---
const ssNoPass = proxies.filter(p => p.type === 'ss' && !p.password);
const trojanNoPass = proxies.filter(p => p.type === 'trojan' && !p.password);
if (ssNoPass.length > 0) errors.push('all.yaml: ' + ssNoPass.length + ' SS proxies without password');
if (trojanNoPass.length > 0) errors.push('all.yaml: ' + trojanNoPass.length + ' Trojan proxies without password');
console.log('✓ SS (' + ssNoPass.length + ') / Trojan (' + trojanNoPass.length + ') missing password (should be 0)');

// ---------- mihomo.yaml (spot check) ----------
console.log('\n=== Spot-checking ' + MIHOMO_YAML + ' ===');
const mihomoRaw = fs.readFileSync(MIHOMO_YAML, 'utf8');
const mihomoDoc = yaml.load(mihomoRaw);
if (!mihomoDoc?.proxies) {
  errors.push('mihomo.yaml: no proxies array');
} else {
  const mVmess = mihomoDoc.proxies.filter(p => p.type === 'vmess');
  const INVALID_MI_TYPES = mihomoDoc.proxies.filter(p => p.type === 'socks' || p.type === 'https');
  if (INVALID_MI_TYPES.length > 0) errors.push('mihomo.yaml: non-canonical proxy types socks/https found: ' + INVALID_MI_TYPES.length);
  else console.log('✓ mihomo.yaml: no non-canonical socks/https proxy types');
  const mMissing = mVmess.filter(p => p.alterId === undefined || p.alterId === null);
  if (mMissing.length > 0) {
    errors.push('mihomo.yaml: ' + mMissing.length + ' VMess missing alterId');
  } else {
    console.log('✓ mihomo.yaml: all ' + mVmess.length + ' VMess have alterId (' + mihomoDoc.proxies.length + ' total proxies)');
  }
  const mMetaLeak = mihomoDoc.proxies.filter(p => META_FIELDS.some(f => p[f] !== undefined));
  if (mMetaLeak.length > 0) {
    errors.push('mihomo.yaml: ' + mMetaLeak.length + ' proxies with metadata leakage');
  } else {
    console.log('✓ mihomo.yaml: no metadata leakage');
  }
}

// ---------- Summary ----------
console.log('\n' + '='.repeat(60));
if (errors.length > 0) {
  console.log('VALIDATION FAILED:');
  for (const e of errors) console.log('  ✗ ' + e);
  process.exit(1);
} else {
  console.log('VALIDATION PASSED: all checks OK ✓');
}

// ---------- Node stats (compare baseline hash) ----------
const baselineFile = path.join(__dirname, 'baseline-subs-hash.json');
if (fs.existsSync(baselineFile)) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const crypto = require('crypto');
  const current = {};
  for (const f of ['all.yaml', 'mihomo.yaml', 'base64.txt', 'byxiaoxi.txt', 'kooker.jp.txt']) {
    const p = path.join(__dirname, 'artifacts', 'subs', f);
    if (fs.existsSync(p)) current[f] = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  }
  console.log('\n=== File change vs baseline ===');
  for (const [f, h] of Object.entries(current)) {
    const changed = baseline[f] !== h;
    console.log('  ' + (changed ? '✓ CHANGED ' : '  same    ') + f + ': ' + h + (baseline[f] ? ' (was ' + baseline[f].substring(0, 8) + '...)' : ''));
  }
}
