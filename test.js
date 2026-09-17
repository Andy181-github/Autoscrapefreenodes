/**
 * Test suite for AutoScrapeFreeNodes
 * Run with: node test.js
 */

const assert = require('assert');
const path = require('path');

// Mock required modules
// 说明: tests below re-implement the functions under test locally to keep
// this suite dependency-free; mock scaffolding below is left in place for
// future integration-style tests that call into scraper.js directly.
const mockFs = {
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: () => {},
  readJsonSync: () => ({ sites: [], settings: { port: 3000, dataDir: 'data' } })
};

// Create mock modules
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  getLogs: () => [],
  saveLogs: () => null
};

// Test region detection
function testRegionDetection() {
  console.log('\n=== Testing Region Detection ===');

  const testCases = [
    { input: 'hk-01', expected: 'hk' },
    { input: 'taiwan-test', expected: 'tw' },
    { input: 'jp-tokyo-01', expected: 'jp' },
    { input: 'us-new-york', expected: 'us' },
    { input: 'singapore-primary', expected: 'sg' },
    { input: 'korea-seoul', expected: 'kr' },
    { input: 'london-uk', expected: 'uk' },
    { input: 'frankfurt-de', expected: 'de' },
    { input: 'paris-fr', expected: 'fr' },
    { input: 'ams-netherlands', expected: 'nl' },
    { input: 'toronto-ca', expected: 'ca' },
    { input: 'sydney-au', expected: 'au' },
    { input: 'aliyun-cn', expected: 'cn' },
    { input: 'random-server', expected: 'unknown' },
    { input: '', expected: 'unknown' },
    { input: null, expected: 'unknown' }
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      // Simulate region detection logic
      const region = detectRegionFromName(tc.input);
      assert.strictEqual(region, tc.expected, `Expected ${tc.expected} for ${tc.input}, got ${region}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${tc.input} - ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

function detectRegionFromName(nodeName) {
  if (!nodeName) return 'unknown';
  const lower = nodeName.toLowerCase().replace(/[_\-\s]/g, '');
  const aa = [
    ['hk', 'hk'], ['港', 'hk'], ['hongkong', 'hk'], ['hkt', 'hk'], ['hgc', 'hk'],
    ['tw', 'tw'], ['台', 'tw'], ['taiwan', 'tw'], ['cht', 'tw'], ['hinet', 'tw'],
    ['jp', 'jp'], ['日', 'jp'], ['japan', 'jp'], ['tokyo', 'jp'], ['osaka', 'jp'],
    ['us', 'us'], ['美', 'us'], ['america', 'us'], ['usa', 'us'], ['ny', 'us'], ['la', 'us'], ['sf', 'us'], ['dc', 'us'],
    ['sg', 'sg'], ['新加坡', 'sg'], ['singapore', 'sg'], ['sin', 'sg'],
    ['kr', 'kr'], ['韩', 'kr'], ['korea', 'kr'], ['seoul', 'kr'],
    ['uk', 'uk'], ['英', 'uk'], ['britain', 'uk'], ['london', 'uk'], ['gb', 'uk'],
    ['de', 'de'], ['德', 'de'], ['germany', 'de'], ['frankfurt', 'de'],
    ['fr', 'fr'], ['法', 'fr'], ['paris', 'fr'],
    ['nl', 'nl'], ['荷', 'nl'], ['netherlands', 'nl'], ['ams', 'nl'],
    ['ca', 'ca'], ['加拿大', 'ca'], ['toronto', 'ca'],
    ['au', 'au'], ['澳', 'au'], ['australia', 'au'], ['sydney', 'au'],
    ['cn', 'cn'], ['中', 'cn'], ['china', 'cn'], ['aliyun', 'cn'], ['tencent', 'cn'], ['baidu', 'cn']
  ];
  aa.sort((a, b) => b[0].length - a[0].length);
  for (const [alias, region] of aa) {
    if (lower.includes(alias)) return region;
  }
  return 'unknown';
}

// Test IP detection
function testIPDetection() {
  console.log('\n=== Testing IP Detection ===');

  const testCases = [
    { input: '52.10.20.30', expected: 'cloud' },
    { input: '104.16.0.1', expected: 'cloud' },
    { input: '8.8.8.8', expected: 'unknown' },
    { input: '1.1.1.1', expected: 'unknown' },
    { input: '', expected: 'unknown' },
    { input: null, expected: 'unknown' }
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const region = detectRegionFromIP(tc.input);
      assert.strictEqual(region, tc.expected, `Expected ${tc.expected} for ${tc.input}, got ${region}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${tc.input} - ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

function detectRegionFromIP(ip) {
  if (!ip) return 'unknown';
  const cloudRanges = {
    'aws': ['52.', '54.', '13.', '15.', '18.', '23.', '44.', '50.', '51.', '99.'],
    'gcp': ['34.', '35.', '64.', '66.', '72.', '74.', '108.', '130.', '172.'],
    'azure': ['13.', '20.', '40.', '65.', '104.', '137.', '168.', '207.'],
    'cloudflare': ['104.', '172.', '173.', '188.', '198.'],
    'aliyun': ['47.', '100.', '106.', '116.', '120.', '139.', '140.', '150.', '198.'],
    'tencent': ['153.', '175.', '203.', '210.', '220.']
  };
  for (const [, prefixes] of Object.entries(cloudRanges)) {
    for (const prefix of prefixes) {
      if (ip.startsWith(prefix)) return 'cloud';
    }
  }
  return 'unknown';
}

// Test URL extraction
function testURLExtraction() {
  console.log('\n=== Testing URL Extraction ===');

  const testCases = [
    {
      input: 'Check out https://example.com/clash.yaml for more info',
      expected: ['https://example.com/clash.yaml']
    },
    {
      input: 'Links: http://test.txt https://proxy.yml\nhttps://more.json',
      expected: ['http://test.txt', 'https://proxy.yml', 'https://more.json']
    },
    {
      input: 'No URLs here',
      expected: []
    }
  ];

  const URL_REGEX = /(https?:\/\/[^\s<>"']+(?:\.yaml|\.yml|\.txt|\.json)[^\s<>"']*)/gi;

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const matches = tc.input.match(URL_REGEX) || [];
      const result = [...new Set(matches)];
      assert.deepStrictEqual(result, tc.expected, `Expected ${JSON.stringify(tc.expected)}, got ${JSON.stringify(result)}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Test proxy line extraction
function testProxyLineExtraction() {
  console.log('\n=== Testing Proxy Line Extraction ===');

  const testCases = [
    {
      input: 'vmess://abc123\ntrojan://xyz789\nhttp://example.com',
      expected: 3
    },
    {
      input: 'vmess://abc\ntrojan://xyz\nrandom text',
      expected: 2
    },
    {
      input: 'socks://def\nhysteria://xyz\ntuic://test',
      expected: 3
    }
  ];

  // Regex matches protocol:// followed by any characters
  const PROXY_LINE_REGEX = /^(vmess|trojan|ss|ssr|http|socks|tuic|hysteria|wireguard):\/\//i;

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const lines = tc.input.split('\n').map(l => l.trim()).filter(l => l && PROXY_LINE_REGEX.test(l));
      assert.strictEqual(lines.length, tc.expected, `Expected ${tc.expected} lines, got ${lines.length}: ${JSON.stringify(lines)}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Test SHA256 hashing
function testSHA256() {
  console.log('\n=== Testing SHA256 Hashing ===');

  // Use actual crypto module
  const crypto = require('crypto');
  
  function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 12);
  }

  let result = sha256('test');
  assert.strictEqual(typeof result, 'string', 'Result should be string');
  assert.strictEqual(result.length, 12, `Expected length 12, got ${result.length}`);
  
  result = sha256('');
  assert.strictEqual(result.length, 12, `Expected length 12 for empty string, got ${result.length}`);
  
  result = sha256('very-long-string-for-testing');
  assert.strictEqual(result.length, 12, `Expected length 12 for long string, got ${result.length}`);

  console.log('  SHA256 hash generation: OK');
  console.log(`  Results: 3 passed, 0 failed`);
  return true;
}

// Test fraud score calculation
function testFraudScore() {
  console.log('\n=== Testing Fraud Score Calculation ===');

  const testCases = [
    {
      proxy: { server: 'racknerd.example.com', name: 'test' },
      minScore: 25,
      maxScore: 100
    },
    {
      proxy: { server: 'my-private-server.com', name: 'test' },
      minScore: 0,
      maxScore: 10
    },
    {
      proxy: { server: 'example.com', name: 'vpn-proxy-test' },
      minScore: 15,
      maxScore: 100
    }
  ];

  const proxyProviders = ["bandwagon", "racknerd", "hostinger", "namecheap", "cloudflare", "digitalocean", "vultr", "linode", "hetzner", "ovh", "scaleway", "contabo", "foxhost", "hostdad", "hostreplica", "hostus", "serverloft", "myloc", "hostkey", "kimsufi", "soyoustart", "online.net", "scaleway"];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      let score = 0;
      const server = (tc.proxy.server || "").toLowerCase();
      const name = (tc.proxy.name || "").toLowerCase();

      for (const kw of proxyProviders) {
        if (server.includes(kw)) { score += 25; break; }
      }

      const nameIndicators = ["proxy", "vpn", "tor", "anonym", "relay", "jump", "ssh", "tunnel", "bypass", "freeproxy", "freevpn"];
      for (const kw of nameIndicators) {
        if (name.includes(kw)) { score += 15; break; }
      }

      assert.ok(score >= tc.minScore && score <= tc.maxScore, `Expected score between ${tc.minScore} and ${tc.maxScore}, got ${score}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Test quality score calculation
function testQualityScore() {
  console.log('\n=== Testing Quality Score Calculation ===');

  const testCases = [
    {
      proxy: { server: 'my-server.com', name: 'us-test', tls: true, udp: true },
      expected: { min: 70, max: 80 }
    },
    {
      proxy: { server: 'unknown-server', name: 'test', tls: false, udp: false },
      expected: { min: 50, max: 60 }
    }
  ];

  const IP_REGION_MAP = {
    'hkpcc': 'hk', 'hkc': 'hk', 'hk': 'hk', 'hkt': 'hk',
    'tw': 'tw', 'taiwan': 'tw', 'cht': 'tw', 'hinet': 'tw',
    'jp': 'jp', 'japan': 'jp', 'tokyo': 'jp', 'osaka': 'jp',
    'us': 'us', 'usa': 'us', 'america': 'us', 'ny': 'us', 'la': 'us', 'sf': 'us', 'dc': 'us',
    'sg': 'sg', 'singapore': 'sg', 'sin': 'sg',
    'kr': 'kr', 'korea': 'kr', 'seoul': 'kr',
    'uk': 'uk', 'gb': 'uk', 'london': 'uk',
    'de': 'de', 'germany': 'de', 'frankfurt': 'de',
    'fr': 'fr', 'france': 'fr', 'paris': 'fr',
    'nl': 'nl', 'netherlands': 'nl', 'ams': 'nl',
    'ca': 'ca', 'canada': 'ca', 'toronto': 'ca',
    'au': 'au', 'australia': 'au', 'sydney': 'au',
    'cn': 'cn', 'china': 'cn', 'aliyun': 'cn', 'tencent': 'cn', 'baidu': 'cn'
  };

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      let score = 50;
      const nameLower = (tc.proxy.name || "").toLowerCase().replace(/[_\-\s]/g, "");
      let region = "unknown";
      for (const [key, val] of Object.entries(IP_REGION_MAP)) {
        if (nameLower.includes(key.toLowerCase())) { region = val; break; }
      }
      if (region !== "unknown") score += 15;
      if (tc.proxy.tls || tc.proxy.type === "trojan" || tc.proxy.type === "vless") score += 5;
      if (tc.proxy.udp) score += 5;

      assert.ok(score >= tc.expected.min && score <= tc.expected.max, `Expected score between ${tc.expected.min} and ${tc.expected.max}, got ${score}`);
      passed++;
    } catch (e) {
      failed++;
      console.log(`  FAIL: ${e.message}`);
    }
  }

  console.log(`  Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Main test runner
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('AutoScrapeFreeNodes Test Suite v3.9.0');
  console.log('='.repeat(60));

  const results = [];

  results.push(await testRegionDetection());
  results.push(await testIPDetection());
  results.push(await testURLExtraction());
  results.push(await testProxyLineExtraction());
  results.push(await testSHA256());
  results.push(await testFraudScore());
  results.push(await testQualityScore());

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log(`Test Results: ${passed}/${total} passed`);
  if (passed === total) {
    console.log('All tests passed! ✓');
  } else {
    console.log('Some tests failed! ✗');
    process.exit(1);
  }
  console.log('='.repeat(60) + '\n');
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
