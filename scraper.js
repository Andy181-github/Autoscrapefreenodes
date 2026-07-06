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
  for (const [key, region] of Object.entries(IP_REGION_MAP)) {
    if (lower.includes(key.toLowerCase())) return region;
  }
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase())) return region;
    }
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
  
  console.log('='.repeat(60));
  console.log('[AutoScrape] Starting node scrape...');
  console.log('='.repeat(60));
  
  // Scrape GitHub Pages sites
  const githubSites = config.sites.filter(s => s.enabled && s.url.includes('github.io'));
  for (const site of githubSites) {
    const result = await scrapeGithubPagesSite(site.url);
    results.push(result);
  }
  
  // Scrape AirportNode
  const airportNode = config.sites.find(s => s.enabled && s.url.includes('airportnode'));
  if (airportNode) {
    results.push(await scrapeAirportNode());
  }
  
  // Merge and deduplicate
  const { feeds, seenContent, seenUrls } = mergeAndDeduplicate(results);
  
  // Generate renamed content
  const renamedContent = generateRenamedContent(feeds);
  
  const output = {
    version: '3.0.0',
    generatedAt: new Date().toISOString(),
    changelog: 'v3.0.0: Added IP detection, node renaming, content dedup, 3-feed consolidation',
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
    }
  };
  
  console.log('\n' + '='.repeat(60));
  console.log('[AutoScrape] Complete!');
  console.log(`  Clash: ${output.feeds.Clash.count} URLs`);
  console.log(`  V2ray: ${output.feeds.V2ray.count} URLs`);
  console.log(`  Sing-Box: ${output.feeds['Sing-Box'].count} URLs`);
  console.log(`  Unique: ${output.summary.unique}`);
  console.log('='.repeat(60));
  
  return output;
}

module.exports = {
  scrapeAllSites, scrapeGithubPagesSite, scrapeAirportNode,
  parseSubscriptions: scrapeAllSites, loadConfig,
  sha256, detectRegionFromName, detectRegionFromIP, isPrivateIP,
  parseClashYaml, parseSingBoxJson, parseV2rayTxt,
  mergeAndDeduplicate, generateRenamedContent
};
