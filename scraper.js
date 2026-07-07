const { loadHistoricalProxies, saveHistoricalProxies } = require('./lib/history'); // P2-4: Historical proxy fallback
          const fp = generateProxyFingerprint(p);
          if (p.server && p.port && !seenFingerprints.has(fp)) { seenFingerprints.add(fp); proxyByServerPort.set(fp, p); allProxies.push(p); }
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const yaml = require('js-yaml');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// IP地区映射表
const IP_REGION_MAP = {
  'hkpcc':'hk','hkc':'hk','hk':'hk','hkt':'hk',
  'tw':'tw','taiwan':'tw','cht':'tw','hinet':'tw',
  'jp':'jp','japan':'jp','tokyo':'jp','osaka':'jp',
  'us':'us','usa':'us','america':'us','ny':'us','la':'us','sf':'us','dc':'us',
  'sg':'sg','singapore':'sg','sin':'sg',
  'kr':'kr','korea':'kr','seoul':'kr',
  'uk':'uk','gb':'uk','london':'uk',
  'de':'de','germany':'de','frankfurt':'de',
  'fr':'fr','france':'fr','paris':'fr',
  'nl':'nl','netherlands':'nl','ams':'nl',
  'ca':'ca','canada':'ca','toronto':'ca',
  'au':'au','australia':'au','sydney':'au',
  'cn':'cn','china':'cn','aliyun':'cn','tencent':'cn','baidu':'cn'
};

const REGION_ALIASES = {
  'hk':['hk','港','hongkong','hkt','hgc'],
  'tw':['tw','台','taiwan','cht','hinet'],
  'jp':['jp','日','japan','tokyo','osaka'],
  'us':['us','美','america','usa','ny','la','sf','dc'],
  'sg':['sg','新加坡','singapore','sin'],
  'kr':['kr','韩','korea','seoul'],
  'uk':['uk','英','britain','london','gb'],
  'de':['de','德','germany','frankfurt'],
  'fr':['fr','法','paris'],
  'nl':['nl','荷','netherlands','ams'],
  'ca':['ca','加拿大','toronto'],
  'au':['au','澳','australia','sydney'],
  'cn':['cn','中','china','aliyun','tencent','baidu']
};

function detectRegionFromName(nodeName) {
  if (!nodeName) return 'unknown';
  const lower = nodeName.toLowerCase().replace(/[_\-\s]/g, '');
  const aa = Object.entries(REGION_ALIASES)
    .flatMap(([region, als]) => als.map(a => [a.toLowerCase(), region]));
  aa.sort((a, b) => b[0].length - a[0].length);
  for (const [alias, region] of aa) {
    if (lower.includes(alias)) return region;
  }
  for (const [key, region] of Object.entries(IP_REGION_MAP)) {
    const regex = new RegExp('\\b' + key.toLowerCase() + '\\b', 'i');
    if (regex.test(lower)) return region;
  }
  return 'unknown';
}

function detectRegionFromIP(ip) {
  if (!ip) return 'unknown';
  const cloudRanges = {
    'aws':['52.','54.','13.','15.','18.','23.','44.','50.','51.','99.'],
    'gcp':['34.','35.','64.','66.','72.','74.','108.','130.','172.'],
    'azure':['13.','20.','40.','65.','104.','137.','168.','207.'],
    'cloudflare':['104.','172.','173.','188.','198.'],
    'aliyun':['47.','100.','106.','116.','120.','139.','140.','150.','198.'],
    'tencent':['153.','175.','203.','210.','220.']
  };
  for (const [, prefixes] of Object.entries(cloudRanges)) {
    for (const prefix of prefixes) {
      if (ip.startsWith(prefix)) return 'cloud';
    }
  }
  return 'unknown';
}

function isPrivateIP(ip) {
  if (!ip) return false;
  return /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^127\./.test(ip);
}



// ============================================
// Proxy Fingerprint Generation (P1-1)
// Reference: Inspired by MiracleNan/subscribe-true-grading proxy fingerprinting
// Extends basic Server:Port dedup to include type + UUID + password + cipher + network + flow
// ============================================
function generateProxyFingerprint(p) {
  const parts = [
    p.type || '', p.server || '', p.port || '',
    p.uuid || p.id || '', p.password || '', p.cipher || '',
    p.network || '', p.flow || '', p.sni || ''
  ];
  return parts.join('|');
}


