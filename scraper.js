const fs = require('fs-extra');
const path = require('path');
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
  httpGet._delay = httpGet._delay || 3000;
  httpGet._last = httpGet._last || 0;
    const now = Date.now();
  const wait = httpGet._delay - (now - httpGet._last);
  if (wait > 0) { await new Promise(r => setTimeout(r, wait)); }
  httpGet._last = Date.now();
for (let i = 0; i <= retries; i++) {
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        timeout, 
        responseType: 'text', 
        maxRedirects: 5,
        proxy: false
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
    
    // Extract article links from the main page
    const articleUrls = [];
    $('a.xcblog-blog-url').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('/free-nodes/') && href.endsWith('.htm')) {
        // Construct full article URL
        const baseUrl = siteUrl.replace(/\/$/, '');
        articleUrls.push(baseUrl + '/' + href.replace(/^\//, ''));
      }
    });
    console.log(`  Found ${articleUrls.length} article pages`);
    
    // Scrape each article page for subscription URLs
    const maxArticles = 2;
    const articlesToScrape = articleUrls.slice(0, maxArticles);
    console.log(`  Scraping ${articlesToScrape.length} articles (limit: ${maxArticles})`);
    
    for (const articleUrl of articlesToScrape) {
      try {
        const articleHtml = await httpGet(articleUrl, 1, 10000);
        const $article = cheerio.load(articleHtml);
        const articleSubUrls = [];
         $article('a[href]').each((i, elem) => {
          const href = $article(elem).attr('href');
          if (href && /\.(yaml|yml|txt|json)/i.test(href)) {
            const cleanUrl = href.replace(/[\s<>"']+$/, '');
            if (cleanUrl.startsWith('http')) articleSubUrls.push(cleanUrl);
          }
        });
        if (articleSubUrls.length > 0) {
          console.log(`  Found ${articleSubUrls.length} subscription URLs in article`);
          subscriptionUrls.push(...articleSubUrls);
        }
      } catch (e) {
        console.log(`  [SKIP] Article ${articleUrl}: ${e.message}`);
      }
    }
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


// Fetch direct subscription content from raw URLs
async function fetchDirectSubscription(url, description) {
  console.log(`  Fetching direct subscription: ${description}`);
  try {
    const content = await httpGet(url, 1, 10000);
    if (!content || content.length < 10) {
      console.log(`    [SKIP] Empty or invalid content from ${url}`);
      return null;
    }
    
    const result = {
      siteUrl: url,
      scrapedAt: new Date().toISOString(),
      articles: [],
      totalSubscriptions: 1,
      rawContent: {}
    };
    
    // Determine type based on URL extension
    const ext = url.split('.').pop().toLowerCase();
    if (ext === 'yaml' || ext === 'yml') {
      result.rawContent[url] = { 
        type: 'clash', 
        content, 
        proxies: parseClashYaml(content) 
      };
    } else if (ext === 'txt') {
      result.rawContent[url] = { 
        type: 'v2ray', 
        content, 
        proxies: parseV2rayTxt(content) 
      };
    }
    
    console.log(`    Found ${result.rawContent[url]?.proxies?.length || 0} proxies`);
    return result;
  } catch (e) {
    console.log(`    [ERROR] Failed to fetch ${url}: ${e.message}`);
    return null;
  }
}

async function scrapeAllSites() {
  const config = loadConfig();
  const results = [];
  
  console.log('='.repeat(60));
  console.log('[AutoScrape] Starting node scrape...');
  console.log('='.repeat(60));
  
  // Handle direct subscription URLs
  const directSites = config.sites.filter(s => s.enabled && s.type === 'direct');
  for (const site of directSites) {
    const result = await fetchDirectSubscription(site.url, site.description);
    if (result) {
      results.push(result);
    }
  }

  // Scrape GitHub Pages sites (legacy support)
  // Merge and deduplicate
  const { feeds, seenContent, seenUrls } = mergeAndDeduplicate(results);
  
  // Generate renamed content
  const renamedContent = generateRenamedContent(feeds);
  
  const output = {
    version: '3.3.1',
    generatedAt: new Date().toISOString(),
    changelog: 'v3.3.1: Added IP detection, node renaming, content dedup, 3-feed consolidation',
    summary: {
      totalRaw: seenUrls.size,
      unique: seenContent.size,
      reductionRate: seenUrls.size > 0 ? Math.round((1 - seenContent.size / seenUrls.size) * 100) + '%' : '0%',
      feeds: {
        Clash: feeds.Clash.urls.length,
        V2ray: feeds.V2ray.urls.length,
        'Sing-Box': feeds['Sing-Box'].urls.length
      }
    },
    sources: results.map(r => ({
      name: r.siteUrl.replace(/https?:\/\//, '').replace(/\//g, '_'),
      articles: r.articles.length,
      rawSubscriptions: r.totalSubscriptions
    })),
    feeds: {
      Clash: { count: feeds.Clash.urls.length, urls: feeds.Clash.urls, renamedContent: renamedContent.clash || {} },
      V2ray: { count: feeds.V2ray.urls.length, urls: feeds.V2ray.urls, renamedContent: renamedContent.v2ray || {} },
      'Sing-Box': { count: feeds['Sing-Box'].urls.length, urls: feeds['Sing-Box'].urls, renamedContent: renamedContent.singbox || {} }
    },
    renamedProxies: {
      Clash: feeds.Clash.proxies,
      V2ray: feeds.V2ray.proxies,
      'Sing-Box': feeds['Sing-Box'].proxies
    },
    merged: {
      mihomo: [],
      clash: [],
      base64: [],
      xiaoxi: [],
      kooker: []
    },
  };
  
  console.log('\n' + '='.repeat(60));
  console.log('[AutoScrape] Complete!');
  console.log(`  Clash: ${output.feeds.Clash.count} URLs`);
  console.log(`  V2ray: ${output.feeds.V2ray.count} URLs`);
  console.log(`  Sing-Box: ${output.feeds['Sing-Box'].count} URLs`);
  console.log(`  Unique: ${output.summary.unique}`);
  console.log('='.repeat(60));
  
  
  // === Write output files to root directory ===
  const ROOT_DIR = __dirname;

  // Collect all proxy objects from all feeds WITH PROXY-LEVEL DEDUPLICATION
  let allProxies = [];
  const proxySet = new Set();
  const proxyByServerPort = new Map(); // Track server:port for dedup
  
  // Enhanced dedup: keep the proxy with HIGHEST quality score when server:port matches
  function addProxyDeduped(p) {
    const key = p.server + ':' + p.port;
    if (proxyByServerPort.has(key)) {
      const existing = proxyByServerPort.get(key);
      const existingScore = existing.qualityScore || 0;
      const newScore = p.qualityScore || 0;
      if (newScore > existingScore) {
        // Replace with higher-scored proxy
        proxyByServerPort.set(key, p);
        // Update allProxies: remove old, add new
        const idx = allProxies.findIndex(x => x.server === existing.server && x.port === existing.port);
        if (idx >= 0) allProxies.splice(idx, 1);
        allProxies.push(p);
      }
      return; // Keep existing (higher score)
    }
    proxyByServerPort.set(key, p);
    allProxies.push(p);
  }

  // Extract from Clash renamed content
  if (renamedContent.clash) {
    for (const [url, yamlContent] of Object.entries(renamedContent.clash)) {
      try {
        const config = yaml.load(yamlContent);
        if (config && config.proxies) {
          for (const p of config.proxies) {
            const key = p.name + "|" + (p.server || "") + "|" + (p.port || "");
            if (!proxySet.has(key)) {
              proxySet.add(key);
              allProxies.push(convertYamlProxyToEntry(p));
            }
          }
        }
      } catch (e) { /* skip invalid yaml */ }
    }
  }

  // Extract from V2ray renamed content (TXT lines)
  if (renamedContent.v2ray) {
    for (const [url, txtContent] of Object.entries(renamedContent.v2ray)) {
      const lines = txtContent.split("\n").map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        if (!proxySet.has(line)) {
          proxySet.add(line);
          const parsed = parseV2rayLineToEntry(line);
          if (parsed) allProxies.push(parsed);
        }
      }
    }
  }

  // Extract from Sing-Box renamed content
  if (renamedContent.singbox) {
    for (const [url, jsonContent] of Object.entries(renamedContent.singbox)) {
      try {
        const config = JSON.parse(jsonContent);
        if (config && config.outbounds) {
          for (const ob of config.outbounds) {
            if (ob.type && ob.type !== "direct" && ob.type !== "block") {
              const key = ob.tag + "|" + (ob.server || "") + "|" + (ob.port || "");
              if (!proxySet.has(key)) {
                proxySet.add(key);
                allProxies.push(convertSingBoxToEntry(ob));
              }
            }
          }
        }
      } catch (e) { /* skip */ }
    }
  }

  
  // ========== NODE VALIDITY CHECKING ==========
  console.log(`[Check] Testing node validity (TCP connect)...`);
  const TIMEOUT_MS = 6000;
  const CONCURRENCY = 50;

  function checkTcpNode(p) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { resolve(false); }, TIMEOUT_MS);
      const net = require(`net`);
      const client = net.connect(Number(p.port), p.server, () => {
        clearTimeout(timer);
        client.destroy();
        resolve(true);
      });
      client.on(`error`, () => { clearTimeout(timer); resolve(false); });
      client.on(`timeout`, () => { clearTimeout(timer); client.destroy(); resolve(false); });
    });
  }

  async function runChecks(proxies) {
    const valid = [];
    let checked = 0;
    const total = proxies.length;
    for (let i = 0; i < proxies.length; i += CONCURRENCY) {
      const batch = proxies.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(p => checkTcpNode(p)));
      for (let j = 0; j < batch.length; j++) {
        checked++;
        if (results[j]) valid.push(batch[j]);
        if (checked % 500 === 0 || checked === total) {
          console.log(`  [Check] ${checked}/${total} checked (${Math.round(checked/total*100)}%)`);
        }
      }
    }
    return valid;
  }

  const checkStart = Date.now();
  allProxies = await runChecks(allProxies);
  const checkTime = ((Date.now() - checkStart) / 1000).toFixed(1);
  console.log(`  [Check] Done in ${checkTime}s. Valid: ${allProxies.length}`);
  // ==============================================
