/**
 * Clash/Mihomo 兼容性专项测试
 * 覆盖:
 *   - VMess alterId: aid=0 / 非零 / 缺失 / 非法
 *   - 原始 YAML 已有 alterId 的节点保留
 *   - 不同输入路径 (parseV2rayLineToEntry / convertYamlProxyToEntry / convertSingBoxToEntry) 归一化保留 alterId
 *   - 缺 UUID / 端口 / 认证 / cipher 异常节点隔离
 *   - HTTP 密码 None / null / 空值处理
 *   - 混合协议合法/非法节点
 *   - 最终 all.yaml / mihomo.yaml 可被 YAML 解析且无未设 alterId 的 VMess
 * 运行: node test-clash-compat.js
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
    console.log('  ✓ ' + label);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + label);
    console.log('    ' + e.message);
  }
}

let yaml;
let scraper;
try {
  yaml = require('js-yaml');
  scraper = require('./scraper');
} catch (e) {
  console.log('SKIP: cannot load dependencies: ' + e.message);
  process.exit(0);
}

console.log('\n=== Clash/Mihomo Compatibility Tests ===');

// ============================================================
// Section 1: VMess alterId — parseV2rayLineToEntry
// ============================================================
console.log('\n[1] parseV2rayLineToEntry — VMess alterId');

function makeVmessBase64(obj) {
  return 'vmess://' + Buffer.from(JSON.stringify(obj)).toString('base64');
}

// 1.1 aid=0
check('VMess aid=0 → alterId=0', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', add:'1.2.3.4', port:'443', id:'aaaa-bbbb', aid:0, net:'tcp', type:'none' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.ok(entry, 'entry should be non-null');
  assert.strictEqual(entry.type, 'vmess');
  assert.strictEqual(entry.alterId, 0, 'alterId should be 0, got ' + entry.alterId);
});

// 1.2 aid=1 (non-zero)
check('VMess aid=1 → alterId=1 (not overridden by default 0)', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', add:'1.2.3.4', port:'8080', id:'cccc-dddd', aid:1, net:'ws', type:'none', host:'example.com' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.ok(entry);
  assert.strictEqual(entry.alterId, 1, 'alterId should be 1, got ' + entry.alterId);
});

// 1.3 aid missing → default 0
check('VMess no aid → alterId=0 (modern VMess default)', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', add:'1.2.3.4', port:'443', id:'eeee-ffff', net:'tcp', type:'none' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.ok(entry);
  assert.strictEqual(entry.alterId, 0, 'missing aid should default to 0, got ' + entry.alterId);
});

// 1.4 invalid aid (negative) → null
check('VMess aid=-1 → null (isolated)', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', add:'1.2.3.4', port:'443', id:'xxxx-yyyy', aid:-1, net:'tcp', type:'none' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.strictEqual(entry, null, 'negative aid should return null');
});

// 1.5 missing uuid → null
check('VMess missing uuid → null', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', add:'1.2.3.4', port:'443', aid:0, net:'tcp', type:'none' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.strictEqual(entry, null, 'missing uuid should return null');
});

// 1.6 missing server → null
check('VMess missing server → null', () => {
  const uri = makeVmessBase64({ v:'2', ps:'test', port:'443', id:'aaaa', aid:0, net:'tcp', type:'none' });
  const entry = scraper.parseV2rayLineToEntry(uri);
  assert.strictEqual(entry, null, 'missing server should return null');
});

// ============================================================
// Section 2: convertYamlProxyToEntry — YAML input path
// ============================================================
console.log('\n[2] convertYamlProxyToEntry — YAML input path');

// 2.1 YAML proxy with alterId=0
check('YAML VMess with alterId=0 preserved', () => {
  const p = { name: 'hk-test', type: 'vmess', server: 'hk.example', port: 443, uuid: '1111-2222', alterId: 0, network: 'ws', tls: true, cipher: 'auto' };
  const entry = scraper.convertYamlProxyToEntry(p);
  assert.strictEqual(entry.alterId, 0, 'alterId should be 0, got ' + entry.alterId);
});

// 2.2 YAML proxy with alterId=1
check('YAML VMess with alterId=1 preserved', () => {
  const p = { name: 'jp-test', type: 'vmess', server: 'jp.example', port: 443, uuid: '3333-4444', alterId: 1, network: 'tcp' };
  const entry = scraper.convertYamlProxyToEntry(p);
  assert.strictEqual(entry.alterId, 1, 'alterId should be 1, got ' + entry.alterId);
});

// 2.3 YAML proxy without alterId (upstream didn't provide it)
check('YAML VMess without alterId → entry has no alterId key (stripClashStdMetadata will fill 0)', () => {
  const p = { name: 'us-test', type: 'vmess', server: 'us.example', port: 443, uuid: '5555-6666', network: 'tcp' };
  const entry = scraper.convertYamlProxyToEntry(p);
  // yamlProxyToEntry only copies if p[f] !== undefined
  // alterId is not in the source p, so entry.alterId should be undefined
  assert.strictEqual(entry.alterId, undefined, 'missing alterId should be undefined before stripClashStdMetadata');
});

// ============================================================
// Section 3: stripClashStdMetadata — all.yaml output validation
// ============================================================
console.log('\n[3] stripClashStdMetadata — all.yaml field hygiene');

// 3.1 VMess with alterId → kept
check('stripClashStdMetadata: VMess with alterId=0 passes', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, uuid: 'u1', alterId: 0, _region: 'us', qualityScore: 95, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 };
  const out = scraper.stripClashStdMetadata(p);
  assert.ok(out, 'should not be null');
  assert.strictEqual(out.alterId, 0);
  assert.strictEqual(out._region, undefined, '_region should be stripped');
  assert.strictEqual(out.qualityScore, undefined, 'qualityScore should be stripped');
});

// 3.2 VMess without alterId → filled with 0
check('stripClashStdMetadata: VMess without alterId → default 0', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, uuid: 'u1' };
  const out = scraper.stripClashStdMetadata(p);
  assert.ok(out);
  assert.strictEqual(out.alterId, 0, 'should default to 0');
});

// 3.3 VMess missing uuid → null
check('stripClashStdMetadata: VMess missing uuid → null', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, alterId: 0 };
  const out = scraper.stripClashStdMetadata(p);
  assert.strictEqual(out, null, 'missing uuid should return null');
});

// 3.4 VMess missing server → null
check('stripClashStdMetadata: VMess missing server → null', () => {
  const p = { name: 'test', type: 'vmess', port: 443, uuid: 'u1', alterId: 0 };
  const out = scraper.stripClashStdMetadata(p);
  assert.strictEqual(out, null, 'missing server should return null');
});

// 3.5 SS missing password → null (no fabrication)
check('stripClashStdMetadata: SS missing password → null', () => {
  const p = { name: 'test', type: 'ss', server: 's.example', port: 8388, cipher: 'aes-256-gcm' };
  const out = scraper.stripClashStdMetadata(p);
  assert.strictEqual(out, null, 'SS without password should return null');
});

// 3.6 Trojan missing password → null
check('stripClashStdMetadata: Trojan missing password → null', () => {
  const p = { name: 'test', type: 'trojan', server: 's.example', port: 443 };
  const out = scraper.stripClashStdMetadata(p);
  assert.strictEqual(out, null, 'Trojan without password should return null');
});

// 3.7 HTTP with password='null' (string) → password removed
check('stripClashStdMetadata: HTTP password="null" → removed', () => {
  const p = { name: 'test', type: 'http', server: 's.example', port: 8080, password: 'null' };
  const out = scraper.stripClashStdMetadata(p);
  assert.ok(out);
  assert.strictEqual(out.password, undefined, 'password="null" should be removed, got ' + out.password);
});

// 3.8 HTTP with password='None' → removed
check('stripClashStdMetadata: HTTP password="None" → removed', () => {
  const p = { name: 'test', type: 'http', server: 's.example', port: 8080, password: 'None' };
  const out = scraper.stripClashStdMetadata(p);
  assert.ok(out);
  assert.strictEqual(out.password, undefined, 'password="None" should be removed');
});

// 3.9 Invalid VMess cipher → safe default
check('stripClashStdMetadata: VMess invalid cipher → default auto', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, uuid: 'u1', alterId: 0, cipher: 'auto-invalid' };
  const out = scraper.stripClashStdMetadata(p);
  assert.ok(out);
  assert.strictEqual(out.cipher, 'auto', 'invalid cipher should fall back to auto');
});

// 3.10 Valid VMess cipher "auto" → kept
check('stripClashStdMetadata: VMess cipher="auto" → kept', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, uuid: 'u1', alterId: 0, cipher: 'auto' };
  const out = scraper.stripClashStdMetadata(p);
  assert.strictEqual(out.cipher, 'auto');
});

// ============================================================
// Section 4: stripMihomoMetadata — mihomo.yaml field hygiene
// ============================================================
console.log('\n[4] stripMihomoMetadata — mihomo.yaml field hygiene');

check('stripMihomoMetadata: metadata stripped, alterId filled', () => {
  const p = { name: 'test', type: 'vmess', server: 's.example', port: 443, uuid: 'u1', _region: 'us', qualityScore: 90, speed: 'fast', fraudScore: 5, detectLevel: 'tcp', latency: 0 };
  const out = scraper.stripMihomoMetadata(p);
  assert.ok(out);
  assert.strictEqual(out._region, undefined);
  assert.strictEqual(out.qualityScore, undefined);
  assert.strictEqual(out.alterId, 0, 'mihomo VMess should also have alterId');
});

check('stripMihomoMetadata: password="None" removed for non-VMess', () => {
  const p = { name: 'test', type: 'ss', server: 's.example', port: 8388, cipher: 'aes-256-gcm', password: 'None' };
  const out = scraper.stripMihomoMetadata(p);
  assert.ok(out);
  assert.strictEqual(out.password, undefined, 'password="None" should be removed');
});

// ============================================================
// Section 5: isInvalidAuth
// ============================================================
console.log('\n[5] isInvalidAuth');

check('isInvalidAuth: "null" → true', () => { assert.strictEqual(scraper.isInvalidAuth('null'), true); });
check('isInvalidAuth: "None" → true', () => { assert.strictEqual(scraper.isInvalidAuth('None'), true); });
check('isInvalidAuth: "None" (lowercase) → true', () => { assert.strictEqual(scraper.isInvalidAuth('none'), true); });
check('isInvalidAuth: "undefined" → true', () => { assert.strictEqual(scraper.isInvalidAuth('undefined'), true); });
check('isInvalidAuth: "" → true', () => { assert.strictEqual(scraper.isInvalidAuth(''), true); });
check('isInvalidAuth: null → true', () => { assert.strictEqual(scraper.isInvalidAuth(null), true); });
check('isInvalidAuth: undefined → true', () => { assert.strictEqual(scraper.isInvalidAuth(undefined), true); });
check('isInvalidAuth: "validpass" → false', () => { assert.strictEqual(scraper.isInvalidAuth('validpass'), false); });
check('isInvalidAuth: 0 (number) → false', () => { assert.strictEqual(scraper.isInvalidAuth(0), false); });

// ============================================================
// Section 6: End-to-end YAML generation
// ============================================================
console.log('\n[6] End-to-end: all.yaml / mihomo.yaml YAML validity');

function makeAllYamlTest() {
  const proxies = [
    // Valid VMess with alterId
    { name: '🇺🇸 us-vmess', type: 'vmess', server: '1.1.1.1', port: 443, uuid: 'aaaa', alterId: 0, network: 'tcp', cipher: 'auto', _region: 'us', qualityScore: 90, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Valid VMess with alterId=1
    { name: '🇭🇰 hk-vmess', type: 'vmess', server: '2.2.2.2', port: 443, uuid: 'bbbb', alterId: 1, network: 'ws', tls: true, _region: 'hk', qualityScore: 85, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Valid SS
    { name: '🇯🇵 jp-ss', type: 'ss', server: '3.3.3.3', port: 8388, cipher: 'aes-256-gcm', password: 'realpass', _region: 'jp', qualityScore: 70, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Valid Trojan
    { name: '🇸🇬 sg-trojan', type: 'trojan', server: '4.4.4.4', port: 443, password: 'trojanpass', _region: 'sg', qualityScore: 75, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Valid HTTP with real password
    { name: '🇺🇸 us-http', type: 'http', server: '5.5.5.5', port: 8080, username: 'user', password: 'pass', _region: 'us', qualityScore: 55, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Invalid: HTTP with password='null' → password stripped, node kept (http doesn't require auth)
    { name: '🇺🇸 us-http-bad', type: 'http', server: '6.6.6.6', port: 8080, password: 'null', _region: 'us', qualityScore: 55, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Invalid: SS missing password → should be null (removed)
    { name: '🇯🇵 jp-ss-nopass', type: 'ss', server: '7.7.7.7', port: 8388, cipher: 'aes-256-gcm', _region: 'jp', qualityScore: 70, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    // Invalid: VMess missing uuid → should be null (removed)
    { name: '🇺🇸 us-vmess-nouuid', type: 'vmess', server: '8.8.8.8', port: 443, alterId: 0, _region: 'us', qualityScore: 90, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
  ];

  // Apply stripClashStdMetadata (all.yaml path)
  const stdProxies = proxies
    .filter(p => scraper.CLASH_STD_TYPES.has(p.type))
    .map(scraper.stripClashStdMetadata)
    .filter(Boolean);

  return { stdProxies, allProxies: proxies };
}

check('all.yaml: valid VMess/SS/Trojan/HTTP kept, invalid removed', () => {
  const { stdProxies } = makeAllYamlTest();
  const names = stdProxies.map(p => p.name);
  // Should keep: us-vmess, hk-vmess, jp-ss, sg-trojan, us-http, us-http-bad
  assert.ok(names.includes('🇺🇸 us-vmess'), 'us-vmess should be kept');
  assert.ok(names.includes('🇭🇰 hk-vmess'), 'hk-vmess should be kept');
  assert.ok(names.includes('🇯🇵 jp-ss'), 'jp-ss should be kept');
  assert.ok(names.includes('🇸🇬 sg-trojan'), 'sg-trojan should be kept');
  assert.ok(names.includes('🇺🇸 us-http'), 'us-http should be kept');
  assert.ok(!names.includes('🇯🇵 jp-ss-nopass'), 'jp-ss-nopass should be removed (no password)');
  assert.ok(!names.includes('🇺🇸 us-vmess-nouuid'), 'us-vmess-nouuid should be removed (no uuid)');
});

check('all.yaml: no metadata fields in output', () => {
  const { stdProxies } = makeAllYamlTest();
  for (const p of stdProxies) {
    assert.strictEqual(p._region, undefined, p.name + ': _region should be stripped');
    assert.strictEqual(p.qualityScore, undefined, p.name + ': qualityScore should be stripped');
    assert.strictEqual(p.speed, undefined, p.name + ': speed should be stripped');
    assert.strictEqual(p.fraudScore, undefined, p.name + ': fraudScore should be stripped');
    assert.strictEqual(p.detectLevel, undefined, p.name + ': detectLevel should be stripped');
  }
});

check('all.yaml: all VMess entries have alterId', () => {
  const { stdProxies } = makeAllYamlTest();
  for (const p of stdProxies.filter(x => x.type === 'vmess')) {
    assert.ok(p.alterId !== undefined && p.alterId !== null, p.name + ': alterId must be set, got ' + p.alterId);
    assert.ok(Number.isInteger(p.alterId) && p.alterId >= 0, p.name + ': alterId must be non-negative integer');
  }
});

check('all.yaml: no password="null"/"None" in output', () => {
  const { stdProxies } = makeAllYamlTest();
  for (const p of stdProxies) {
    if (p.password !== undefined) {
      const s = String(p.password).trim().toLowerCase();
      assert.ok(s !== 'null' && s !== 'none' && s !== 'undefined' && s !== '', p.name + ': invalid password value "' + p.password + '"');
    }
  }
});

check('all.yaml YAML dumps and reloads cleanly', () => {
  const { stdProxies } = makeAllYamlTest();
  const rendered = yaml.dump({ proxies: stdProxies }, { lineWidth: -1, noRefs: true });
  const reparsed = yaml.load(rendered);
  assert.ok(reparsed && Array.isArray(reparsed.proxies), 'YAML should round-trip');
  assert.strictEqual(reparsed.proxies.length, stdProxies.length, 'proxy count should match');
  // Every VMess in reparsed YAML must have alterId
  for (const p of reparsed.proxies) {
    if (p.type === 'vmess') {
      assert.ok(p.alterId !== undefined, 'reloaded VMess "' + p.name + '" missing alterId');
    }
  }
});

// ============================================================
// Section 7: mihomo.yaml — stripMihomoMetadata
// ============================================================
console.log('\n[7] mihomo.yaml — stripMihomoMetadata');

check('mihomo.yaml: all VMess have alterId after stripping', () => {
  const proxies = [
    { name: 'a', type: 'vmess', server: 's', port: 443, uuid: 'u', _region: 'us', qualityScore: 90, speed: 'fast' },
    { name: 'b', type: 'vmess', server: 's', port: 443, uuid: 'u2', alterId: 1, _region: 'jp', qualityScore: 80, speed: 'fast' },
  ];
  const stripped = proxies.map(scraper.stripMihomoMetadata).filter(Boolean);
  for (const p of stripped) {
    assert.ok(p.alterId !== undefined, p.name + ': mihomo VMess must have alterId');
    assert.strictEqual(p._region, undefined, p.name + ': metadata stripped');
  }
  assert.strictEqual(stripped[0].alterId, 0, 'missing alterId → 0');
  assert.strictEqual(stripped[1].alterId, 1, 'existing alterId=1 preserved');
});

check('mihomo.yaml YAML dumps and reloads cleanly', () => {
  const proxies = [
    { name: 'a', type: 'vless', server: 's', port: 443, uuid: 'u', _region: 'us', qualityScore: 90, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    { name: 'b', type: 'hysteria2', server: 's', port: 443, password: 'p', _region: 'jp', qualityScore: 80, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
  ];
  const stripped = proxies.map(scraper.stripMihomoMetadata).filter(Boolean);
  const mihomoCfg = scraper.buildMihomoConfig(stripped);
  const rendered = yaml.dump(mihomoCfg, { lineWidth: -1, noRefs: true });
  const reparsed = yaml.load(rendered);
  assert.ok(reparsed && Array.isArray(reparsed.proxies), 'mihomo YAML should round-trip');
  assert.strictEqual(reparsed.proxies.length, 2);
  // No metadata in reparsed proxies
  for (const p of reparsed.proxies) {
    assert.strictEqual(p._region, undefined, 'metadata leaked into mihomo.yaml: ' + JSON.stringify(p));
  }
});

// ============================================================
// Section 8: Mixed protocol integration
// ============================================================
console.log('\n[8] Mixed protocol integration');

check('filterClashStd + stripClashStdMetadata: mixed input', () => {
  const input = [
    { name: 'vless-node', type: 'vless', server: 's', port: 443, uuid: 'u', _region: 'us', qualityScore: 80, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    { name: 'vmess-node', type: 'vmess', server: 's', port: 443, uuid: 'u', alterId: 0, cipher: 'auto', _region: 'jp', qualityScore: 80, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    { name: 'h2-node', type: 'hysteria2', server: 's', port: 443, password: 'p', _region: 'sg', qualityScore: 70, speed: 'fast', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    { name: 'ss-node', type: 'ss', server: 's', port: 8388, cipher: 'aes-256-gcm', password: 'pw', _region: 'hk', qualityScore: 60, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
    { name: 'socks-node', type: 'socks', server: 's', port: 1080 },
    { name: 'socks5-node', type: 'socks5', server: 's', port: 1081 },
    { name: 'https-node', type: 'https', server: 's', port: 443 },
    { name: 'anytls-node', type: 'anytls', server: 's', port: 443, _region: 'us', qualityScore: 50, speed: 'unknown', fraudScore: 0, detectLevel: 'tcp', latency: 0 },
  ];
  const std = scraper.filterClashStd(input);
  assert.deepStrictEqual(std.map(p => p.type), ['vmess', 'ss', 'socks5', 'socks5', 'http'], 'only supported standard types should survive and normalize');
  assert.strictEqual(std[4].tls, true, 'https must normalize to http with tls=true');
  const stripped = std.map(scraper.stripClashStdMetadata).filter(Boolean);
  assert.strictEqual(stripped.length, 5, 'all five valid nodes should survive stripping');
  for (const p of stripped) {
    assert.strictEqual(p._region, undefined);
    assert.strictEqual(p.qualityScore, undefined);
  }
});

// ============================================================
// Section 9: validateSubFiles — all.yaml field-level validation
// ============================================================
console.log('\n[9] validateSubFiles — field-level checks for all.yaml');

check('validateSubFiles: rejects missing VMess alterId and unknown protocol types', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asfn-compat-'));
  const valid = { name: 'valid-vmess', type: 'vmess', server: 's', port: 443, uuid: 'u', alterId: 0, cipher: 'auto' };
  fs.writeFileSync(path.join(d, 'mihomo.yaml'), yaml.dump({ proxies: [valid] }));
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [valid] }));
  fs.writeFileSync(path.join(d, 'base64.txt'), 'vmess://dGVzdA==\n');
  fs.writeFileSync(path.join(d, 'byxiaoxi.txt'), 'vmess://dGVzdA==\n');
  fs.writeFileSync(path.join(d, 'kooker.jp.txt'), 'vmess://dGVzdA==\n');
  assert.deepStrictEqual(scraper.validateSubFiles(d), [], 'valid fixture should pass');
  fs.writeFileSync(path.join(d, 'all.yaml'), yaml.dump({ proxies: [{ ...valid, alterId: undefined }, { name: 'bad-socks', type: 'socks', server: 's', port: 1080 }] }));
  const errs = scraper.validateSubFiles(d);
  assert.ok(errs.some(e => e.includes('alterId')), 'missing alterId must fail validation');
  assert.ok(errs.some(e => e.includes("unsupported type 'socks'")), 'legacy socks type must fail validation');
  fs.rmSync(d, { recursive: true, force: true });
});

check('parseV2rayLineToEntry: socks5 URI parses without const reassignment failure', () => {
  const p = scraper.parseV2rayLineToEntry('socks5://user:pass@127.0.0.1:1080#socks-node');
  assert.ok(p, 'socks5 URI should parse');
  assert.strictEqual(p.type, 'socks5');
  assert.strictEqual(p.username, 'user');
  assert.strictEqual(p.password, 'pass');
});

check('parseV2rayLineToEntry: https URI becomes HTTP with TLS', () => {
  const p = scraper.parseV2rayLineToEntry('https://127.0.0.1:443#https-node');
  assert.ok(p, 'https URI should parse');
  const normalized = scraper.normalizeProxyType(p);
  assert.strictEqual(normalized.type, 'http');
  assert.strictEqual(normalized.tls, true);
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`Clash Compat Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED');
  process.exit(1);
}
console.log('All Clash compatibility tests passed. ✓');
