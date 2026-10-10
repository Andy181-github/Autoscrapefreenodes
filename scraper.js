const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const yaml = require('js-yaml');

// Import logger
const logger = require('./logger');

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

// L2 磁盘缓存 - 持久化存储减少重复请求
class DiskCache {
  constructor(cacheDir = '.cache') {
    this.cacheDir = path.join(__dirname, cacheDir);
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  get(key) {
    try {
      const filePath = path.join(this.cacheDir, `${sha256(key)}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // 检查过期时间 (24小时)
        if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
          return data.content;
        }
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      // Ignore read errors
    }
    return null;
  }

  set(key, content) {
    try {
      const filePath = path.join(this.cacheDir, `${sha256(key)}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        key,
        content,
        timestamp: Date.now(),
        size: content.length
      }));
    } catch (e) {
      // Ignore write errors
    }
  }

  clear() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      files.forEach(f => fs.unlinkSync(path.join(this.cacheDir, f)));
    } catch (e) {
      // Ignore clear errors
    }
  }
}

const diskCache = new DiskCache();

// L1 内存缓存 + L2 磁盘缓存 (prevents duplicate fetching)
const HTTP_CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedOrFetch(url, options) {
  const cacheKey = url;
  const now = Date.now();

  // 先检查 L1 内存缓存
  if (HTTP_CACHE.has(cacheKey)) {
    const cached = HTTP_CACHE.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL) {
      logger.debug(`L1 Cache hit: ${url.substring(0, 50)}...`);
      return cached.data;
    }
    HTTP_CACHE.delete(cacheKey);
  }

  // 再检查 L2 磁盘缓存
  const diskData = diskCache.get(cacheKey);
  if (diskData !== null) {
    // 回填 L1 缓存
    HTTP_CACHE.set(cacheKey, { data: diskData, timestamp: now });
    logger.debug(`L2 Cache hit: ${url.substring(0, 50)}...`);
    return diskData;
  }

  return null;
}

function setCache(url, data) {
  const now = Date.now();
  // 写入 L1 内存缓存
  HTTP_CACHE.set(url, { data, timestamp: now });
  // 异步写入 L2 磁盘缓存
  diskCache.set(url, data);
  
  // 限制 L1 缓存大小
  if (HTTP_CACHE.size > 1000) {
    const firstKey = HTTP_CACHE.keys().next().value;
    HTTP_CACHE.delete(firstKey);
  }
}