if (allProxies.length > 0) {
    console.log("\n[Output] Writing " + allProxies.length + " proxies to root directory...");

    const regionPriority = { us: 1, hk: 2, tw: 3, jp: 4, sg: 5, kr: 6, uk: 7, de: 8, ca: 9, au: 10, nl: 11, fr: 12, unknown: 99, cloud: 98 };
    allProxies.sort((a, b) => {
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
      return (regionPriority[a._region] || 99) - (regionPriority[b._region] || 99);
    });
    console.log("  Sorted " + allProxies.length + " proxies by quality score and region");
    // 1. mihomo.yaml
    const mihomoConfig = {
      "mixed-port": 7890, "allow-lan": true, "mode": "rule", "log-level": "info",
      "ipv6": true, "external-controller": "0.0.0.0:9090",
      "dns": {
        "enabled": true, "listen": "0.0.0.0:1053", "ipv6": true,
        "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/16",
        "fake-ip-filter": ["*.lan", "*.local"],
        "default-nameserver": ["223.5.5.5", "119.29.29.29"],
        "nameserver": ["https://dns.alidns.com/dns-query"],
        "fallback": ["https://dns.google/dns-query"],
      },
      "proxies": allProxies,
      "proxy-groups": [
        { "name": "\uD83D\uDE80 节点选择", "type": "select", "proxies": ["\u267B\uFE0F 自动选择", "\uD83D\uDD31 故障转移"] },
        { "name": "\u267B\uFE0F 自动选择", "type": "url-test", "url": "http://www.gstatic.com/generate_204", "interval": 300, "tolerance": 50, "proxies": allProxies.map(p => p.name) },
        { "name": "\uD83D\uDD31 故障转移", "type": "fallback", "url": "http://www.gstatic.com/generate_204", "interval": 60, "proxies": allProxies.slice(0, Math.min(10, allProxies.length)).map(p => p.name) },
        { "name": "\uD83C\uDF0F 全球直连", "type": "select", "proxies": ["DIRECT"] },
        { "name": "\uD83D\uDC1F 漏网之鱼", "type": "select", "proxies": ["\uD83D\uDE80 节点选择", "\uD83C\uDF0F 全球直连"] },
      ],
      "rules": [
        "GEOSITE,category-ads-all,DIRECT",
        "GEOSITE,cn,\uD83C\uDF0F 全球直连",
        "GEOIP,CN,\uD83C\uDF0F 全球直连,no-resolve",
        "GEOIP,LAN,\uD83C\uDF0F 全球直连,no-resolve",
        "MATCH,\uD83D\uDC1F 漏网之鱼",
      ],
    };
    fs.writeFileSync(path.join(ROOT_DIR, "mihomo.yaml"), yaml.dump(mihomoConfig, { lineWidth: -1, noRefs: true }), "utf8");
    console.log("  OK mihomo.yaml");

    // 2. all.yaml
    fs.writeFileSync(path.join(ROOT_DIR, "all.yaml"), yaml.dump({ proxies: allProxies }, { lineWidth: -1, noRefs: true }), "utf8");
    console.log("  OK all.yaml");

    // 3. base64.txt
    const base64Lines = [];
    for (const p of allProxies) {
      const uri = buildUri(p);
      if (uri) base64Lines.push(uri);
    }
    fs.writeFileSync(path.join(ROOT_DIR, "base64.txt"), base64Lines.join("\n") + "\n", "utf8");
    console.log("  OK base64.txt (" + base64Lines.length + " entries)");

    // 4. byxiaoxi.txt
    fs.writeFileSync(path.join(ROOT_DIR, "byxiaoxi.txt"), base64Lines.join("\n") + "\n", "utf8");
    console.log("  OK byxiaoxi.txt");

    // 5. kooker.jp.txt
    const kookerLines = [];
    for (const p of allProxies) {
      const region = (p._region || "unknown").toLowerCase();
      const flag = getFlagEmoji(region);
      const country = getCountryName(region);
      const displayName = flag + " " + country + " " + cleanProxyName(p.name);
      const uri = buildUri(p, displayName);
      if (uri) kookerLines.push(uri);
    }
    fs.writeFileSync(path.join(ROOT_DIR, "kooker.jp.txt"), kookerLines.join("\n") + "\n", "utf8");
    console.log("  OK kooker.jp.txt (" + kookerLines.length + " entries)");

    console.log("[Output] All files written to root directory.");
  } else {
    console.log("[Output] No proxies to write.");
  }


  // Update README with results
  updateREADME(allProxies, output);

