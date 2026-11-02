'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const scraper = require('./scraper');
const probe = require('./scripts/probe-nodes');
const labels = require('./scripts/apply-health-scores');

function testCandidateFilters() {
  const base = { _region: 'us', fraudScore: 0, latency: 0 };
  assert.strictEqual(scraper.getCandidateRejectionReason(base), null, 'legacy latency=0 is not a measured zero-ms result');
  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, latency: 9000 }), null, 'unmeasured legacy latency field is ignored');
  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, probeLatencyMs: 9000 }), 'latency_exceeded');
  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, fraudScore: 45 }), 'fraud_score_exceeded');
  assert.strictEqual(scraper.getCandidateRejectionReason({ _region: 'us' }), 'fraud_score_unknown');
  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, _region: 'unknown' }), 'unknown_region');
  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, _region: 'cloud' }), 'cloud_region');
  assert.strictEqual(scraper.isCandidateEligible(base), true);
  assert.strictEqual(scraper.isCandidateEligible({ ...base, probeLatencyMs: 6000 }), false);  assert.strictEqual(scraper.getCandidateRejectionReason({ ...base, fraudScore: -1 }), 'fraud_score_invalid');
  const used = new Set();
  const first = labels.makeScoredName('same-name', { qualityScore: 88 }, used);
  const second = labels.makeScoredName('same-name', { qualityScore: 88 }, used);
  assert.notStrictEqual(first, second, 'duplicate scored names must remain unique');
  assert.ok(Array.from(labels.makeScoredName('x'.repeat(100), { qualityScore: 100 })).length <= 64, 'scored name must respect the 64-code-point cap');
}

async function testFraudScoreCoversDomains() {
  const nodes = [
    { name: 'normal-node', type: 'ss', server: '1.1.1.1', port: 8388, _region: 'us' },
    { name: 'vpn-endpoint', type: 'trojan', server: 'vpn.example.invalid', port: 443, _region: 'jp' }
  ];
  await scraper.batchGeoCheck(nodes);
  assert.strictEqual(nodes[0].fraudScore, 0);
  assert.ok(nodes[1].fraudScore >= 15, 'domain node should receive the local name heuristic score');
}

function testQualityTierSelection() {
  const results = [
    { name: 'low', status: 'working', qualityScore: 59, latencyMs: 100 },
    { name: 'pass', status: 'working', qualityScore: 60, latencyMs: 120 },
    { name: 'stable', status: 'stable', qualityScore: 91, latencyMs: 80 },
    { name: 'bad', status: 'unreliable', qualityScore: 88, latencyMs: 60 },
    { name: 'unknown', status: 'insufficient_data', qualityScore: null, latencyMs: null }
  ];
  assert.deepStrictEqual(probe.selectQualityNodes(results, 60).map(x => x.name), ['pass', 'stable']);
  assert.deepStrictEqual(probe.sortByQuality(results).slice(0, 2).map(x => x.name), ['stable', 'bad']);  const tier = probe.selectTierProxies([{ name: 'low' }, { name: 'stable' }, { name: 'pass' }], probe.selectQualityNodes(results, 60));
  assert.deepStrictEqual(tier.map(x => x.name), ['stable', 'pass'], 'quality tier output is score-sorted and filtered');
  assert.strictEqual(probe.selectQualityNodes(results, 92).length, 0);
}

function testScoreNamesAndYamlReferences() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asfn-score-'));
  try {
    const report = {
      nodes: [
        { name: 'node-a', type: 'vless', server: 'a.example', port: 443, qualityScore: 92, status: 'stable', latencyMs: 80 },
        { name: 'node-b', type: 'trojan', server: 'b.example', port: 443, qualityScore: null, status: 'insufficient_data', latencyMs: null },
        { name: 'node-c', type: 'vmess', server: 'c.example', port: 443, qualityScore: 67, status: 'working', latencyMs: 150 }
      ]
    };
    const reportPath = path.join(temp, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report));

    const mihomoPath = path.join(temp, 'mihomo.yaml');
    fs.writeFileSync(mihomoPath, yaml.dump({
      proxies: [
        { name: 'node-b', type: 'trojan', server: 'b.example', port: 443, password: 'p' },
        { name: 'node-a', type: 'vless', server: 'a.example', port: 443, uuid: 'u' }
      ],
      'proxy-groups': [{ name: 'auto', type: 'select', proxies: ['node-a', 'node-b'] }]
    }));
    const allPath = path.join(temp, 'all.yaml');
    fs.writeFileSync(allPath, yaml.dump({ proxies: [
      { name: 'node-c', type: 'vmess', server: 'c.example', port: 443, uuid: 'u', alterId: 0, cipher: 'auto' }
    ] }));

    const vmess = 'vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'node-c', add: 'c.example', port: '443', id: 'u', aid: 0 })).toString('base64');
    const uriPath = path.join(temp, 'base64.txt');
    fs.writeFileSync(uriPath, 'vless://u@a.example:443?security=tls#node-a\n' +
      'trojan://p@b.example:443#custom-b\n' + vmess + '\n');

    labels.applyHealthScores({
      root: temp, report: 'report.json',
      yamlFiles: ['mihomo.yaml', 'all.yaml'],
      textFiles: ['base64.txt']
    });

    const mihomo = yaml.load(fs.readFileSync(mihomoPath, 'utf8'));
    assert.deepStrictEqual(mihomo.proxies.map(p => p.name), ['node-a|Q92', 'node-b|Q?']);
    assert.deepStrictEqual(mihomo['proxy-groups'][0].proxies, ['node-a|Q92', 'node-b|Q?']);
    const all = yaml.load(fs.readFileSync(allPath, 'utf8'));
    assert.strictEqual(all.proxies[0].name, 'node-c|Q67');

    const lines = fs.readFileSync(uriPath, 'utf8').trim().split(/\r?\n/);
    const vless = new URL(lines[0]);
    assert.strictEqual(decodeURIComponent(vless.hash.slice(1)), 'node-a|Q92');
    const trojan = new URL(lines[1]);
    assert.strictEqual(decodeURIComponent(trojan.hash.slice(1)), 'custom-b|Q?');
    const vmessPayload = JSON.parse(Buffer.from(lines[2].slice('vmess://'.length), 'base64').toString('utf8'));
    assert.strictEqual(vmessPayload.ps, 'node-c|Q67');

    const firstPass = fs.readFileSync(mihomoPath, 'utf8');
    const uriFirstPass = fs.readFileSync(uriPath, 'utf8');
    labels.applyHealthScores({
      root: temp, report: 'report.json',
      yamlFiles: ['mihomo.yaml', 'all.yaml'],
      textFiles: ['base64.txt']
    });
    assert.strictEqual(fs.readFileSync(mihomoPath, 'utf8'), firstPass, 'YAML score suffixing must be idempotent');
    assert.strictEqual(fs.readFileSync(uriPath, 'utf8'), uriFirstPass, 'URI score suffixing must be idempotent');
    assert.ok(Array.from(mihomo.proxies[0].name).length <= 64);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

(async () => {
  testCandidateFilters();
  await testFraudScoreCoversDomains();
  testQualityTierSelection();
  testScoreNamesAndYamlReferences();
  console.log('Score/filter/name tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