// HTTP GET with L1 memory + L2 disk cache, optional rate limit and retries
// (uses module-level throttle state: httpGet._delay / httpGet._last / CACHE_TTL)
async function httpGet(url, retries = 2, timeout = 15000) {
  // Check cache first
  const cached = getCachedOrFetch(url);
  if (cached) return cached;

  // Rate limiting: throttle requests to avoid hammering upstream
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
      setCache(url, r.data);
      return r.data;
    } catch (e) {
      if (i === retries) throw e;
      console.log(`  [WARN] Retry ${i+1}/${retries} for ${url}: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
  // Unreachable: the loop above either returns (success) or throws (final retry).
  // Defensive return so the function cannot silently yield `undefined`.
  return null;
}

// Pre-compiled regex for performance
const URL_REGEX = /https?:\/\/[^\s<>"']+(?:\.yaml|\.yml|\.txt|\.json)[^\s<>"']*/g;
const PROXY_LINE_REGEX = /^(vmess|trojan|ss|ssr|http|socks|tuic|hysteria|wireguard):\/\//i;

function extractUrls(text) {
  const matches = text.match(URL_REGEX) || [];
  return [...new Set(matches)];
}

function extractProxyLines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && PROXY_LINE_REGEX.test(l));
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

// 遗留抓取器 (legacy scraper): 用于 GitHub Pages 站点文章列表抓取 (xcblog 等)
// 当前 6 个源全部为 direct 类型 (raw.githubusercontent.com), 此函数不再被 scrapeAllSites 调用。
// 保留导出以便未来重新启用页面型数据源。
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

// 遗留抓取器: airportnode.com 已停用, 保留以便未来重新启用
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

  // 用 Map 把 proxies 中 _orig(原始对象引用) 映射到 parsed region, 避免 O(n*m) 的 find
  const buildRegionByOrig = (proxies) => {
    const m = new Map();
    for (const p of proxies) {
      if (p && p._orig !== undefined) m.set(p._orig, p);
    }
    return m;
  };
  const clashRegion = buildRegionByOrig((feeds.Clash && feeds.Clash.proxies) || []);
  const singboxRegion = buildRegionByOrig((feeds['Sing-Box'] && feeds['Sing-Box'].proxies) || []);

  // 说明: 当 feeds.X.contentMap[url] 来自同一个 result.rawContent 的 content 时,
  // 再次 yaml.load/JSON.parse 会产生新对象, 不再保留 _orig 引用 —— 因此下方
  // regionByOrig 查找可能找不到匹配(等价于"重命名未应用"), 这是已知的限制,
  // 后续版本可以改为对原始 data.proxies 做重命名而不是再次解析。
  const renamedClash = {};
  if (feeds.Clash && feeds.Clash.contentMap) {
    for (const [url, content] of Object.entries(feeds.Clash.contentMap)) {
      try {
        const config = yaml.load(content);
        if (config && config.proxies) {
          config.proxies = config.proxies.map(p => {
            const proxy = clashRegion.get(p);
            if (proxy && proxy.region !== 'unknown') {
              return { ...p, name: `${proxy.region}-${p.name}` };
            }
            return p;
          });
          renamedClash[url] = yaml.dump(config, { lineWidth: -1 });
        } else {
          renamedClash[url] = content;
        }
      } catch (e) {
        renamedClash[url] = content;
      }
    }
  }
  renamedContent.clash = renamedClash;

  const renamedSingBox = {};
  if (feeds['Sing-Box'] && feeds['Sing-Box'].contentMap) {
    for (const [url, content] of Object.entries(feeds['Sing-Box'].contentMap)) {
      try {
        const config = JSON.parse(content);
        if (config && config.outbounds) {
          config.outbounds = config.outbounds.map(ob => {
            const proxy = singboxRegion.get(ob);
            if (proxy && proxy.region !== 'unknown') {
              return { ...ob, tag: `${proxy.region}-${ob.tag || ob.name || 'proxy'}` };
            }
            return ob;
          });
          renamedSingBox[url] = JSON.stringify(config, null, 2);
        } else {
          renamedSingBox[url] = content;
        }
      } catch (e) {
        renamedSingBox[url] = content;
      }
    }
  }
  renamedContent.singbox = renamedSingBox;

  // V2ray TXT
  if (feeds.V2ray && feeds.V2ray.contentMap) {
    const v2rayLines = new Map();
    for (const p of (feeds.V2ray.proxies || [])) {
      if (p && p.line) v2rayLines.set(p.line, p);
    }
    const renamedTxts = {};
    for (const [url, content] of Object.entries(feeds.V2ray.contentMap)) {
      const lines = content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const proxy = v2rayLines.get(trimmed);
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

// P1-1: 输出生成采用"临时目录 + 校验 + 原子替换"策略。
// - 所有 5 个订阅文件先写入 SUBS_DIR.tmp.<pid>/, 通过非空/结构校验后才替换正式文件。
// - 任何一步失败: 正式文件保持上版内容不变, 输出机器可读状态 (exitCode!=0)。
// - 零节点: 视为"抓取失败"而非"成功发布空订阅"。旧文件保留, 但本次运行标记为 failed。
const SUBS_DIR = path.join(__dirname, 'artifacts', 'subs');
const STATUS_FILE = path.join(__dirname, 'artifacts', 'run-status.json');
const SUB_OUTPUT_FILES = ['mihomo.yaml', 'all.yaml', 'base64.txt', 'byxiaoxi.txt', 'kooker.jp.txt'];

function writeRunStatus(status) {
  try {
    fs.ensureDirSync(path.dirname(STATUS_FILE));
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
  } catch (e) {
    console.log('[Status] Failed to write run-status.json: ' + e.message);
  }
}

// 结构校验: 每个文件必须存在、非空、且可解析为对应格式
function validateSubFiles(tmpDir) {
  const errors = [];
  for (const f of SUB_OUTPUT_FILES) {
    const p = path.join(tmpDir, f);
    if (!fs.existsSync(p)) { errors.push(`${f}: missing`); continue; }
    const content = fs.readFileSync(p, 'utf8');
    if (content.trim().length === 0) { errors.push(`${f}: empty`); continue; }
    if (f === 'mihomo.yaml' || f === 'all.yaml') {
      try {
        const doc = yaml.load(content);
        if (!doc || !Array.isArray(doc.proxies)) errors.push(`${f}: missing proxies list`);
      } catch (e) { errors.push(`${f}: invalid YAML (${e.message})`); }
    } else {
      // txt 文件每行必须是合法 URI 或空行
      const lines = content.split('\n').filter(l => l.trim());
      for (const l of lines) {
        if (!/^[a-z]+:\/\//i.test(l.trim())) {
          errors.push(`${f}: malformed line "${l.trim().substring(0, 40)}..."`);
          break;
        }
      }
    }
  }
  return errors;
}

// 原子替换: 校验全部通过后才把临时目录内容覆盖正式目录
// 可选 targetDir 参数供测试注入临时目标, 默认使用 SUBS_DIR
function commitSubFiles(tmpDir, targetDir) {
  const dest = targetDir || SUBS_DIR;
  fs.ensureDirSync(dest);
  for (const f of SUB_OUTPUT_FILES) {
    fs.copyFileSync(path.join(tmpDir, f), path.join(dest, f));
  }
}

function cleanupTmpDir(tmpDir) {
  try { fs.removeSync(tmpDir); } catch (e) { /* best effort */ }
}

async function scrapeAllSites() {
  const config = loadConfig();
  const results = [];
  const runId = Date.now().toString(36); // P2: 运行 ID, 用于日志关联
  const phaseStart = Date.now();
  logger.info(`[run:${runId}] Scrape started (${config.sites.filter(s => s.enabled).length} enabled sources)`);

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

  // 说明: 当前 config.json 中 6 个源全部为 direct 类型 (raw.githubusercontent.com),
  // 因此不执行任何遗留的 GitHub Pages 抓取器 (scrapeGithubPagesSite / scrapeAirportNode)。
  // 若未来新增 site.type === 'github-pages' 的源, 在此处按类型分流调用对应的抓取器。
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

  logger.info(`[run:${runId}] Fetch+dedup phase complete in ${((Date.now() - phaseStart) / 1000).toFixed(1)}s, ${results.length}/${directSites.length} sources succeeded, ${output.summary.unique} unique feeds`);

  
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

  
  // 连接池管理 - 复用TCP连接减少延迟
  // 说明: ConnectionPool 类在下次优化迭代中启用 (由 checkTcpNode 复用长连接),
  // 当前 TCP 有效性检测使用独立短连接(每次检测后立即销毁), 保留类定义以便扩展。
  class ConnectionPool {
  constructor(maxSize = 50) {
    this.pool = new Map();
    this.maxSize = maxSize;
    this.stats = { created: 0, reused: 0, closed: 0 };
  }

  async getConnection(server, port) {
    const key = `${server}:${port}`;
    
    // 尝试复用已有连接
    if (this.pool.has(key)) {
      const conn = this.pool.get(key);
      if (!conn.destroyed) {
        this.stats.reused++;
        return conn;
      }
      this.pool.delete(key);
    }

    // 创建新连接
    if (this.pool.size >= this.maxSize) {
      // 淘汰最旧的连接
      const oldestKey = this.pool.keys().next().value;
      const oldestConn = this.pool.get(oldestKey);
      if (oldestConn) oldestConn.destroy();
      this.pool.delete(oldestKey);
      this.stats.closed++;
    }

    const net = require('net');
    const client = net.connect(Number(port), server);
    this.pool.set(key, client);
    this.stats.created++;
    
    client.on('close', () => this.pool.delete(key));
    client.on('error', () => this.pool.delete(key));
    
    return client;
  }

  closeAll() {
    for (const [key, conn] of this.pool) {
      conn.destroy();
      this.stats.closed++;
    }
    this.pool.clear();
  }

  getStats() {
    return { ...this.stats, activeConnections: this.pool.size };
  }
}

  // 全局连接池实例 (当前保留以便扩展, 暂未启用)
  const connectionPool = new ConnectionPool(100);
  console.log(`[Check] Testing node validity (TCP connect)...`);
  const TIMEOUT_MS = 5000; // Reduced for faster checks
  const CONCURRENCY = 150; // 提升至 150 (优化建议: 批量检测建议并发数: 100-200)

  // P1-2: 检测等级说明 — TCP connect 只证明目标端口可达，不代表代理协议
  // 握手/认证/出网成功。每个节点新增 detectLevel 字段:
  //   "tcp"       = TCP 可达 (本阶段唯一已验证的等级)
  //   未来若加入真实协议验证 (vmess/trojan/ss 握手或 HTTP 出网测试),
  //   将通过独立阶段与状态字段区分, 且可通过 settings.proxyProbe.enabled 关闭。
  // 筛选条件中不得把 detectLevel="tcp" 当作"代理可用"。
  function checkTcpNode(p) {
    return new Promise((resolve) => {
      // Validate port
      const port = Number(p.port);
      if (!port || port < 1 || port > 65535) {
        p.detectLevel = "tcp_failed";
        resolve(false);
        return;
      }

      const timer = setTimeout(() => { p.detectLevel = "tcp_timeout"; resolve(false); }, TIMEOUT_MS);
      const net = require('net');
      const client = net.connect(port, p.server, () => {
        clearTimeout(timer);
        client.destroy();
        p.detectLevel = "tcp";
        resolve(true);
      });
      client.on('error', () => { clearTimeout(timer); p.detectLevel = "tcp_error"; resolve(false); });
      client.on('timeout', () => { clearTimeout(timer); client.destroy(); p.detectLevel = "tcp_timeout"; resolve(false); });
      client.setTimeout(TIMEOUT_MS);
    });
  }

  async function runChecks(proxies) {
    const valid = [];
    let checked = 0;
    const total = proxies.length;

    // Shuffle to distribute load
    const shuffled = [...proxies].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += CONCURRENCY) {
      const batch = shuffled.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(p => checkTcpNode(p)));
      for (let j = 0; j < batch.length; j++) {
        checked++;
        if (results[j]) valid.push(batch[j]);
        if (checked % 500 === 0 || checked === total) {
          console.log(`  [Check] ${checked}/${total} checked (${Math.round(checked/total*100)}%) - TCP Valid: ${valid.length}`);
        }
      }
    }
    return valid;
  }

  const checkStart = Date.now();
  allProxies = await runChecks(allProxies);
  const checkTime = ((Date.now() - checkStart) / 1000).toFixed(1);
  console.log(`  [Check] Done in ${checkTime}s. TCP reachable: ${allProxies.length} (detectLevel="tcp", 未验证协议层)`);

  // HTTP latency test + IP geolocation via ipchacha.cn
  allProxies = await batchGeoCheck(allProxies);
  // ==============================================

  if (allProxies.length > 0) {
    console.log("\n[Output] Writing " + allProxies.length + " proxies to " + SUBS_DIR + "...");

    // Filter out unknown region, cloud IPs, and high-latency nodes
    const MIN_QUALITY = 60;
    const MAX_LATENCY = 5000;
    const beforeFilter = allProxies.length;
    allProxies = allProxies.filter(p => {
      const region = (p._region || "unknown").toLowerCase();
      const quality = p.qualityScore || 0;
      const latency = p.latency || 0;
      if (region === "unknown" || region === "cloud") return false;
      if ((p.fraudScore || 0) > 30) return false; // Remove nodes with fraud score > 30%
      if (latency > MAX_LATENCY) return false;
      if (quality < MIN_QUALITY) return false;
      return true;
    });
    console.log("  [Filter] Removed " + (beforeFilter - allProxies.length) + " nodes. Remaining: " + allProxies.length);

    if (allProxies.length === 0) {
      // 过滤后为空: 等价于零节点, 保留上版正式文件, 标记本次运行失败
      console.log("[Output] All proxies filtered out; keeping previous release.");
      writeRunStatus({
        status: "failed",
        reason: "zero_proxies_after_filter",
        generatedAt: new Date().toISOString(),
        filesKept: "previous release unchanged",
      });
      process.exitCode = 1;
      return output;
    }

    const regionPriority = { us: 1, hk: 2, tw: 3, jp: 4, sg: 5, kr: 6, uk: 7, de: 8, ca: 9, au: 10, nl: 11, fr: 12 };
    allProxies.sort((a, b) => {
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) return (b.qualityScore || 0) - (a.qualityScore || 0);
      return (regionPriority[a._region] || 99) - (regionPriority[b._region] || 99);
    });
    console.log("  Sorted " + allProxies.length + " proxies by quality score and region");
    // 名称归一化: 清洗 C0/C1 控制字符 + 保证节点名全局唯一 (mihomo 对重名直接拒绝整个配置)
    const renamedCount = normalizeProxyNames(allProxies);
    console.log("  [Normalize] Renamed " + renamedCount + " duplicated proxy names");

    // === 临时目录 + 校验 + 原子替换 (P1-1) ===
    const tmpDir = SUBS_DIR + ".tmp." + process.pid;
    fs.ensureDirSync(tmpDir);
    fs.ensureDirSync(SUBS_DIR);
    let outputErrors = [];
    try {
      // 1. mihomo.yaml
      const mihomoConfig = buildMihomoConfig(allProxies);
      fs.writeFileSync(path.join(tmpDir, "mihomo.yaml"), yaml.dump(mihomoConfig, { lineWidth: -1, noRefs: true }), "utf8");
      console.log("  OK mihomo.yaml (tmp)");

      // 2. all.yaml
      fs.writeFileSync(path.join(tmpDir, "all.yaml"), yaml.dump({ proxies: allProxies }, { lineWidth: -1, noRefs: true }), "utf8");
      console.log("  OK all.yaml (tmp)");

      // 3. base64.txt
      const base64Lines = [];
      for (const p of allProxies) {
        const uri = buildUri(p);
        if (uri) base64Lines.push(uri);
      }
      fs.writeFileSync(path.join(tmpDir, "base64.txt"), base64Lines.join("\n") + "\n", "utf8");
      console.log("  OK base64.txt (" + base64Lines.length + " entries, tmp)");

      // 4. byxiaoxi.txt
      fs.writeFileSync(path.join(tmpDir, "byxiaoxi.txt"), base64Lines.join("\n") + "\n", "utf8");
      console.log("  OK byxiaoxi.txt (tmp)");

      // 5. kooker.jp.txt
      const kookerLines = [];
      for (const p of allProxies) {
        const region = (p._region || "unknown").toLowerCase();
        const flag = getFlagEmoji(region);
        const country = getCountryName(region);
        // 显示名也走 fragment 安全化 (含上游名可能带空白/#)
        const displayName = sanitizeNameForUri(flag + " " + country + " " + cleanProxyName(p.name));
        const uri = buildUri(p, displayName);
        if (uri) kookerLines.push(uri);
      }
      fs.writeFileSync(path.join(tmpDir, "kooker.jp.txt"), kookerLines.join("\n") + "\n", "utf8");
      console.log("  OK kooker.jp.txt (" + kookerLines.length + " entries, tmp)");

      // 校验: 所有文件非空、结构合法
      outputErrors = validateSubFiles(tmpDir);
      if (outputErrors.length > 0) throw new Error("validation failed: " + outputErrors.join("; "));

      // 原子替换正式文件
      commitSubFiles(tmpDir);
      console.log("[Output] All files written to artifacts/subs/ directory.");
      writeRunStatus({
        status: "ok",
        proxyCount: allProxies.length,
        generatedAt: new Date().toISOString(),
        files: SUB_OUTPUT_FILES,
      });
      logger.info(`[run:${runId}] Output phase complete, ${allProxies.length} proxies committed to artifacts/subs/`);
    } catch (e) {
      // 失败: 清理临时目录, 正式文件保持上版
      console.error("[Output] FAILED: " + e.message);
      writeRunStatus({
        status: "failed",
        reason: "output_generation_failed",
        detail: e.message,
        generatedAt: new Date().toISOString(),
        filesKept: "previous release unchanged",
      });
      logger.error(`[run:${runId}] Output phase failed: ${e.message}`);
      process.exitCode = 1;
    } finally {
      cleanupTmpDir(tmpDir);
    }
  } else {
    // P1-1: 零节点 ≠ 成功。保留上版订阅避免破坏客户端, 但本次运行必须标记失败,
    // 且不得把旧文件当作新产物发布。
    console.log("[Output] No proxies to write; keeping previous release. Marking run as FAILED.");
    writeRunStatus({
      status: "failed",
      reason: "zero_proxies",
      generatedAt: new Date().toISOString(),
      filesKept: "previous release unchanged",
    });
    logger.error(`[run:${runId}] Zero proxies — run marked FAILED, previous release preserved`);
    process.exitCode = 1;
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

// 将节点名"URI fragment 安全化" (2026-10 修复 Clash 解析失败):
// - 空白折叠为单个空格 (fragment 内未编码空白在 RFC 3986 下非法, 部分客户端截断)
// - 移除名称内的 '#' (第二个 # 会被 split('#') 类解析器截断, 138/1491 行受影响)
// - 仅保留可见字符; 输入为空时返回 fallback
function sanitizeNameForUri(name, fallback = "proxy") {
  if (!name || typeof name !== "string") return fallback;
  return name.replace(/#/g, "").replace(/\s+/g, " ").trim() || fallback;
}

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
  // fragment 安全化: 名称经此拼接进 vless://...#name, 空白/# 必须清洗
  return sanitizeNameForUri(flag + countryName + "|" + speed + "|" + score + "分");
}

// 从字符串中移除 YAML/go-yaml 会拒绝的 C0/C1 控制字符 (0x00-0x1F 除 \t\n\r, 0x7F, 0x80-0x9F)。
// 上游订阅源的节点名里常混入 0xA0 (no-break space) 等字节, 会导致 mihomo/FlClash 报
// "yaml: control characters are not allowed", 这里统一清洗。
// 2026-10: 同时把任意空白折叠为单个空格 —— 节点名既进 YAML (mihomo.yaml/all.yaml)
// 又进 URI fragment (vless://...#name), 多空白在 YAML 层可能歧义、在 fragment 层
// 未编码空白违反 RFC 3986, 部分 Clash 客户端会截断或拒绝。
function stripControlChars(s) {
  if (typeof s !== "string" || s === "") return s;
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c === 13) { out += ch; continue; }
    if (c < 32 || c === 127 || (c >= 0x80 && c <= 0x9f)) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim() || "proxy";
}

// 确保所有代理节点名全局唯一 (mihomo/clash.meta 对重名直接拒绝整个配置:
// "proxy X is the duplicate name")。
// 策略: 同名节点按首次出现顺序追加序号 (us-美国-unknown-95分-2, -3...), 并顺带清洗控制字符。
function normalizeProxyNames(proxies) {
  const seen = new Map(); // name -> count
  let renamed = 0;
  for (const p of proxies) {
    p.name = stripControlChars(p.name || "proxy");
    if (p.name.length > 64) p.name = p.name.slice(0, 64).trim() || "proxy";
    // fragment 安全化: 名称后续会进入 vless://...#name 等 URI, 空白/# 必须清洗
    p.name = sanitizeNameForUri(p.name);
    const c = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, c);
    if (c > 1) {
      p.name = p.name + "-" + c;
      renamed++;
    }
  }
  return renamed;
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

// 生成 mihomo.yaml 的静态骨架 (proxies 由调用方填充)。
// 安全默认 (P0): 控制面只绑定 127.0.0.1, allow-lan 默认 false;
// 远程管理需用户显式修改本文件并自行配置 external-controller-secret。
//
// 解析兼容性 (2026-10 修复): group 名与 rule 中引用的 group 名必须与
// mihomo/clash 实际渲染的 group 名完全一致。此前模板在源码中写
// "♻️ 自动选择"/"🔱 故障转移", 但生成 YAML 后 group name 被客户端渲染为
// "🚀 节点选择"/"♻️ 自动选择"/"🔱 故障转移", 而引用侧仍指向旧名,
// 导致 "proxy X is not found" 类解析错误。现统一为 ASCII 安全的
// "auto-select"/"failover" 组名, 并让引用与定义使用同一 JS 常量。
// 客户端 (mihomo/FlClash/Clash Verge) 均支持纯 ASCII group 名。
function buildMihomoConfig(proxies) {
  // group 名必须 ASCII 安全: 此前模板在源码里用 "🚀 节点选择" / "♻️ 自动选择" /
  // "🔱 故障转移" 等 emoji 名, 但生成 YAML 后 emoji 代理对 (surrogate pair) 在不同
  // 客户端 (mihomo / FlClash / Clash Verge) 的渲染/匹配行为不一致, 且 rules 里引用的
  // group 名与 proxy-groups 定义名若有一处 emoji 规范化 (NFC/NFD) 不一致, mihomo 直接报
  // "proxy X is not found" 拒绝整个配置。统一改为纯 ASCII 组名, 任何客户端都能解析。
  const AUTO_GROUP = "auto-select";
  const FALLBACK_GROUP = "failover";
  const CN_GROUP = "节点选择";
  const DIRECT_GROUP = "全球直连";
  const FINAL_GROUP = "漏网之鱼";
  // 对传入 proxies 的名称做 fragment 安全化 (只读视图, 不改原对象):
  // 名称会进入 YAML "name:" 字段与 group 成员引用, 空白/# 必须清洗, 否则
  // mihomo/clash 解析时可能截断或报 "proxy X is not found"。
  // 重名追加序号由 scrapeAllSites 的 normalizeProxyNames 负责 (唯一可安全原地修改
  // allProxies 的路径, 且该路径同时生成 YAML/TXT); 此处不重复处理以免序号冲突。
  const safeNames = proxies.map(p => sanitizeNameForUri(p.name));
  return {
    "mixed-port": 7890, "allow-lan": false, "mode": "rule", "log-level": "info",
    "ipv6": true, "external-controller": "127.0.0.1:9090",
    "dns": {
      "enabled": true, "listen": "0.0.0.0:1053", "ipv6": true,
      "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/16",
      "fake-ip-filter": ["*.lan", "*.local"],
      "default-nameserver": ["223.5.5.5", "119.29.29.29"],
      "nameserver": ["https://dns.alidns.com/dns-query"],
      "fallback": ["https://dns.google/dns-query"],
    },
    "proxies": proxies.map((p, i) => ({ ...p, name: safeNames[i] })),
    "proxy-groups": [
      { "name": CN_GROUP, "type": "select", "proxies": [AUTO_GROUP, FALLBACK_GROUP] },
      { "name": AUTO_GROUP, "type": "url-test", "url": "http://www.gstatic.com/generate_204", "interval": 300, "tolerance": 50, "proxies": safeNames },
      { "name": FALLBACK_GROUP, "type": "fallback", "url": "http://www.gstatic.com/generate_204", "interval": 60, "proxies": safeNames.slice(0, Math.min(10, safeNames.length)) },
      { "name": DIRECT_GROUP, "type": "select", "proxies": ["DIRECT"] },
      { "name": FINAL_GROUP, "type": "select", "proxies": [CN_GROUP, DIRECT_GROUP] },
    ],
    "rules": [
      "GEOSITE,category-ads-all,DIRECT",
      "GEOSITE,cn," + DIRECT_GROUP,
      "GEOIP,CN," + DIRECT_GROUP + ",no-resolve",
      "GEOIP,LAN," + DIRECT_GROUP + ",no-resolve",
      "MATCH," + FINAL_GROUP,
    ],
  };
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
  const enhancedRegion = detectRegionFromServer(p.server || "", p.name || "");
  if (enhancedRegion !== "unknown") region = enhancedRegion;
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
      return { name: name || "vmess", type: "vmess", server: obj.add, port: parseInt(obj.port) || 443, uuid: obj.id, password: obj.id, network: obj.net || "tcp", tls: obj.tls === "tls", sni: obj.sni || "", _region: region, speed: "unknown", latency: 0, qualityScore: 65, fraudScore: 0 };
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
      return { name: name || "trojan", type: "trojan", server: server || "", port: port, password: passwd, sni: qp.get("sni") || "", network: qp.get("type") || "", _region: region, speed: "unknown", latency: 0, qualityScore: 75, fraudScore: 0 };
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
      return { name: name || "ss", type: "ss", server: server || "", port: port, cipher: cipher || "aes-256-gcm", password: password || "pass", _region: region, speed: "unknown", latency: 0, qualityScore: 60, fraudScore: 0 };
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
      return { name: name || "vless", type: "vless", server: server || "", port: port, uuid: uuid, security: qp.get("security") || "", sni: qp.get("sni") || "", flow: qp.get("flow") || "", _region: region, speed: "unknown", latency: 0, qualityScore: 80, fraudScore: 0 };
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
      return { name: name || "hysteria2", type: proto === "hysteria" ? "hysteria" : "hysteria2", server: server || "", port: port, password: passwd, _region: region, speed: "unknown", latency: 0, qualityScore: 70, fraudScore: 0 };
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
      return { name: name || proto, type: proto, server: server || "", port: port, username: username || "", password: password || "", tls: proto === "https", _region: region, speed: "unknown", latency: 0, qualityScore: 55, fraudScore: 0 };
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
  const enhancedRegion = detectRegionFromServer(ob.server || "", ob.tag || ob.name || "");
  if (enhancedRegion !== "unknown") region = enhancedRegion;
  if (region !== "unknown") score += 15;
  if (t === "vless" || t === "trojan") score += 5;
  if (ob.tls?.enabled) score += 5;
  return { name: name, type: t, server: ob.server || "", port: ob.port || 443, uuid: ob.uuid || "", password: ob.password || "", cipher: ob.cipher || "", network: ob.transport?.type || "", tls: ob.tls?.enabled || false, sni: ob.tls?.server || "", _region: region, speed: "unknown", latency: 0, qualityScore: Math.min(100, score), fraudScore: 0 };
}



// ========== ENHANCED REGION DETECTION ==========
function detectRegionFromServer(server, name) {
  let region = detectRegionFromName(name || "");
  if (region !== "unknown") return region;
  if (!server) return "unknown";
  const lower = server.toLowerCase();
  const platformRegions = {
    "railway.app": "us", "vercel.app": "us", "netlify.app": "us",
    "herokuapp.com": "us", "glitch.me": "us",
    "hkg": "hk", "hkt": "hk", "hkc": "hk", "pccw": "hk",
    "tw": "tw", "taiwan": "tw", "cht": "tw", "hinet": "tw",
    "japan": "jp", "tokyo": "jp", "osaka": "jp", "softbank": "jp", "ntt": "jp",
    "singapore": "sg", "sin": "sg", "singtel": "sg",
    "korea": "kr", "seoul": "kr", "kt": "kr", "skt": "kr",
    "london": "uk", "gb": "uk", "bt": "uk", "ovh": "fr",
    "frankfurt": "de", "germany": "de", "de": "de",
    "paris": "fr", "france": "fr", "fr": "fr",
    "netherlands": "nl", "ams": "nl", "nl": "nl",
    "toronto": "ca", "canada": "ca", "ca": "ca",
    "sydney": "au", "australia": "au", "au": "au",
    "aliyun": "cn", "tencent": "cn", "baidu": "cn", "ali": "cn",
  };
  for (const [keyword, reg] of Object.entries(platformRegions)) {
    if (lower.includes(keyword)) return reg;
  }
  return "unknown";
}

// ========== IP GEOLOCATION + FRAUD SCORE VIA IP-API.COM ==========
// Country code to region mapping
const CC_TO_REGION = {
  'US': 'us', 'USA': 'us', 'United States': 'us',
  'HK': 'hk', 'HKG': 'hk', 'Hong Kong': 'hk',
  'TW': 'tw', 'TWN': 'tw', 'Taiwan': 'tw', 'TAI': 'tw',
  'JP': 'jp', 'JPN': 'jp', 'Japan': 'jp', 'Tokyo': 'jp', 'OSA': 'jp',
  'SG': 'sg', 'SGP': 'sg', 'Singapore': 'sg',
  'KR': 'kr', 'KOR': 'kr', 'Korea': 'kr', 'Seoul': 'kr',
  'GB': 'uk', 'UK': 'uk', 'Great Britain': 'uk', 'London': 'uk',
  'DE': 'de', 'GER': 'de', 'Germany': 'de', 'Frankfurt': 'de',
  'FR': 'fr', 'FRA': 'fr', 'France': 'fr', 'Paris': 'fr',
  'NL': 'nl', 'NLD': 'nl', 'Netherlands': 'nl', 'AMS': 'nl',
  'CA': 'ca', 'CAN': 'ca', 'Canada': 'ca', 'Toronto': 'ca',
  'AU': 'au', 'AUS': 'au', 'Australia': 'au', 'Sydney': 'au',
  'CN': 'cn', 'CHN': 'cn', 'China': 'cn',
  'RU': 'ru', 'ROU': 'ro', 'FIN': 'fi', 'IND': 'in',
  'BR': 'br', 'SE': 'se', 'CH': 'ch', 'IT': 'it',
  'ES': 'es', 'ID': 'id', 'TH': 'th', 'VN': 'vn',
};

// Calculate fraud score using lightweight heuristics (no external API needed)
// Returns 0-100 where higher = more suspicious
function calculateFraudScoreHeuristic(proxy) {
  let score = 0;
  const server = (proxy.server || "").toLowerCase();
  const org = (proxy.org || "").toLowerCase();
  const isp = (proxy.isp || "").toLowerCase();
  const name = (proxy.name || "").toLowerCase();
  
  // Known proxy/VPN hosting providers (high fraud)
  const proxyProviders = ["bandwagon", "racknerd", "hostinger", "namecheap", "cloudflare", "digitalocean", "vultr", "linode", "hetzner", "ovh", "scaleway", "contabo", "foxhost", "hostdad", "hostreplica", "hostus", "serverloft", "myloc", "hostkey", "kimsufi", "soyoustart", "online.net", "scaleway"];
  for (const kw of proxyProviders) {
    if (server.includes(kw) || org.includes(kw) || isp.includes(kw)) { score += 25; break; }
  }
  
  // Known cloud providers (medium fraud)
  const cloudProviders = ["amazon", "aws", "google", "gcp", "azure", "alibaba", "tencent", "huawei", "oracle"];
  for (const kw of cloudProviders) {
    if (server.includes(kw) || org.includes(kw) || isp.includes(kw)) { score += 15; break; }
  }
  
  // Datacenter/IP range indicators
  if (/^\d+\.\d+\.\d+\.\d+$/.test(proxy.server)) {
    const octets = proxy.server.split(".");
    // Cloud provider IP ranges
    if (octets[0] >= 45 && octets[0] <= 46) score += 10; // OVH
    if (octets[0] === 104) score += 10; // Cloudflare/Google
    if (octets[0] === 172) score += 10; // Various clouds
    if (octets[0] === 198) score += 10; // Various clouds
    if (octets[0] === 206) score += 10; // Various clouds
    if (octets[0] === 209) score += 10; // Various clouds
  }
  
  // Name indicators
  const nameIndicators = ["proxy", "vpn", "tor", "anonym", "relay", "jump", "ssh", "tunnel", "bypass", "freeproxy", "freevpn"];
  for (const kw of nameIndicators) {
    if (name.includes(kw)) { score += 15; break; }
  }
  
  return Math.min(100, score);
}

// ========== README UPDATE ==========
async function batchGeoCheck(proxies) {
  // Separate IP-based from domain-based
  const ipProxies = [];
  const domainProxies = [];
  for (const p of proxies) {
    if (/^[\d.]+$/.test(p.server)) { ipProxies.push(p); }
    else { domainProxies.push(p); }
  }

  console.log("[GeoCheck] IP proxies: " + ipProxies.length + ", Domain proxies: " + domainProxies.length);

  const BATCH = 200;
  const startTime = Date.now();
  let checked = 0;

  for (let i = 0; i < ipProxies.length; i += BATCH) {
    const batch = ipProxies.slice(i, i + BATCH);
    const promises = batch.map(async (p) => {
      const fraudScore = getFraudScoreForProxy(p);
      return { proxy: p, region: p._region || "unknown", fraudScore };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      r.proxy.fraudScore = r.fraudScore;
    }
    checked += batch.length;
    if (checked % 500 === 0 || checked === ipProxies.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log("  [GeoCheck] " + checked + "/" + ipProxies.length + " (" + Math.round(checked/ipProxies.length*100) + "%) in " + elapsed + "s");
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("  [GeoCheck] Done in " + totalTime + "s");

  // 合并并返回 (保持原始顺序: IP 类 + 域名类)
  return [...ipProxies, ...domainProxies];
}

// Get fraud score for a single proxy (wrapper for heuristic calculation)
function getFraudScoreForProxy(proxy) {
  return calculateFraudScoreHeuristic(proxy);
}

// ========== README UPDATE ==========
function updateREADME(validProxies, output) {
  const readmePath = path.join(__dirname, "README.md");
  let readme = "";
  try { readme = fs.readFileSync(readmePath, "utf8"); } catch(e) { console.log("[README] No README found"); return; }

  const now = new Date();
  const cnTime = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const isoTime = now.toISOString();
  const validCount = validProxies.length;
  const avgScore = validCount > 0 ? Math.round(validProxies.reduce((s, p) => s + (p.qualityScore || 0), 0) / validCount) : 0;
  const totalScore = validCount * avgScore;
  const byRegion = {};
  for (const p of validProxies) {
    const r = (p._region || "unknown").toLowerCase();
    byRegion[r] = (byRegion[r] || 0) + 1;
  }

  let regionStats = "";
  const sortedRegions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  for (const [region, count] of sortedRegions) {
    const cname = COUNTRY_NAMES_MAP[region] || region;
    regionStats += `- **${cname}**: ${count} nodes\n`;
  }

  const SUBS_RAW_BASE = "https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs";
  let feedLinks = `- **Mihomo / Clash Meta**: [mihomo.yaml](${SUBS_RAW_BASE}/mihomo.yaml)\n`;
  feedLinks += `- **Clash / Standard**: [all.yaml](${SUBS_RAW_BASE}/all.yaml)\n`;
  feedLinks += `- **Base64 (通用)**: [base64.txt](${SUBS_RAW_BASE}/base64.txt)\n`;
  feedLinks += `- **通用TXT (XiaoXi)**: [byxiaoxi.txt](${SUBS_RAW_BASE}/byxiaoxi.txt)\n`;
  feedLinks += `- **通用TXT (kooker.jp)**: [kooker.jp.txt](${SUBS_RAW_BASE}/kooker.jp.txt)\n`;

  // 行尾风格: 本地 Windows checkout 可能是 CRLF, GitHub Actions 是 LF。
  // 按当前文件的行尾风格构造替换文本, 保证 CRLF/LF 下行为一致。
  const useCRLF = readme.split("\n").some(l => l.endsWith("\r"));
  const NL = useCRLF ? "\r\n" : "\n";

  // 1) 时间标记: 整行原地替换 (保留 "> " 引用前缀, 不影响迁移说明等人工内容)
  //    行内值在 "**最后同步时间**：" 之后, 因此匹配整行并重建
  readme = readme.replace(
    new RegExp("^[^\\r\\n]*\\*\\*最后同步时间\\*\\*[^\\r\\n]*", "m"),
    "> **最后同步时间**：" + cnTime + " (北京时间)"
  );
  readme = readme.replace(
    new RegExp("^[^\\r\\n]*\\*\\*ISO 时间\\*\\*[^\\r\\n]*", "m"),
    "> **ISO 时间**：" + isoTime
  );

  // 2) 统计区块: 从 "### 节点统计" (兼容 "### 📊 节点统计") 起, 到免责声明前
  //    的 "---" 分隔线为止。这一段完全由 scraper 写入, 整段替换可清除任何
  //    历史遗留/混入内容 (旧版锚点缺失时曾留下重复的订阅链接表格)。
  const statsRegex = new RegExp("### [\\u{1F4CA}\\s]*节点统计[^]*?(?=\\r?\\n---\\s*\\r?\\n\\s*##)", "su");
  const newStats = ["### 节点统计",
    `- **有效节点数**: ${validCount}`,
    `- **平均质量分**: ${avgScore}/100`,
    `- **总质量分**: ${totalScore}`,
    "",
    "### 🌍 地区分布",
    regionStats.trimEnd(),
    "### 🚀 订阅链接",
    feedLinks.trimEnd(),
    ""].join(NL);
  if (statsRegex.test(readme)) {
    readme = readme.replace(statsRegex, newStats);
  } else {
    // 兜底: README 结构被破坏 (统计区块缺失) 时, 在免责声明前整块插入
    const dmIdx = readme.indexOf("## ⚖️ 免责声明");
    const block = newStats + NL + "---" + NL + NL;
    if (dmIdx >= 0) {
      readme = readme.slice(0, dmIdx) + block + readme.slice(dmIdx);
    } else {
      readme += NL + block;
    }
    console.log("  [README] Warning: stats section missing, re-inserted before disclaimer");
  }

  fs.writeFileSync(readmePath, readme, "utf8");
  console.log(`  [README] Updated with ${validCount} valid nodes, avg score ${avgScore}`);
}
module.exports = {
  scrapeAllSites, scrapeGithubPagesSite, scrapeAirportNode,
  parseSubscriptions: scrapeAllSites, loadConfig,
  sha256, detectRegionFromName, detectRegionFromIP,
  parseClashYaml, parseSingBoxJson, parseV2rayTxt,
  mergeAndDeduplicate, generateRenamedContent,
  buildMihomoConfig,
  // P1-4: 导出供离线回归测试 (零节点保护 / 去重 / 输出校验 / URI 构造)
  validateSubFiles, commitSubFiles, normalizeProxyNames,
  parseV2rayLineToEntry, buildUri, convertYamlProxyToEntry,
  SUB_OUTPUT_FILES,
};

if (require.main === module) {
  scrapeAllSites().catch(function(err) {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}