return output;
}


// ============================================
// Helper functions for output file generation
// ============================================

const FLAG_EMOJI_MAP = {
  hk: "\uD83C\uDDED\uD83C\uDDF0", tw: "\uD83C\uDDF9\uD83C\uDDFC", jp: "\uD83C\uDDF0\uD83C\uDDF5",
  us: "\uD83C\uDDFA\uD83C\uDDF8", sg: "\uD83C\uDDF8\uD83C\uDEC0", kr: "\uD83C\uDDF0\uD83C\uDDF7",
  uk: "\uD83C\uDDFA\uD83C\uDDF7", de: "\uD83C\uDDE9\uD83C\uDDEA", fr: "\uD83C\uDDEB\uD83C\uDDF7",
  nl: "\uD83C\uDDF3\uD83C\uDDF1", ca: "\uD83C\uDDE8\uD83C\uDDE6", au: "\uD83C\uDD66\uD83C\uDDFA",
  cn: "\uD83C\uDDE8\uD83C\uDDF3", ro: "\uD83C\uDDF7\uD83C\uDDF4", fi: "\uD83C\uDDEB\uD83C\uDDEE",
  in: "\uD83C\uDDEE\uD83C\uDDF3", br: "\uD83C\uDDE7\uD83C\uDDF7", se: "\uD83C\uDDF8\uD83C\uDD6A",
  ch: "\uD83C\uDDE8\uD83C\uDDED", it: "\uD83C\uDDEE\uD83C\uDDF9", es: "\uD83C\uDDEA\uD83C\uDDF8",
  id: "\uD83C\uDDEE\uD83C\uDDE9", th: "\uD83C\uDDF9\uD83C\uDDED", vn: "\uD83C\uDDFB\uD83C\uDDF3",
};