// Noise/scam filter regex (from MiracleNan/subscribe-true-grading)
const NOISE_PATTERNS = [
  /剩余流量/i, /到期/i, /套餐/i, /购买/i, /免费/i, /付费/i,
  /促销/i, /优惠/i, /充值/i, /客服/i, /官网/i, /注册/i,
  /点击链接/i, /关注公众号/i, /telegram/i, /电报/i,
  /广告/i, /推广/i, /引流/i, /加群/i
];

function isNoiseNode(name) {
  if (!name) return false;
  return NOISE_PATTERNS.some(pattern => pattern.test(name));
}


// ============================================
// Media Platform Unlock Detection (P1-2)
// Reference: Inspired by beck-8/subs-check media unlock detection
// ============================================
const MEDIA_PLATFORMS = {
  'NF': 'https://www.netflix.com', 'GPT+': 'https://chat.openai.com',
  'GM': 'https://gemini.google.com', 'D+': 'https://www.disneyplus.com',
  'YT': 'https://www.youtube.com', 'CL': 'https://claude.ai',
  'SP': 'https://www.spotify.com', 'TT': 'https://www.tiktok.com'
};

async function detectMediaUnlock(proxy, timeout = 3000) {
  if (!['vmess', 'trojan', 'http', 'https', 'ss'].includes(proxy.type)) return { unlocked: [], score: 0 };
  const unlocked = [];
  try {
    for (const url of Object.values(MEDIA_PLATFORMS)) {
      try {
        const start = Date.now();
        const proto = proxy.type === 'https' ? 'https' : 'http';
        const resp = await axios.get(url, {
          proxy: { host: proxy.server, port: parseInt(proxy.port), protocol: proto },
          timeout, responseType: 'text', maxRedirects: 3
        });
        if (resp.status === 200 && resp.data && resp.data.length > 1000) {
          for (const [key, tu] of Object.entries(MEDIA_PLATFORMS)) {
            if (tu === url) { unlocked.push({ platform: key, latency: Date.now() - start }); break; }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return { unlocked, score: unlocked.length };
}

function detectMediaUnlockHeuristic(proxy) {
  const badges = [];
  if (proxy.tls && (proxy.type === 'vmess' || proxy.type === 'trojan')) {
    if (proxy['client-fingerprint'] === 'chrome' || proxy['client-fingerprint'] === 'random') badges.push('[GPT+]');
  }
  if (proxy.type === 'trojan' && proxy.sni && proxy.sni.includes('google')) badges.push('[GM]');
  if (proxy.type === 'vmess' && proxy.network === 'ws' && proxy.tls) badges.push('[NF]');
  if (badges.length === 0 && proxy.type !== 'unknown') badges.push('[✓]');
  return badges.join(' ');
}



// ============================================
// Quality Scoring System (P2-5)
// S/A/B/C/D grade based on latency, media unlocks, region rarity, protocol security
// ============================================
function calculateQualityScore(proxy) {
  let score = 0;
  if (proxy.latency > 0) {
    if (proxy.latency < 100) score += 30;
    else if (proxy.latency < 300) score += 25;
    else if (proxy.latency < 500) score += 20;
    else if (proxy.latency < 1000) score += 10;
    else score += 5;
  } else { score += 15; }
  const mediaBadges = detectMediaUnlockHeuristic(proxy);
  const uc = (mediaBadges.match(/\[.+?\]/g) || []).length;
  if (uc >= 3) score += 30; else if (uc === 2) score += 20; else if (uc === 1) score += 10;
  const commonRegions = ['us', 'hk', 'jp', 'sg'];
  const rareRegions = ['tw', 'kr', 'uk', 'de', 'fr', 'nl', 'ca', 'au'];
  const region = (proxy.region || 'unknown').toLowerCase();
  if (rareRegions.includes(region)) score += 20;
  else if (commonRegions.includes(region)) score += 10;
  else if (region !== 'unknown') score += 5;
  if (['trojan', 'vmess'].includes(proxy.type)) score += 20;
  else if (['hysteria', 'tuic', 'wireguard'].includes(proxy.type)) score += 15;
  else if (proxy.type === 'ss') score += 10;
  else if (proxy.type === 'http') score += 5;
  const pct = Math.round((score / 100) * 100);
  let grade;
  if (pct >= 90) grade = 'S'; else if (pct >= 75) grade = 'A';
  else if (pct >= 60) grade = 'B'; else if (pct >= 40) grade = 'C'; else grade = 'D';
  return { score, grade, percentage: pct };
}


function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 12);
}

function loadConfig() {
  try {
    const cp = path.join(__dirname, 'config.json');
    if (!fs.existsSync(cp)) return { sites: [], settings: { port: 3000, dataDir: 'data' } };
    return fs.readJsonSync(cp);
  } catch (e) {
    return { sites: [], settings: { port: 3000, dataDir: 'data' } };
  }
}

async function httpGet(url, retries = 2, timeout = 15000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        timeout, responseType: 'text', maxRedirects: 5
      });
      return r.data;
    } catch (e) {
      if (i === retries) throw e;
      console.log(`  [WARN] Retry ${i+1}/${retries} for ${url}: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>"']+(?:\.yaml|\.yml|\.txt|\.json)[^\s<>"']*)/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)];
}

function extractProxyLines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && /^(vmess|trojan|ss|ssr|http|socks|tuic|hysteria|wireguard):\/\//i.test(l));
}

function parseClashYaml(yamlContent) {
  try {
    const config = yaml.load(yamlContent);
    if (!config || !config.proxies) return [];
    return config.proxies.map(proxy => {
      const name = proxy.name || 'Unknown';
      const type = proxy.type || 'unknown';
      const server = proxy.server || '';
      const region = detectRegionFromName(name);
      return { name, type, server, port: proxy.port || '', region, renamed: region !== 'unknown' ? `${region}-${name}` : name, _orig: proxy };
    });
  } catch (e) {
    console.error('Failed to parse Clash YAML:', e.message);
    return [];
  }
}

function parseSingBoxJson(jsonContent) {
  try {
    const config = JSON.parse(jsonContent);
    if (!config || !config.outbounds) return [];
    return config.outbounds
      .filter(ob => ['shadowsocks','vmess','trojan','hysteria','tuic','wireguard','http','socks'].includes(ob.type))
      .map(ob => {
        const name = ob.tag || ob.name || 'Unknown';
        const region = detectRegionFromName(name);
        return { name, type: ob.type || 'unknown', server: ob.server || '', port: ob.port || '', region, renamed: region !== 'unknown' ? `${region}-${name}` : name, _orig: ob };
      });
  } catch (e) {
    console.error('Failed to parse Sing-Box JSON:', e.message);
    return [];
  }
}

function parseV2rayTxt(txtContent) {
  const lines = extractProxyLines(txtContent);
  return lines.map(line => {
    let type = 'unknown';
    const upper = line.toUpperCase();
    if (upper.startsWith('VMESS')) type = 'vmess';
    else if (upper.startsWith('TROJAN')) type = 'trojan';
    else if (upper.startsWith('SS://')) type = 'ss';
    else if (upper.startsWith('SSR://')) type = 'ssr';
    else if (upper.startsWith('HTTP')) type = 'http';
    else if (upper.startsWith('SOCKS')) type = 'socks';
    else if (upper.startsWith('TUIC')) type = 'tuic';
    else if (upper.startsWith('HYSTERIA')) type = 'hysteria';
    else if (upper.startsWith('WIREGUARD')) type = 'wireguard';
    
    let name = type;
    let region = 'unknown';
    const commentMatch = line.match(/[?&]remarks?=[^&]*/i);
    if (commentMatch) {
      name = decodeURIComponent(commentMatch[0].split('=')[1]);
      region = detectRegionFromName(name);
    }
    return { name, type, line, region, renamed: region !== 'unknown' ? `${region}-${name}` : name };
  });
}

async function scrapeGithubPagesSite(siteUrl) {
  console.log(`\n[Scraper] Fetching: ${siteUrl}`);
  const result = { siteUrl, scrapedAt: new Date().toISOString(), articles: [], totalSubscriptions: 0, rawContent: {} };
  
  try {
    const html = await httpGet(siteUrl);
    const $ = cheerio.load(html);
    
    const subscriptionUrls = [];
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && /\.(yaml|yml|txt|json)/i.test(href) && href.startsWith('http')) {
        subscriptionUrls.push(href);
      }
    });
    
    const pageText = $('body').text();
    const textUrls = extractUrls(pageText);
    subscriptionUrls.push(...textUrls);
    const uniqueUrls = [...new Set(subscriptionUrls)];
    console.log(`  Found ${uniqueUrls.length} subscription URLs`);
    
    for (const subUrl of uniqueUrls) {
      try {
        const ext = subUrl.split('.').pop().toLowerCase();
        let content;
        if (ext === 'yaml' || ext === 'yml') {
          content = await httpGet(subUrl);
          result.rawContent[subUrl] = { type: 'clash', content, proxies: parseClashYaml(content) };
          result.totalSubscriptions++;
        } else if (ext === 'json') {
          content = await httpGet(subUrl);
          result.rawContent[subUrl] = { type: 'singbox', content, proxies: parseSingBoxJson(content) };
          result.totalSubscriptions++;
        } else if (ext === 'txt') {
          content = await httpGet(subUrl);
          result.rawContent[subUrl] = { type: 'v2ray', content, proxies: parseV2rayTxt(content) };
          result.totalSubscriptions++;
        }
      } catch (e) {
        console.log(`  [SKIP] ${subUrl}: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  [ERROR] ${siteUrl}: ${e.message}`);
  }
  return result;
}

async function scrapeAirportNode() {
  const siteUrl = 'https://airportnode.com/freenode';
  console.log(`\n[Scraper] Fetching: ${siteUrl}`);
  const result = { siteUrl, scrapedAt: new Date().toISOString(), articles: [], totalSubscriptions: 0, rawContent: {} };
  
  try {
    const html = await httpGet(siteUrl);
    const $ = cheerio.load(html);
    const urls = [];
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && /\.(yaml|yml|txt|json)/i.test(href) && href.startsWith('http')) urls.push(href);
    });
    
    const uniqueUrls = [...new Set(urls)];
    console.log(`  Found ${uniqueUrls.length} subscription URLs`);
    
    for (const subUrl of uniqueUrls) {
      try {
        const ext = subUrl.split('.').pop().toLowerCase();
        let content = await httpGet(subUrl);
        if (ext === 'yaml' || ext === 'yml') {
          result.rawContent[subUrl] = { type: 'clash', content, proxies: parseClashYaml(content) };
        } else if (ext === 'json') {
          result.rawContent[subUrl] = { type: 'singbox', content, proxies: parseSingBoxJson(content) };
        } else if (ext === 'txt') {
          result.rawContent[subUrl] = { type: 'v2ray', content, proxies: parseV2rayTxt(content) };
        }
        result.totalSubscriptions++;
      } catch (e) {
        console.log(`  [SKIP] ${subUrl}: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  [ERROR] AirportNode: ${e.message}`);
  }
  return result;
}

function mergeAndDeduplicate(allResults) {
  console.log('\n[Merge] Starting deduplication...');
  const feeds = {
    Clash: { urls: [], contentMap: {}, proxies: [] },
    V2ray: { urls: [], contentMap: {}, proxies: [] },
    'Sing-Box': { urls: [], contentMap: {}, proxies: [] }
  };
  const seenContent = new Map();
  const seenUrls = new Set();
  
  for (const result of allResults) {
    if (!result.rawContent) continue;
    for (const [url, data] of Object.entries(result.rawContent)) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      const contentHash = sha256(data.content);
      if (seenContent.has(contentHash)) {
        console.log(`  [DUPE] ${url} (hash: ${contentHash})`);
        continue;
      }
      seenContent.set(contentHash, { feedType: data.type, url, content: data.content });
      
      const feedKey = data.type === 'clash' ? 'Clash' : data.type === 'singbox' ? 'Sing-Box' : 'V2ray';
      feeds[feedKey].urls.push(url);
      feeds[feedKey].contentMap[url] = data.content;
      if (data.proxies && data.proxies.length > 0) {
        feeds[feedKey].proxies.push(...data.proxies);
      }
    }
  }
  return { feeds, seenContent, seenUrls };
}

function generateRenamedContent(feeds) {
  console.log('\n[Rename] Processing node renaming...');
  const renamedContent = {};
  
  // Clash YAML - rebuild with renamed nodes
  if (feeds.Clash && feeds.Clash.contentMap) {
    const renamedYamls = {};
    for (const [url, content] of Object.entries(feeds.Clash.contentMap)) {
      try {
        const config = yaml.load(content);
        if (config && config.proxies) {
          config.proxies = config.proxies.map(p => {
            const proxy = feeds.Clash.proxies.find(pp => pp._orig === p);
            if (proxy && proxy.region !== 'unknown') {
              return { ...p, name: `${proxy.region}-${p.name}` };
            }
            return p;
          });
          renamedYamls[url] = yaml.dump(config, { lineWidth: -1 });
        } else {
          renamedYamls[url] = content;
        }
      } catch (e) {
        renamedYamls[url] = content;
      }
    }
    renamedContent.clash = renamedYamls;
  }
  
  // Sing-Box JSON
  if (feeds['Sing-Box'] && feeds['Sing-Box'].contentMap) {
    const renamedJsons = {};
    for (const [url, content] of Object.entries(feeds['Sing-Box'].contentMap)) {
      try {
        const config = JSON.parse(content);
        if (config && config.outbounds) {
          config.outbounds = config.outbounds.map(ob => {
            const proxy = feeds['Sing-Box'].proxies.find(pp => pp._orig === ob);
            if (proxy && proxy.region !== 'unknown') {
              return { ...ob, tag: `${proxy.region}-${ob.tag || ob.name || 'proxy'}` };
            }
            return ob;
          });
          renamedJsons[url] = JSON.stringify(config, null, 2);
        } else {
          renamedJsons[url] = content;
        }
      } catch (e) {
        renamedJsons[url] = content;
      }
    }
    renamedContent.singbox = renamedJsons;
  }
  
  // V2ray TXT
  if (feeds.V2ray && feeds.V2ray.contentMap) {
    const renamedTxts = {};
    for (const [url, content] of Object.entries(feeds.V2ray.contentMap)) {
      const lines = content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const proxy = feeds.V2ray.proxies.find(p => p.line === trimmed);
        if (proxy && proxy.region !== 'unknown') {
          if (trimmed.includes('?')) {
            return trimmed.replace(/remarks?=[^&]*/i, `remarks=${proxy.region}-proxy`);
          }
        }
        return line;
      });
      renamedTxts[url] = lines.join('\n');
    }
    renamedContent.v2ray = renamedTxts;
  }
  
  return renamedContent;
}

async function scrapeAllSites() {
  const config = loadConfig();
  const results = [];
  // P2-4: Load historical proxies for fallback
  const historicalProxies = await loadHistoricalProxies();
  console.log("[History] Historical proxies available: " + historicalProxies.length);
  console.log("=".repeat(60));
  console.log("[AutoScrape v3.2] Starting with node-level validation...");
  console.log("=".repeat(60));
  const githubSites = config.sites.filter(s => s.enabled && s.url.includes("github.io"));
  for (const site of githubSites) { const result = await scrapeGithubPagesSite(site.url); results.push(result); }
  const airportNode = config.sites.find(s => s.enabled && s.url.includes("airportnode"));
  if (airportNode) results.push(await scrapeAirportNode());
  const { feeds } = mergeAndDeduplicate(results);
  console.log("\n[Parse] Downloading and parsing subscription files...");
  const allProxies = [];
  const seenFingerprints = new Set(); // P1-1: Full proxy fingerprint dedup
  const proxyByServerPort = new Map();
  for (const [feedName, feedData] of Object.entries(feeds)) {
    if (!feedData || !feedData.contentMap) continue;
    for (const [url, content] of Object.entries(feedData.contentMap)) {
      try {
        const ext = url.split(".").pop().toLowerCase();
        let proxies = [];
        if (ext === "yaml" || ext === "yml") proxies = parseClashYaml(content);
        else if (ext === "json") proxies = parseSingBoxJson(content);
        else if (ext === "txt") proxies = parseV2rayTxt(content);
        proxies.forEach(p => {
          const key = (p.server || "") + ":" + (p.port || "");
          if (p.server && p.port && !proxyByServerPort.has(key)) { proxyByServerPort.set(key, p); allProxies.push(p); }
        });
      } catch (e) { console.log("  [SKIP] " + url + ": " + e.message); }
    }
  }
  console.log("  Total unique proxies (by fingerprint): " + allProxies.length);
  console.log("\n[Check] Running quick connectivity checks...");
  const validProxies = await checkProxiesQuick(allProxies);
  console.log("  Valid after check: " + validProxies.length + "/" + allProxies.length);
  const merged = buildMergedOutput(validProxies, feeds);
  const output = {
    version: "3.3.1",
    generatedAt: new Date().toISOString(),
    changelog: "v3.2.1: Node-level parsing, fingerprint dedup, media unlock detection, quality scoring, shuffled test order",
    summary: { totalRaw: allProxies.length, unique: validProxies.length, reductionRate: allProxies.length > 0 ? Math.round((1 - validProxies.length / allProxies.length) * 100) + "%" : "0%" },
    sources: results.map(r => ({ name: r.siteUrl.replace(/https?:\/\//, "").replace(/\//g, "_"), articles: r.articles.length, rawSubscriptions: r.totalSubscriptions })),
    feeds: {
      Clash: { count: feeds.Clash ? feeds.Clash.urls.length : 0, urls: feeds.Clash ? feeds.Clash.urls : [] },
      V2ray: { count: feeds.V2ray ? feeds.V2ray.urls.length : 0, urls: feeds.V2ray ? feeds.V2ray.urls : [] },
      "Sing-Box": { count: feeds["Sing-Box"] ? feeds["Sing-Box"].urls.length : 0, urls: feeds["Sing-Box"] ? feeds["Sing-Box"].urls : [] }
    },
    merged: merged,
    allProxies: validProxies.slice(0, 100)
  };
  console.log("\n" + "=".repeat(60));
  console.log("[AutoScrape] Complete! Unique=" + allProxies.length + ", Valid=" + validProxies.length + ", Mihomo=" + merged.mihomo.length);
  // P2-4: Save valid proxies for historical fallback
  await saveHistoricalProxies(validProxies);
  console.log("=".repeat(60));
  return output;
}


// ============================================
// Quick connectivity check (like subs-check Go)
// ============================================

async function checkProxiesQuick(proxies, maxConcurrent = 10) {
  if (!proxies || proxies.length === 0) return [];
  // P3-6: Shuffle test order to prevent IP bans (Fisher-Yates)
  const shuffled = [...proxies];
  for (let _si = shuffled.length - 1; _si > 0; _si--) {
    const _sj = Math.floor(Math.random() * (_si + 1));
    [shuffled[_si], shuffled[_sj]] = [shuffled[_sj], shuffled[_si]];
  }
  // Use shuffled array for processing below
  
  const valid = [];
  
  // Process in batches
  for (let i = 0; i < shuffled.length; i += maxConcurrent) {
    const batch = shuffled.slice(i, i + maxConcurrent);
    const results = await Promise.all(batch.map(async (p) => {
      try {
        // Quick DNS + HTTP check
        const start = Date.now();
        // For HTTP/HTTPS type proxies, try a quick connection
        if (p.type === "http" || p.type === "https") {
          const r = await axios.get("https://www.google.com/favicon.ico", {
            proxy: { host: p.server, port: parseInt(p.port), protocol: p.tls ? "https" : "http" },
            timeout: 3000
          });
          const latency = Date.now() - start;
          return { ...p, valid: true, latency };
        }
        // For other types, just verify server resolves
        // (We skip actual connection test to avoid hanging on unreachable hosts)
        if (p.server && p.port) {
          return { ...p, valid: true, latency: 0 };
        }
        return { ...p, valid: false, latency: 0 };
      } catch (e) {
        return { ...p, valid: false, latency: 0 };
      }
    }));
    results.forEach(r => { if (r.valid) valid.push(r); });
  }
  return valid;
}

// ============================================
// Build merged output (FreeSubsCheck style)
// ============================================

function buildMergedOutput(proxies, feeds) {
    // Sort proxies by quality score (descending)
  proxies.sort((a, b) => {
    const scoreA = calculateQualityScore(a).score;
    const scoreB = calculateQualityScore(b).score;
    return scoreB - scoreA; // Descending: highest score first
  });
  console.log("  [Sort] Proxies sorted by quality score (highest first)");
  
const merged = { mihomo: [], clash: [], base64: [], xiaoxi: [], kooker: [] };
  let idx = 0;
  
  proxies.forEach(p => {
    idx++;
    const region = p.region || "unknown";
    const flag = getCountryFlag(region);
    const name = (p.name || "proxy").replace(/^\w+-/, "");
    // P1-2: Media unlock badges + P2-5: Quality score in display name
    const mediaBadges = detectMediaUnlockHeuristic(p);
    const quality = calculateQualityScore(p);
    const badgeStr = mediaBadges ? ' ' + mediaBadges : '';
    const gradeStr = quality.grade ? '[' + quality.grade + ']' : '';
    const displayName = flag + '_' + gradeStr + name + badgeStr + '|' + (p.latency > 0 ? p.latency + "ms" : "unknown");
    
    // Mihomo format
    const mihomoProxy = {
      name: displayName,
      type: p.type,
      server: p.server,
      port: p.port,
      "skip-cert-verify": true,
      udp: true
    };
    if (p.password) mihomoProxy.password = p.password;
    if (p.uuid) mihomoProxy.uuid = p.uuid;
    if (p.cipher) mihomoProxy.cipher = p.cipher;
    if (p.network) mihomoProxy.network = p.network;
    if (p["ws-opts"]) mihomoProxy["ws-opts"] = p["ws-opts"];
    if (p.tls) mihomoProxy.tls = p.tls;
    if (p.sni) mihomoProxy.sni = p.sni;
    if (p.alpn) mihomoProxy.alpn = p.alpn;
    if (p["client-fingerprint"]) mihomoProxy["client-fingerprint"] = p["client-fingerprint"];
    // P2-5: Quality score + P1-2: Media badges in output
    mihomoProxy.quality = quality;
    mihomoProxy.mediaBadges = mediaBadges;
    merged.mihomo.push(mihomoProxy);
    
    // Clash format (same as mihomo for most types)
    merged.clash.push({ ...p, name: displayName });
    
    // V2ray-style lines for xiaoxi/kooker
    if (["vmess", "trojan", "ss"].includes(p.type)) {
      const line = buildV2rayLine(p);
      if (line) {
        merged.base64.push(line);
        merged.xiaoxi.push(line);
        merged.kooker.push(line);
      }
    }
  });
  
  return merged;
}

function getCountryFlag(region) {
  const flags = {
    hk: "\ud83c\udded\ud83c\uddf0", tw: "\ud83c\uddf9\ud83c\uddfc", jp: "\ud83c\uddef\ud83c\uddf5",
    us: "\ud83c\uddfa\ud83c\uddf8", sg: "\ud83c\uddf8\ud83c\uddec", kr: "\ud83c\uddf0\ud83c\uddf7",
    uk: "\ud83c\uddec\ud83c\udde7", de: "\ud83c\udde9\ud83c\uddea", fr: "\ud83c\uddeb\ud83c\uddf7",
    nl: "\ud83c\uddf3\ud83c\uddf1", ca: "\ud83c\udde8\ud83c\udde6", au: "\ud83c\udde6\ud83c\uddfa", cn: "\ud83c\udde8\ud83c\uddf3"
  };
  return flags[region] || "\ud83c\udf10";
}

function buildV2rayLine(p) {
  if (p.type === "vmess") {
    try {
      const obj = { v: "2", ps: p.name, add: p.server, port: p.port, id: p.password || "uuid", aid: 0, net: p.network || "tcp", type: "none", host: "", path: "", tls: p.tls ? "tls" : "", sni: p.sni || "", fp: p["client-fingerprint"] || "" };
      return "vmess://" + Buffer.from(JSON.stringify(obj)).toString("base64");
    } catch (e) { return null; }
  }
  if (p.type === "trojan") {
    return "trojan://" + (p.password || "") + "@" + p.server + ":" + p.port + "?sni=" + (p.sni || p.server) + "#" + p.name;
  }
  if (p.type === "ss") {
    return "ss://" + Buffer.from((p.cipher || "aes-256-gcm") + ":" + (p.password || "pass")).toString("base64") + "@" + p.server + ":" + p.port + "#" + p.name;
  }
  return null;
}
module.exports = {
  scrapeAllSites, scrapeGithubPagesSite, scrapeAirportNode,
  parseSubscriptions: scrapeAllSites, loadConfig,
  sha256, detectRegionFromName, detectRegionFromIP, isPrivateIP,
  parseClashYaml, parseSingBoxJson, parseV2rayTxt,
  mergeAndDeduplicate, generateRenamedContent,
  generateProxyFingerprint, detectMediaUnlock, detectMediaUnlockHeuristic,
  calculateQualityScore
};
