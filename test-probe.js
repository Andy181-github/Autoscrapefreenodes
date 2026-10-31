'use strict';
const assert = require('assert');
const { classifyFailure, median, medianAbsoluteDeviation, wilsonLowerBound, summarizeNode, mapLimit } = require('./scripts/probe-nodes');
assert.strictEqual(classifyFailure(503, 'connection refused'), 'connect_error');
assert.strictEqual(classifyFailure(504, 'context deadline exceeded'), 'timeout');
assert.strictEqual(classifyFailure(502, 'TLS handshake failed'), 'tls_error');
assert.strictEqual(classifyFailure(401, 'authentication failed'), 'auth_error');
assert.strictEqual(classifyFailure(502, 'upstream error'), 'http_error');
assert.strictEqual(median([50, 10, 30]), 30);
assert.strictEqual(median([10, 30, 50, 70]), 40);
assert.strictEqual(medianAbsoluteDeviation([100, 110, 120, 130, 140, 150, 160, 170]), 20);
assert.strictEqual(medianAbsoluteDeviation([], 0), null);
assert.ok(wilsonLowerBound(8, 8) > 0.67 && wilsonLowerBound(8, 8) < 0.68);
assert.ok(wilsonLowerBound(7, 8) < 0.65);
function samples(successes, attempts = 8) {
  return Array.from({ length: attempts }, (_, i) => ({
    ok: i < successes, delayMs: i < successes ? 100 + i * 10 : null,
    target: i % 2 ? 'https://target-b.invalid' : 'https://target-a.invalid',
    round: Math.floor(i / 2) + 1, failure: i < successes ? undefined : 'timeout'
  }));
}
const proxy = { name: 'fixture', type: 'ss', server: '127.0.0.1', port: 8388 };
const perfect = summarizeNode(proxy, samples(8));
assert.strictEqual(perfect.status, 'stable');
assert.strictEqual(perfect.successRate, 1);
assert.strictEqual(perfect.attempts, 8);
assert.strictEqual(perfect.successfulTargets.length, 2);
assert.ok(perfect.qualityScore >= 75 && perfect.qualityScore <= 80);
assert.strictEqual(perfect.qualityBreakdown.reliability, Number((70 * wilsonLowerBound(8, 8)).toFixed(2)));
assert.strictEqual(perfect.latencyMs, 135);
assert.strictEqual(perfect.jitterMs, 20);
const slowerSamples = samples(8).map(x => ({ ...x, delayMs: x.ok ? x.delayMs + 5000 : null }));
assert.ok(summarizeNode(proxy, slowerSamples).qualityScore < perfect.qualityScore, 'higher latency should reduce quality score');
const outlierSamples = [...samples(8), { ok: true, delayMs: 10000, target: 'https://target-a.invalid', round: 5 }];
const withOutlier = summarizeNode(proxy, outlierSamples);
assert.ok(withOutlier.jitterMs < 100, 'MAD jitter should resist one extreme latency outlier');
const moreEvidenceSamples = Array.from({ length: 32 }, (_, i) => ({ ok: true, delayMs: 100 + (i % 8) * 10, target: i % 2 ? 'https://target-b.invalid' : 'https://target-a.invalid', round: Math.floor(i / 2) + 1 }));
const moreEvidence = summarizeNode(proxy, moreEvidenceSamples);
assert.ok(moreEvidence.qualityBreakdown.reliability > perfect.qualityBreakdown.reliability, 'more all-success evidence should increase conservative reliability points');
assert.strictEqual(Object.prototype.hasOwnProperty.call(perfect, 'password'), false);
const working = summarizeNode({ name: 'working', type: 'ss', server: 's', port: 1 }, samples(5));
assert.strictEqual(working.status, 'working');
const unreliable = summarizeNode({ name: 'bad', type: 'ss', server: 's', port: 1 }, samples(4));
assert.strictEqual(unreliable.status, 'unreliable');
const tooFew = summarizeNode({ name: 'small-sample', type: 'ss', server: 's', port: 1 }, samples(4, 4));
assert.strictEqual(tooFew.status, 'insufficient_data');
assert.strictEqual(tooFew.qualityScore, null, 'insufficient samples must not publish a numeric quality score');
assert.strictEqual(tooFew.qualityBreakdown, null, 'insufficient samples must not publish numeric score components');
assert.ok(perfect.qualityScore > working.qualityScore);
const singleTarget = samples(8).map(x => ({ ...x, target: 'https://only-one.invalid' }));
assert.strictEqual(summarizeNode(proxy, singleTarget).status, 'unreliable');
assert.strictEqual(summarizeNode(proxy, singleTarget).targetCoverage, 0.5, 'coverage must be measured against configured targets, not observed targets');
(async () => {
  let active = 0, peak = 0;
  const values = await mapLimit([1,2,3,4,5,6], 2, async n => {
    active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return n * 2;
  });
  assert.deepStrictEqual(values, [2,4,6,8,10,12]);
  assert.strictEqual(peak, 2);
  console.log('Probe tests passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