const COUNTRY_NAMES_MAP = {
  hk: "香港", tw: "台湾", jp: "日本", us: "美国", sg: "新加坡", kr: "韩国",
  uk: "英国", de: "德国", fr: "法国", nl: "荷兰", ca: "加拿大", au: "澳大利亚",
  cn: "中国", ro: "罗马尼亚", fi: "芬兰", in: "印度", br: "巴西", se: "瑞典",
  ch: "瑞士", it: "意大利", es: "西班牙", id: "印尼", th: "泰国", vn: "越南",
};

function getFlagEmoji(region) { return FLAG_EMOJI_MAP[region] || "\uD83C\uDF10"; }
function getCountryName(region) { return COUNTRY_NAMES_MAP[region] || region; }

function cleanProxyName(name) {
  if (!name) return "proxy";
  let s = name.replace(/^\w+-/, "").replace(/^[[\u{1F1E0}-\u{1F1FF}]+/gu, "").trim();
  return s || "proxy";
}

function buildDisplayName(p) {
  const region = (p._region || "unknown").toLowerCase();
  const flag = getFlagEmoji(region);
  const countryName = getCountryName(region) || region;
  const speed = p.speed || "unknown";
  const score = p.qualityScore || 0;
  return flag + countryName + "|" + speed + "|" + score + "分";
}

function buildUri(p, customName) {
  const name = customName || buildDisplayName(p);
  let uri = "";
  const t = p.type;
  if (t === "vmess") {
    try {
      const obj = { v: "2", ps: name, add: p.server, port: p.port, id: p.password || p.uuid || "uuid", aid: 0, net: p.network || "tcp", type: "none", host: "", path: "", tls: p.tls ? "tls" : "", sni: p.sni || "" };
      uri = "vmess://" + Buffer.from(JSON.stringify(obj)).toString("base64");
    } catch (e) {}
  } else if (t === "trojan") {
    const qp = new URLSearchParams();
    if (p.sni) qp.set("sni", p.sni);
    if (p.network) qp.set("type", p.network);
    if (p["ws-opts"] && p["ws-opts"].path) qp.set("path", p["ws-opts"].path);
    const qs = qp.toString();
    uri = "trojan://" + (p.password || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
  } else if (t === "ss") {
    const enc = Buffer.from((p.cipher || "aes-256-gcm") + ":" + (p.password || "pass")).toString("base64");
    uri = "ss://" + enc + "@" + p.server + ":" + p.port + "#" + name;
  } else if (t === "vless") {
    const qp = new URLSearchParams();
    if (p.security) qp.set("security", p.security);
    if (p.type_param) qp.set("type", p.type_param);
    if (p.sni) qp.set("sni", p.sni);
    if (p.fp) qp.set("fp", p.fp);
    if (p.flow) qp.set("flow", p.flow);
    if (p.pbk) qp.set("pbk", p.pbk);
    if (p.sid) qp.set("sid", p.sid);
    if (p.spk) qp.set("spk", p.spk);
    if (p.subType) qp.set("subType", p.subType);
    if (p.headerType) qp.set("headerType", p.headerType);
    if (p.host) qp.set("host", p.host);
    if (p.path) qp.set("path", p.path);
    if (p.mode) qp.set("mode", p.mode);
    if (p.serviceName) qp.set("serviceName", p.serviceName);
    if (p.alpn) qp.set("alpn", p.alpn);
    if (p.encryption) qp.set("encryption", p.encryption);
    const qs = qp.toString();
    uri = "vless://" + (p.uuid || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
  } else if (t === "hysteria2" || t === "hysteria") {
    const qp = new URLSearchParams();
    if (p.insecure !== undefined) qp.set("insecure", p.insecure ? "1" : "0");
    if (p.sni) qp.set("sni", p.sni);
    if (p.obfs) qp.set("obfs", p.obfs);
    if (p["obfs-password"]) qp.set("obfs-password", p["obfs-password"]);
    const qs = qp.toString();
    const proto = t === "hysteria" ? "hysteria" : "hysteria2";
    uri = proto + "://" + (p.password || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
  } else if (t === "tuic") {
    const qp = new URLSearchParams();
    if (p.uuid) qp.set("uuid", p.uuid);
    if (p.sni) qp.set("sni", p.sni);
    if (p.congestion_control) qp.set("congestion_control", p.congestion_control);
    if (p.udp_relay_mode) qp.set("udp_relay_mode", p.udp_relay_mode);
    if (p.alpn) qp.set("alpn", p.alpn);
    if (p.allow_insecure !== undefined) qp.set("allow_insecure", p.allow_insecure);
    const qs = qp.toString();
    uri = "tuic://" + (p.uuid || "") + ":" + (p.password || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
  } else if (t === "http" || t === "https") {
    const qp = new URLSearchParams();
    if (p.tls) qp.set("tls", "true");
    if (p.sni) qp.set("sni", p.sni);
    const qs = qp.toString();
    uri = t + "://" + (p.username || "") + ":" + (p.password || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
  }
  return uri;
}

function yamlProxyToEntry(p) {
  const entry = {
    name: buildDisplayName(p), type: p.type, server: p.server, port: p.port,
    "skip-cert-verify": true, udp: true,
  };
  const fields = ["password","uuid","cipher","network","tls","sni","alpn","flow","mode","congestion","reserved","security","type_param","spk","subType","headerType","host","path","serviceName","encryption"];
  for (const f of fields) { if (p[f] !== undefined) entry[f] = p[f]; }
  const wsFields = ["ws-opts","client-fingerprint","obfs","obfs-password","udp_relay_mode","congestion_control","allow_insecure","pbk","sid"];
  for (const f of wsFields) {
    const key = f === "ws-opts" ? "ws-opts" : f === "udp_relay_mode" ? "udp-relay-mode" : f;
    if (p[f] !== undefined) entry[key] = p[f];
  }
  if (p._region) entry._region = p._region;
  if (p.speed) entry.speed = p.speed;
  if (p.latency) entry.latency = p.latency;
  if (p.qualityScore !== undefined) entry.qualityScore = p.qualityScore;
  return entry;
}

function convertYamlProxyToEntry(p) {
  let region = "unknown";
  const nameLower = (p.name || "").toLowerCase().replace(/[_\-\s]/g, "");
  for (const [key, val] of Object.entries(IP_REGION_MAP)) {
    if (nameLower.includes(key.toLowerCase())) { region = val; break; }
  }
  
  let score = 50;
  const ipClass = detectRegionFromIP(p.server || "");
  if (ipClass !== "cloud") score += 20;
  if (region !== "unknown") score += 15;
  if (p.tls || p.type === "trojan" || p.type === "vless") score += 5;
  if (p.udp) score += 5;
  p.qualityScore = Math.min(100, score);
  
  p._region = region;
  p.speed = p.speed || "unknown";
  p.latency = p.latency || 0;
  return yamlProxyToEntry(p);
}

function parseV2rayLineToEntry(line) {
  try {
    const protoEnd = line.indexOf("://");
    if (protoEnd < 0) return null;
    const proto = line.substring(0, protoEnd);
    let rest = line.substring(protoEnd + 7);
    let name = "";
    const hashIdx = rest.lastIndexOf("#");
    if (hashIdx >= 0) {
      name = decodeURIComponent(rest.substring(hashIdx + 1));
      rest = rest.substring(0, hashIdx);
    }
    const region = detectRegionFromName(name);
    if (proto === "vmess") {
      const decoded = Buffer.from(rest, "base64").toString("utf8");
      const obj = JSON.parse(decoded);
      return { name: name || "vmess", type: "vmess", server: obj.add, port: parseInt(obj.port) || 443, uuid: obj.id, password: obj.id, network: obj.net || "tcp", tls: obj.tls === "tls", sni: obj.sni || "", _region: region, speed: "unknown", latency: 0, qualityScore: 65 };
    } else if (proto === "trojan") {
      const atIdx = rest.lastIndexOf("@");
      if (atIdx < 0) return null;
      const passwd = rest.substring(0, atIdx);
      const srvPort = rest.substring(atIdx + 1);
      const colonIdx = srvPort.indexOf("?");
      const srvPart = colonIdx >= 0 ? srvPort.substring(0, colonIdx) : srvPort;
      const lastColon = srvPart.lastIndexOf(":");
      const server = srvPart.substring(0, lastColon);
      const port = parseInt(srvPart.substring(lastColon + 1)) || 443;
      const qp = colonIdx >= 0 ? new URLSearchParams(srvPort.substring(colonIdx + 1)) : new URLSearchParams();
      return { name: name || "trojan", type: "trojan", server: server || "", port: port, password: passwd, sni: qp.get("sni") || "", network: qp.get("type") || "", _region: region, speed: "unknown", latency: 0, qualityScore: 75 };
    } else if (proto === "ss") {
      const atIdx = rest.lastIndexOf("@");
      if (atIdx < 0) return null;
      const enc = rest.substring(0, atIdx);
      const srvPort = rest.substring(atIdx + 1);
      const hashInSrv = srvPort.indexOf("#");
      const srvClean = hashInSrv >= 0 ? srvPort.substring(0, hashInSrv) : srvPort;
      const lastColon = srvClean.lastIndexOf(":");
      const server = srvClean.substring(0, lastColon);
      const port = parseInt(srvClean.substring(lastColon + 1)) || 8388;
      const decoded = Buffer.from(enc, "base64").toString("utf8");
      const colonIdx2 = decoded.indexOf(":");
      const cipher = decoded.substring(0, colonIdx2);
      const password = decoded.substring(colonIdx2 + 1);
      return { name: name || "ss", type: "ss", server: server || "", port: port, cipher: cipher || "aes-256-gcm", password: password || "pass", _region: region, speed: "unknown", latency: 0, qualityScore: 60 };
    } else if (proto === "vless") {
      const atIdx = rest.lastIndexOf("@");
      if (atIdx < 0) return null;
      const uuid = rest.substring(0, atIdx);
      const srvPort = rest.substring(atIdx + 1);
      const qIdx = srvPort.indexOf("?");
      const srvClean = qIdx >= 0 ? srvPort.substring(0, qIdx) : srvPort;
      const lastColon = srvClean.lastIndexOf(":");
      const server = srvClean.substring(0, lastColon);
      const port = parseInt(srvClean.substring(lastColon + 1)) || 443;
      const qp = qIdx >= 0 ? new URLSearchParams(srvPort.substring(qIdx + 1)) : new URLSearchParams();
      return { name: name || "vless", type: "vless", server: server || "", port: port, uuid: uuid, security: qp.get("security") || "", sni: qp.get("sni") || "", flow: qp.get("flow") || "", _region: region, speed: "unknown", latency: 0, qualityScore: 80 };
    } else if (proto === "hysteria2" || proto === "hysteria") {
      const atIdx = rest.lastIndexOf("@");
      if (atIdx < 0) return null;
      const passwd = rest.substring(0, atIdx);
      const srvPort = rest.substring(atIdx + 1);
      const hashInSrv = srvPort.indexOf("#");
      const srvClean = hashInSrv >= 0 ? srvPort.substring(0, hashInSrv) : srvPort;
      const lastColon = srvClean.lastIndexOf(":");
      const server = srvClean.substring(0, lastColon);
      const port = parseInt(srvClean.substring(lastColon + 1)) || 443;
      return { name: name || "hysteria2", type: proto === "hysteria" ? "hysteria" : "hysteria2", server: server || "", port: port, password: passwd, _region: region, speed: "unknown", latency: 0, qualityScore: 70 };
    } else if (proto === "http" || proto === "https") {
      const atIdx = rest.lastIndexOf("@");
      if (atIdx < 0) return null;
      const creds = rest.substring(0, atIdx);
      const colonIdx = creds.indexOf(":");
      const username = creds.substring(0, colonIdx);
      const password = creds.substring(colonIdx + 1);
      const srvPort = rest.substring(atIdx + 1);
      const hashInSrv = srvPort.indexOf("#");
      const srvClean = hashInSrv >= 0 ? srvPort.substring(0, hashInSrv) : srvPort;
      const lastColon = srvClean.lastIndexOf(":");
      const server = srvClean.substring(0, lastColon);
      const port = parseInt(srvClean.substring(lastColon + 1)) || 80;
      return { name: name || proto, type: proto, server: server || "", port: port, username: username || "", password: password || "", tls: proto === "https", _region: region, speed: "unknown", latency: 0, qualityScore: 55 };
    }
  } catch (e) { return null; }
  return null;
}

function convertSingBoxToEntry(ob) {
  const typeMap = { shadowsocks: "ss", vmess: "vmess", trojan: "trojan", vless: "vless", hysteria: "hysteria2", tuic: "tuic", http: "http", socks: "socks" };
  const t = typeMap[ob.type] || ob.type;
  const name = ob.tag || ob.name || "proxy";
  const region = detectRegionFromName(name);
  let score = 50;
  if (detectRegionFromIP(ob.server || "") !== "cloud") score += 20;
  if (region !== "unknown") score += 15;
  if (t === "vless" || t === "trojan") score += 5;
  if (ob.tls?.enabled) score += 5;
  return { name: name, type: t, server: ob.server || "", port: ob.port || 443, uuid: ob.uuid || "", password: ob.password || "", cipher: ob.cipher || "", network: ob.transport?.type || "", tls: ob.tls?.enabled || false, sni: ob.tls?.server || "", _region: region, speed: "unknown", latency: 0, qualityScore: Math.min(100, score) };
}


// ========== QUALITY SCORING ==========
function calculateQualityScore(p) {
  let score = 50;
  if (p.server && detectRegionFromIP(p.server) !== "cloud") score += 20;
  if (p._region && p._region !== "unknown") score += 15;
  if (p.type === "vless" || p.type === "trojan") score += 5;
  if (p.tls) score += 5;
  if (p.udp_relay_mode || p["udp-relay-mode"]) score += 5;
  return Math.min(100, score);
}

// ========== README UPDATE ==========
function updateREADME(validProxies, output) {
  const readmePath = path.join(__dirname, "README.md");
  let readme = "";
  try { readme = fs.readFileSync(readmePath, "utf8"); } catch(e) { return; }

  const now = new Date();
  const cnTime = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const isoTime = now.toISOString();
  const validCount = validProxies.length;
  const avgScore = validCount > 0 ? Math.round(validProxies.reduce((s, p) => s + (p.qualityScore || 0), 0) / validCount) : 0;
  const byRegion = {};
  for (const p of validProxies) {
    const r = (p._region || "unknown").toLowerCase();
    byRegion[r] = (byRegion[r] || 0) + 1;
  }

  let regionStats = "";
  const sortedRegions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  for (const [region, count] of sortedRegions) {
    const cname = COUNTRY_NAMES_MAP[region] || region;
    regionStats += "- **" + cname + "**: " + count + " nodes\n";
  }

  let feedLinks = "- **Mihomo / Clash Meta**: [mihomo.yaml](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/mihomo.yaml)\n";
  feedLinks += "- **Clash / Standard**: [all.yaml](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/all.yaml)\n";
  feedLinks += "- **Base64 (通用)**: [base64.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/base64.txt)\n";
  feedLinks += "- **通用TXT (XiaoXi)**: [byxiaoxi.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/byxiaoxi.txt)\n";
  feedLinks += "- **通用TXT (kooker.jp)**: [kooker.jp.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/kooker.jp.txt)\n";

  const timeRegex = /\*\*最后同步时间\*\*[^]*?>?\*\*ISO 时间\*\*[^\n]*/;
  const newTimeSection = "**最后同步时间**：" + cnTime + " (北京时间)\n> **ISO 时间**：" + isoTime;
  readme = readme.replace(timeRegex, newTimeSection);

  const statsRegex = /### [\u{1F4CA}\s]*节点统计[^]*?(?=---)/su;
  let newStats = "### 节点统计\n- **\u6709\u6548\u8282\u70b9\u6570**: " + validCount + "\n- **\u5e73\u5747\u8d28\u91cf\u5206**: " + avgScore + "/100\n- **\u603b\u8d28\u91cf\u5206**: " + (validCount * avgScore) + "\n\n### \ud83c\udf0d \u5730\u533a\u5206\u5e03\n" + regionStats + "\n### \ud83d\ude80 \u8ba2\u9605\u94fe\u63a5\n" + feedLinks;
  readme = readme.replace(statsRegex, newStats);

  fs.writeFileSync(readmePath, readme, "utf8");
  console.log("  [README] Updated with " + validCount + " valid nodes, avg score " + avgScore);
}
module.exports = {
  scrapeAllSites, scrapeGithubPagesSite, scrapeAirportNode,
  parseSubscriptions: scrapeAllSites, loadConfig,
  sha256, detectRegionFromName, detectRegionFromIP, isPrivateIP,
  parseClashYaml, parseSingBoxJson, parseV2rayTxt,
  mergeAndDeduplicate, generateRenamedContent
};

if (require.main === module) {
  scrapeAllSites().catch(function(err) {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}
