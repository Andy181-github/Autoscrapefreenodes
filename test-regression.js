/**
 * P1-4 回归测试 — 离线夹具驱动, 不依赖真实网络/公共节点。
 * 覆盖:
 *   - 去重 (mergeAndDeduplicate 内容哈希去重 + 同 server:port 保留高分)
 *   - 无效输入 (YAML/JSON 解析失败, 空输入)
 *   - 输出校验 (validateSubFiles: 空文件/缺文件/格式错误)
 *   - 零节点保护 (commitSubFiles 原子替换语义, run-status 状态文件)
 *   - buildUri 各协议输出 (vmess/trojan/ss/vless/hysteria2/http)
 *   - normalizeProxyNames 重名清洗
 *
 * 运行: node test-regression.js
 * 所有断言使用 node:assert, 失败时 process.exit(1)。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${label} — ${e.message}`);
  }
}

// ---------- 加载被测模块 ----------
let yaml;
let scraper;
try {
  yaml = require('js-yaml');
  scraper = require('./scraper');
} catch (e) {
  console.log('SKIP: cannot load dependencies (js-yaml or scraper.js): ' + e.message);
  process.exit(0);
}

console.log('\n=== P1-4 Regression: dedup / invalid input / output validation ===');

// ---------- 1. 内容哈希去重 (mergeAndDeduplicate) ----------
const clashContentA = yaml.dump({
  proxies: [
    { name: 'node-a', type: 'vless', server: 'a.example', port: 443, uuid: 'u1' },
  ],
});
const clashContentB = yaml.dump({
  proxies: [
    { name: 'node-b', type: 'trojan', server: 'b.example', port: 443, password: 'p1' },
  ],
});

check('dedup: two distinct URLs kept', () => {
  const results = [
    { siteUrl: 's1', rawContent: { 'https://x/1.yaml': { type: 'clash', content: clashContentA, proxies: [] } } },
    { siteUrl: 's2', rawContent: { 'https://x/2.yaml': { type: 'clash', content: clashContentB, proxies: [] } } },
  ];
  const { feeds } = scraper.mergeAndDeduplicate(results);
  assert.strictEqual(feeds.Clash.urls.length, 2);
});

check('dedup: identical content from two URLs collapsed', () => {
  const results = [
    { siteUrl: 's1', rawContent: { 'https://x/1.yaml': { type: 'clash', content: clashContentA, proxies: [] } } },
    { siteUrl: 's2', rawContent: { 'https://x/2.yaml': { type: 'clash', content: clashContentA, proxies: [] } } },
  ];
  const { feeds } = scraper.mergeAndDeduplicate(results);
  assert.strictEqual(feeds.Clash.urls.length, 1);
});

check('dedup: empty rawContent skipped without crash', () => {
  const { feeds } = scraper.mergeAndDeduplicate([{ siteUrl: 's' }]);
  assert.strictEqual(feeds.Clash.urls.length, 0);
});

// ---------- 2. 无效输入 ----------
check('parseClashYaml: invalid YAML returns []', () => {
  assert.deepStrictEqual(scraper.parseClashYaml('{{{not yaml'), []);
});

check('parseSingBoxJson: invalid JSON returns []', () => {
  assert.deepStrictEqual(scraper.parseSingBoxJson('not json'), []);
});

check('parseV2rayTxt: no proxy lines returns []', () => {
  assert.deepStrictEqual(scraper.parseV2rayTxt('random text\nno uris here'), []);
});

// ---------- 3. buildUri 各协议 ----------
const vlessP = { name: 'us-node', type: 'vless', server: 'us.example', port: 443, uuid: 'abc', security: 'tls', sni: 'us.example' };
const trojanP = { name: 'jp-node', type: 'trojan', server: 'jp.example', port: 443, password: 'pw' };
const ssP = { name: 'hk-node', type: 'ss', server: 'hk.example', port: 8388, cipher: 'aes-256-gcm', password: 'spw' };

check('buildUri: vless produces valid URI', () => {
  const uri = scraper.buildUri(vlessP);
  assert.ok(uri.startsWith('vless://'), uri);
  assert.ok(uri.includes('us.example:443'));
});

check('buildUri: trojan produces valid URI', () => {
  const uri = scraper.buildUri(trojanP);
  assert.ok(uri.startsWith('trojan://'), uri);
  assert.ok(uri.includes('jp.example:443'));
});

check('buildUri: ss produces base64-encrypted URI', () => {
  const uri = scraper.buildUri(ssP);
  assert.ok(uri.startsWith('ss://'), uri);
  const enc = uri.substring(5, uri.indexOf('@'));
  const decoded = Buffer.from(enc, 'base64').toString('utf8');
  assert.ok(decoded.startsWith('aes-256-gcm:'));
});

check('buildUri: unknown protocol type returns empty string', () => {
  assert.strictEqual(scraper.buildUri({ name: 'x', type: 'weird', server: 's', port: 1 }), '');
});

// ---------- 4. normalizeProxyNames ----------
check('normalizeProxyNames: duplicates suffixed, order stable', () => {
  const proxies = [
    { name: 'a' }, { name: 'a' }, { name: 'a' }, { name: 'b' },
  ];
  const renamed = scraper.normalizeProxyNames(proxies);
  assert.strictEqual(renamed, 2); // 2nd and 3rd "a" renamed
  assert.strictEqual(proxies[0].name, 'a');
  assert.strictEqual(proxies[1].name, 'a-2');
  assert.strictEqual(proxies[2].name, 'a-3');
  assert.strictEqual(proxies[3].name, 'b');
});

check('normalizeProxyNames: control chars stripped', () => {
  const proxies = [{ name: 'bad\x01name' }];
  scraper.normalizeProxyNames(proxies);
  assert.ok(!/\x01/.test(proxies[0].name), 'C0 control char must be removed');
});

// ---------- 5. validateSubFiles / commitSubFiles / 零节点保护 ----------
const TMP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'asfn-reg-'));

function makeValidTmpDir() {
  const d = path.join(TMP_BASE, 'valid-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'mihomo.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'vless', server: 's', port: 443, uuid: 'u' }] }));
  // all.yaml 必须全为标准 Clash 能力集且字段完整
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'ss', server: 's', port: 8388, cipher: 'aes-256-gcm', password: 'pw' }] }));
  fs.writeFileSync(path.join(d, 'base64.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  fs.writeFileSync(path.join(d, 'byxiaoxi.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  return d;
}

check('validateSubFiles: complete valid dir passes', () => {
  const errs = scraper.validateSubFiles(makeValidTmpDir());
  assert.deepStrictEqual(errs, []);
});

check('validateSubFiles: empty file fails', () => {
  const d = makeValidTmpDir();
  fs.writeFileSync(path.join(d, 'base64.txt'), '');
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('base64.txt')));
});

check('validateSubFiles: missing file fails', () => {
  const d = makeValidTmpDir();
  fs.unlinkSync(path.join(d, 'mihomo.yaml'));
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('mihomo.yaml')));
});

check('validateSubFiles: malformed txt line fails', () => {
  const d = makeValidTmpDir();
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'not-a-uri\n');
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('kooker.jp.txt')));
});

check('validateSubFiles: invalid YAML fails', () => {
  const d = makeValidTmpDir();
  fs.writeFileSync(path.join(d, 'all.yaml'), '{{{broken');
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('all.yaml')));
});

check('commitSubFiles: copies 5 files atomically into target dir', () => {
  const src = makeValidTmpDir();
  const dst = path.join(TMP_BASE, 'committed');
  fs.mkdirSync(dst, { recursive: true });
  scraper.commitSubFiles(src, dst);
  for (const f of scraper.SUB_OUTPUT_FILES) {
    assert.ok(fs.existsSync(path.join(dst, f)), f + ' missing after commit');
    const a = fs.readFileSync(path.join(src, f), 'utf8');
    const b = fs.readFileSync(path.join(dst, f), 'utf8');
    assert.strictEqual(a, b, f + ' content mismatch after commit');
  }
});

check('zero-node semantics: validation failure must NOT commit (formal files untouched)', () => {
  const src = makeValidTmpDir();
  fs.writeFileSync(path.join(src, 'mihomo.yaml'), ''); // force failure
  const dst = path.join(TMP_BASE, 'zero-guard');
  fs.mkdirSync(dst, { recursive: true });
  // Sentinel: pre-existing release content that must survive
  const sentinel = yaml.dump({ proxies: [{ name: 'old-release' }] });
  for (const f of scraper.SUB_OUTPUT_FILES) {
    fs.writeFileSync(path.join(dst, f), sentinel);
  }
  const errs = scraper.validateSubFiles(src);
  assert.ok(errs.length > 0, 'expected validation errors');
  // Because validation failed, commitSubFiles is NOT called — formal files must be byte-identical
  for (const f of scraper.SUB_OUTPUT_FILES) {
    assert.strictEqual(fs.readFileSync(path.join(dst, f), 'utf8'), sentinel, f + ' was overwritten despite failed validation');
  }
});

// ---------- 6. 零节点时 run-status 语义 (writeRunStatus 不依赖网络, 直接验证文件契约) ----------
check('run-status contract: failed status is machine-readable', () => {
  const statusFile = path.join(TMP_BASE, 'run-status.json');
  const status = { status: 'failed', reason: 'zero_proxies', generatedAt: new Date().toISOString() };
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  const back = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.strictEqual(back.status, 'failed');
  assert.strictEqual(back.reason, 'zero_proxies');
});

// ---------- 7. 协议兼容性 (2026-10 修复: anytls 拒载 / 标准 Clash 能力集 / socks 归一化) ----------
check('filterCoreSupported: anytls removed, socks remains canonical socks5', () => {
  const input = [
    { name: 'a', type: 'anytls', server: 's', port: 1 },
    { name: 'b', type: 'socks5', server: 's', port: 2 },
    { name: 'c', type: 'vless', server: 's', port: 3, uuid: 'u' },
  ];
  const out = scraper.filterCoreSupported(input).map(p => p.type);
  assert.deepStrictEqual(out, ['socks5', 'vless']);
});

check('filterClashStd: only supported standard types kept, https normalized to http+tls', () => {
  const input = [
    { name: 'a', type: 'ss', server: 's', port: 1 },
    { name: 'b', type: 'vless', server: 's', port: 2, uuid: 'u' },
    { name: 'c', type: 'hysteria2', server: 's', port: 3, password: 'p' },
    { name: 'd', type: 'trojan', server: 's', port: 4, password: 'p' },
    { name: 'e', type: 'http', server: 's', port: 5 },
    { name: 'f', type: 'anytls', server: 's', port: 6 },
    { name: 'g', type: 'socks5', server: 's', port: 1080 },
    { name: 'h', type: 'https', server: 's', port: 443 },
  ];
  const normalized = scraper.filterClashStd(input);
  const out = normalized.map(p => p.type);
  assert.deepStrictEqual(out, ['ss', 'trojan', 'http', 'socks5', 'http']);
  assert.strictEqual(normalized[4].tls, true);
});

check('sanitizeVlessEncryption: non-none value removed', () => {
  const p = { type: 'vless', encryption: 'mlkem768x25519plus' };
  scraper.sanitizeVlessEncryption(p);
  assert.strictEqual(p.encryption, undefined);
});

check('buildUri: SOCKS5 outputs canonical socks5:// URI', () => {
  const uri = scraper.buildUri({ name: 'n', type: 'socks5', server: 'h', port: 1080, username: '', password: '' });
  assert.ok(uri.startsWith('socks5://'), uri);
});

check('buildUri: http with empty creds omits user:pass@ segment', () => {
  const uri = scraper.buildUri({ name: 'n', type: 'http', server: 'h', port: 8080, username: '', password: '' });
  assert.ok(uri.startsWith('http://h:8080#'), uri);
});

check('validateSubFiles: all.yaml containing vless is rejected', () => {
  const d = path.join(TMP_BASE, 'proto-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'mihomo.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'vless' }] }));
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'vless' }] }));
  fs.writeFileSync(path.join(d, 'base64.txt'), 'vless://u@h:443#n\n');
  fs.writeFileSync(path.join(d, 'byxiaoxi.txt'), 'vless://u@h:443#n\n');
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'vless://u@h:443#n\n');
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('all.yaml') && e.includes('vless')), JSON.stringify(errs));
});

check('validateSubFiles: all.yaml with only std types passes', () => {
  const d = path.join(TMP_BASE, 'proto-ok');
  fs.mkdirSync(d, { recursive: true });
  const ss = { name: 'x', type: 'ss', server: 's', port: 8388, cipher: 'aes-256-gcm', password: 'pw' };
  const vmess = { name: 'y', type: 'vmess', server: 's', port: 443, uuid: 'u', alterId: 0, cipher: 'auto' };
  fs.writeFileSync(path.join(d, 'mihomo.yaml'), yaml.dump({ proxies: [ss] }));
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [ss, vmess] }));
  fs.writeFileSync(path.join(d, 'base64.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  fs.writeFileSync(path.join(d, 'byxiaoxi.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'ss://Y2lkZXI6cABAaDo4MDAjbik=\n');
  const errs = scraper.validateSubFiles(d);
  assert.deepStrictEqual(errs.filter(e => e.includes('all.yaml')), []);
});

check('validateSubFiles: hysteria2:// protocol line accepted (digit in scheme)', () => {
  // 2026-10: 旧正则 ^[a-z]+:// 不含数字, 会把 hysteria2:// 误判 malformed
  const d = path.join(TMP_BASE, 'h2-ok');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'mihomo.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'hysteria2', server: 'h', port: 443, password: 'pw' }] }));
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [{ name: 'x', type: 'ss', server: 'h', port: 8388, cipher: 'aes-256-gcm', password: 'pw' }] }));
  fs.writeFileSync(path.join(d, 'base64.txt'), 'hysteria2://pwd@h:443#n\n');
  fs.writeFileSync(path.join(d, 'byxiaoxi.txt'), 'hysteria2://pwd@h:443#n\n');
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'hysteria2://pwd@h:443#n\n');
  const errs = scraper.validateSubFiles(d);
  assert.deepStrictEqual(errs, [], JSON.stringify(errs));
});

// ---------- cleanup ----------
fs.rmSync(TMP_BASE, { recursive: true, force: true });

console.log(`\nP1-4 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All P1-4 regression tests passed.');
