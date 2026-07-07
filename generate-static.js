const fs = require("fs-extra");
const path = require("path");
const yaml = require("js-yaml");

const PROJECT_DIR = __dirname;
const DATA_DIR = path.join(PROJECT_DIR, "data");
const OUTPUT_DIR = path.join(PROJECT_DIR, "dist");
const REF_DIR = path.join(PROJECT_DIR, "FreeSubsCheck_temp");

const FLAG_EMOJI = {
  hk: "\ud83c\udded\ud83c\uddf0", tw: "\ud83c\uddf9\ud83c\uddfc", jp: "\ud83c\uddef\ud83c\uddf5",
  us: "\ud83c\uddfa\ud83c\uddf8", sg: "\ud83c\uddf8\ud83c\uddec", kr: "\ud83c\uddf0\ud83c\uddf7",
  uk: "\ud83c\uddec\ud83c\udde7", de: "\ud83c\udde9\ud83c\uddea", fr: "\ud83c\uddeb\ud83c\uddf7",
  nl: "\ud83c\uddf3\ud83c\uddf1", ca: "\ud83c\udde8\ud83c\udde6", au: "\ud83c\udde6\ud83c\uddfa",
  cn: "\ud83c\udde8\ud83c\uddf3", ro: "\ud83c\uddf7\ud83c\uddf4", fi: "\ud83c\uddeb\ud83c\uddee",
  in: "\ud83c\uddee\ud83c\uddf3", br: "\ud83c\udde7\ud83c\uddf7", se: "\ud83c\uddf8\ud83c\uddea",
  ch: "\ud83c\udde8\ud83c\udded", it: "\ud83c\uddee\ud83c\uddf9", es: "\ud83c\uddea\ud83c\uddf8",
  id: "\ud83c\uddee\ud83c\udde9", th: "\ud83c\uddf9\ud83c\udded", vn: "\ud83c\uddfb\ud83c\uddf3",
};

const COUNTRY_NAMES = {
  hk: "香港", tw: "台湾", jp: "日本", us: "美国", sg: "新加坡", kr: "韩国",
  uk: "英国", de: "德国", fr: "法国", nl: "荷兰", ca: "加拿大", au: "澳大利亚",
  cn: "中国", ro: "罗马尼亚", fi: "芬兰", in: "印度", br: "巴西", se: "瑞典",
  ch: "瑞士", it: "意大利", es: "西班牙", id: "印尼", th: "泰国", vn: "越南",
};

function getFlag(region) { return FLAG_EMOJI[region] || "\ud83c\udf10"; }
function getCountryName(region) { return COUNTRY_NAMES[region] || region; }

function parseFreeSubsCheckMihomo(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  try {
    const doc = yaml.load(content);
    if (!doc || !doc.proxies || !Array.isArray(doc.proxies)) return [];
    return doc.proxies.map(p => {
      const name = p.name || "proxy";
      // Parse name to extract flag, region, base name, and speed
      let region = "unknown";
      let displayName = name;
      let speed = "unknown";

      // Pattern: flag_...|speed or flag...|speed
      const speedMatch = name.match(/\|([\d.]+\s*(?:ms|MB\/s|KB\/s))$/);
      if (speedMatch) {
        speed = speedMatch[1];
        displayName = name.replace(/\|[\d.]+\s*(?:ms|MB\/s|KB\/s)$/, "");
      }

      // Extract region from flag emoji or prefix
      const flagMatch = displayName.match(/^([\u{1F1E0}-\u{1F1FF})]{2})(.*)/u);
      if (flagMatch) {
        const flag = flagMatch[1];
        const flagPairs = {
          "\ud83c\udded\ud83c\uddf0": "hk", "\ud83c\uddf9\ud83c\uddfc": "tw",
          "\ud83c\uddef\ud83c\uddf5": "jp", "\ud83c\uddfa\ud83c\uddf8": "us",
          "\ud83c\uddf8\ud83c\uddec": "sg", "\ud83c\uddf0\ud83c\uddf7": "kr",
          "\ud83c\uddec\ud83c\udde7": "uk", "\ud83c\udde9\ud83c\uddea": "de",
          "\ud83c\uddeb\ud83c\uddf7": "fr", "\ud83c\uddf3\ud83c\uddf1": "nl",
          "\ud83c\udde8\ud83c\udde6": "ca", "\ud83c\udde6\ud83c\uddfa": "au",
          "\ud83c\udde8\ud83c\uddf3": "cn", "\ud83c\uddf7\ud83c\uddf4": "ro",
          "\ud83c\uddeb\ud83c\uddee": "fi", "\ud83c\uddee\ud83c\uddf3": "in",
          "\ud83c\udde7\ud83c\uddf7": "br", "\ud83c\uddf8\ud83c\uddea": "se",
          "\ud83c\udde8\ud83c\udded": "ch", "\ud83c\uddee\ud83c\uddf9": "it",
          "\ud83c\uddea\ud83c\uddf8": "es", "\ud83c\uddee\ud83c\udde9": "id",
          "\ud83c\uddf9\ud83c\udded": "th", "\ud83c\uddfb\ud83c\uddf3": "vn",
        };
        region = flagPairs[flag] || "unknown";
      }

      // Also check for region prefix like "RO_" or "US_"
      const prefixMatch = displayName.match(/^([A-Z]{2})_/);
      if (prefixMatch && FLAG_EMOJI[prefixMatch[1].toLowerCase()]) {
        region = prefixMatch[1].toLowerCase();
      }

      const baseName = displayName.replace(/^[\u{1F300}-\u{1FAD0}\u{1F1E0}-\u{1F1FF}]+/gu, "").replace(/^[\u{1F300}-\u{1FAD0}\u{1F1E0}-\u{1F1FF}]+/gu, "").trim();

      return {
        name: baseName || "proxy",
        type: p.type || "unknown",
        server: p.server || "",
        port: p.port || "",
        region: region,
        latency: 0,
        speed: speed,
        password: p.password,
        uuid: p.uuid,
        cipher: p.cipher,
        network: p.network,
        tls: p.tls,
        sni: p.sni,
        alpn: p.alpn,
        "client-fingerprint": p["client-fingerprint"],
        _orig: p,
      };
    }).filter(p => p.server && p.port);
  } catch (e) {
    console.error("Failed to parse mihomo.yaml:", e.message);
    return [];
  }
}

function cleanDisplayName(name) {
  if (!name) return "proxy";
  let s = name.replace(/^\w+-/, "");
  s = s.replace(/^[\u{1F1E0}-\u{1F1FF}]+/gu, "").trim();
  return s || "proxy";
}

function buildDisplayName(p) {
  const region = (p.region || "unknown").toLowerCase();
  const flag = getFlag(region);
  const base = cleanDisplayName(p.name);
  const lat = p.speed && p.speed !== "unknown" ? p.speed : (p.latency > 0 ? p.latency + "ms" : "unknown");
  return flag + base + "|" + lat;
}

function proxyToEntry(p) {
  const e = {
    name: buildDisplayName(p),
    type: p.type,
    server: p.server,
    port: p.port,
    "skip-cert-verify": true,
    udp: true,
  };
  if (p.password) e.password = p.password;
  if (p.uuid) e.uuid = p.uuid;
  if (p.cipher) e.cipher = p.cipher;
  if (p.network) e.network = p.network;
  if (p["ws-opts"]) e["ws-opts"] = p["ws-opts"];
  if (p.tls !== undefined) e.tls = p.tls;
  if (p.sni) e.sni = p.sni;
  if (p.alpn) e.alpn = p.alpn;
  if (p["client-fingerprint"]) e["client-fingerprint"] = p["client-fingerprint"];
  if (p.pbk) e.pbk = p.pbk;
  if (p.sid) e.sid = p.sid;
  if (p.flow) e.flow = p.flow;
  if (p.mode) e.mode = p.mode;
  if (p.congestion) e.congestion = p.congestion;
  if (p.reserved) e.reserved = p.reserved;
  if (p["obfs"]) e.obfs = p["obfs"];
  if (p["obfs-password"]) e["obfs-password"] = p["obfs-password"];
  if (p.insecure !== undefined) e.insecure = p.insecure;
  if (p.security) e.security = p.security;
  if (p.type_param) e.type_param = p.type_param;
  if (p.spk) e.spk = p.spk;
  if (p.subType) e.subType = p.subType;
  if (p.headerType) e.headerType = p.headerType;
  if (p.host) e.host = p.host;
  if (p.path) e.path = p.path;
  if (p.serviceName) e.serviceName = p.serviceName;
  if (p.encryption) e.encryption = p.encryption;
  if (p.udp_relay_mode) e["udp-relay-mode"] = p.udp_relay_mode;
  if (p.congestion_control) e.congestion_control = p.congestion_control;
  if (p.allow_insecure !== undefined) e.allow_insecure = p.allow_insecure;
  return e;
}

function genUri(p, customName) {
  const name = customName || buildDisplayName(p);
  let uri = "";
  const t = p.type;

  if (t === "vmess") {
    try {
      const obj = {
        v: "2", ps: name, add: p.server, port: p.port,
        id: p.password || p.uuid || "uuid",
        aid: 0, net: p.network || "tcp", type: "none",
        host: "", path: "", tls: p.tls ? "tls" : "", sni: p.sni || "",
        fp: p["client-fingerprint"] || "",
      };
      uri = "vmess://" + Buffer.from(JSON.stringify(obj)).toString("base64");
    } catch (e) { /* skip */ }
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
    uri = t + "2://" + (p.password || "") + "@" + p.server + ":" + p.port + (qs ? "?" + qs : "") + "#" + name;
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

function generateMihomoYaml(proxies) {
  const entries = proxies.map(proxyToEntry);
  const config = {
    "mixed-port": 7890,
    "allow-lan": true,
    "mode": "rule",
    "log-level": "info",
    "ipv6": true,
    "external-controller": "0.0.0.0:9090",
    "dns": {
      "enabled": true,
      "listen": "0.0.0.0:1053",
      "ipv6": true,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "fake-ip-filter": ["*.lan", "*.local"],
      "default-nameserver": ["223.5.5.5", "119.29.29.29"],
      "nameserver": ["https://dns.alidns.com/dns-query"],
      "fallback": ["https://dns.google/dns-query"],
    },
    proxies: entries,
    "proxy-groups": [
      {
        name: "\ud83d\ude80 \u8282\u70b9\u9009\u62e9",
        type: "select",
        proxies: ["\u267b\ufe0f \u81ea\u52a8\u9009\u62e9", "\ud83d\udd31 \u6545\u969c\u8f6c\u79fb"],
      },
      {
        name: "\u267b\ufe0f \u81ea\u52a8\u9009\u62e9",
        type: "url-test",
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
        proxies: entries.map(e => e.name),
      },
      {
        name: "\ud83d\udd31 \u6545\u969c\u8f6c\u79fb",
        type: "fallback",
        url: "http://www.gstatic.com/generate_204",
        interval: 60,
        proxies: entries.slice(0, Math.min(10, entries.length)).map(e => e.name),
      },
      {
        name: "\ud83c\udf0f \u5168\u7403\u76f4\u8fde",
        type: "select",
        proxies: ["DIRECT"],
      },
      {
        name: "\ud83d\udc1f \u6f0f\u7f51\u4e4b\u9c7c",
        type: "select",
        proxies: ["\ud83d\ude80 \u8282\u70b9\u9009\u62e9", "\ud83c\udf0f \u5168\u7403\u76f4\u8fde"],
      },
    ],
    rules: [
      "GEOSITE,category-ads-all,DIRECT",
      "GEOSITE,cn,\ud83c\udf0f \u5168\u7403\u76f4\u8fde",
      "GEOIP,CN,\ud83c\udf0f \u5168\u7403\u76f4\u8fde,no-resolve",
      "GEOIP,LAN,\ud83c\udf0f \u5168\u7403\u76f4\u8fde,no-resolve",
      "MATCH,\ud83d\udc1f \u6f0f\u7f51\u4e4b\u9c7c",
    ],
  };
  return yaml.dump(config, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

function generateAllYaml(proxies) {
  const output = { proxies: proxies.map(proxyToEntry) };
  return yaml.dump(output, { lineWidth: -1, noRefs: true });
}

function generateBase64Txt(proxies) {
  const lines = [];
  proxies.forEach(p => {
    const uri = genUri(p);
    if (uri) lines.push(uri);
  });
  return lines.join("\n") + "\n";
}

function generateByxiaoxiTxt(proxies) {
  return generateBase64Txt(proxies);
}

function generateKookerJpTxt(proxies) {
  const lines = [];
  proxies.forEach(p => {
    const region = (p.region || "unknown").toLowerCase();
    const flag = getFlag(region);
    const base = cleanDisplayName(p.name);
    const lat = p.speed && p.speed !== "unknown" ? p.speed : (p.latency > 0 ? p.latency + "ms" : "unknown");
    const displayName = flag + " " + getCountryName(region) + " " + base;
    const uri = genUri(p, displayName);
    if (uri) lines.push(uri);
  });
  return lines.join("\n") + "\n";
}

async function main() {
  console.log("=".repeat(60));
  console.log("AutoScrapeFreeNodes - Static Site Generator v3.2");
  console.log("=".repeat(60));

  // Step 1: Try loading from consolidated.json first
  console.log("\n[1/6] Loading data...");
  let proxies = [];
  let dataVersion = "unknown";
  let generatedAt = new Date().toISOString();
  let summary = { totalRaw: 0, unique: 0, reductionRate: "0%" };
  let feeds = { Clash: { count: 0, urls: [] }, V2ray: { count: 0, urls: [] }, "Sing-Box": { count: 0, urls: [] } };
  let sources = [];

  const consolidatedPath = path.join(DATA_DIR, "consolidated.json");
  let fromScraper = false;

  if (fs.existsSync(consolidatedPath)) {
    try {
      const data = fs.readJsonSync(consolidatedPath);
      dataVersion = data.version || "unknown";
      generatedAt = data.generatedAt || generatedAt;
      if (data.summary) summary = data.summary;
      if (data.feeds) feeds = data.feeds;
      if (data.sources) sources = data.sources;

      if (data.merged && data.merged.mihomo && data.merged.mihomo.length > 0) {
        proxies = data.merged.mihomo.filter(p => p && p.type && p.server && p.port);
        fromScraper = true;
        console.log("  From scraper (merged.mihomo): " + proxies.length + " proxies");
      }
      if (data.allProxies && data.allProxies.length > 0) {
        const existing = new Set(proxies.map(p => p.server + ":" + p.port));
        data.allProxies.forEach(p => {
          const key = (p.server || "") + ":" + (p.port || "");
          if (key && !existing.has(key)) {
            existing.add(key);
            proxies.push(p);
          }
        });
        console.log("  Merged allProxies: " + proxies.length + " total");
      }
    } catch (e) {
      console.log("  Failed to load consolidated.json: " + e.message);
    }
  }

  // Step 2: Fallback to FreeSubsCheck_temp if scraper produced nothing
  if (proxies.length === 0) {
    console.log("  Scraper produced 0 proxies, falling back to FreeSubsCheck_temp...");
    const mihomoPath = path.join(REF_DIR, "mihomo.yaml");
    if (fs.existsSync(mihomoPath)) {
      proxies = parseFreeSubsCheckMihomo(mihomoPath);
      console.log("  Parsed " + proxies.length + " proxies from FreeSubsCheck_temp/mihomo.yaml");
    }
  }

  // Step 3: Also try base64.txt for additional protocols
  if (proxies.length > 0) {
    const base64Path = path.join(REF_DIR, "base64.txt");
    if (fs.existsSync(base64Path)) {
      const content = fs.readFileSync(base64Path, "utf8");
      const base64Lines = content.split("\n").filter(l => l.trim().startsWith("dm") || l.trim().startsWith("Cg") || l.trim().length > 50);
      if (base64Lines.length > 0) {
        console.log("  base64.txt has " + base64Lines.length + " encoded entries (reference only)");
      }
    }
  }

  console.log("  Final proxy count: " + proxies.length);

  // Step 4: Generate outputs
  console.log("\n[2/6] Generating output files (" + proxies.length + " proxies)...");
  const outputs = {};
  if (proxies.length > 0) {
    outputs.mihomo_yaml = generateMihomoYaml(proxies);
    console.log("  OK mihomo.yaml (" + (outputs.mihomo_yaml.length / 1024).toFixed(1) + " KB)");
    outputs.all_yaml = generateAllYaml(proxies);
    console.log("  OK all.yaml");
    outputs.base64_txt = generateBase64Txt(proxies);
    console.log("  OK base64.txt");
    outputs.byxiaoxi_txt = generateByxiaoxiTxt(proxies);
    console.log("  OK byxiaoxi.txt");
    outputs.kooker_jp_txt = generateKookerJpTxt(proxies);
    console.log("  OK kooker.jp.txt");
  } else {
    console.log("  No proxies to process. Generating empty files.");
    outputs.mihomo_yaml = "proxies: []\n";
    outputs.all_yaml = "proxies: []\n";
    outputs.base64_txt = "";
    outputs.byxiaoxi_txt = "";
    outputs.kooker_jp_txt = "";
  }

  // Step 5: Setup static site
  console.log("\n[3/6] Setting up static site...");
  fs.ensureDirSync(OUTPUT_DIR);
  const publicSrc = path.join(PROJECT_DIR, "public");
  if (fs.existsSync(publicSrc)) {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.emptyDirSync(OUTPUT_DIR);
    }
    fs.copySync(publicSrc, OUTPUT_DIR);
    console.log("  Copied public/ -> dist/");
  }

  const apiDir = path.join(OUTPUT_DIR, "api");
  fs.ensureDirSync(apiDir);

  const apiData = {
    success: true,
    version: dataVersion,
    generatedAt: generatedAt,
    summary: summary,
    feeds: feeds,
    sources: sources,
    proxyCounts: { mihomo: proxies.length, base64: proxies.length, byxiaoxi: proxies.length, kooker: proxies.length },
    fallback: !fromScraper,
  };
  fs.writeJsonSync(path.join(apiDir, "consolidated.json"), apiData, { spaces: 2 });
  console.log("  OK api/consolidated.json");

  fs.writeJsonSync(path.join(apiDir, "proxy-counts.json"), {
    total: proxies.length,
    fromScraper: fromScraper,
    fromFallback: !fromScraper,
    byType: (() => { const c = {}; proxies.forEach(p => { c[p.type] = (c[p.type] || 0) + 1; }); return c; })(),
    byRegion: (() => { const c = {}; proxies.forEach(p => { const r = (p.region || "unknown").toLowerCase(); c[r] = (c[r] || 0) + 1; }); return c; })(),
  }, { spaces: 2 });
  console.log("  OK api/proxy-counts.json");

  // Update inline-data.js
  const jsDir = path.join(OUTPUT_DIR, "js");
  fs.ensureDirSync(jsDir);
  const inlineJs = "// Auto-generated by generate-static.js\n" +
    "const INLINE_CONFIG = " + JSON.stringify({
      sites: sources,
      settings: { updateInterval: 720, maxArticlesPerSite: 10, lastUpdated: generatedAt, localFreeNodesCount: proxies.length },
      subscriptions: [],
    }, null, 2) + ";\n" +
    "const INLINE_SUBSCRIPTIONS = " + JSON.stringify({
      mihomo: { url: "./mihomo.yaml", type: "clash-meta", count: proxies.length },
      base64: { url: "./base64.txt", type: "v2ray", count: proxies.length },
      byxiaoxi: { url: "./byxiaoxi.txt", type: "v2ray", count: proxies.length },
      kooker: { url: "./kooker.jp.txt", type: "v2ray", count: proxies.length },
    }, null, 2) + ";\n" +
    "const INLINE_SITES = " + JSON.stringify(sources, null, 2) + ";\n" +
    "const REFRESH_RESPONSE = { success: true, message: \"Static site - data updates on rebuild.\" };\n";
  fs.writeFileSync(path.join(jsDir, "inline-data.js"), inlineJs);
  console.log("  OK js/inline-data.js");

  // Step 6: Write output files to dist root
  console.log("\n[4/6] Writing output files to dist/...");
  const fileMap = {
    mihomo_yaml: "mihomo.yaml",
    all_yaml: "all.yaml",
    base64_txt: "base64.txt",
    byxiaoxi_txt: "byxiaoxi.txt",
    kooker_jp_txt: "kooker.jp.txt",
  };
  for (const [key, filename] of Object.entries(fileMap)) {
    if (outputs[key]) {
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), outputs[key], "utf8");
      console.log("  OK " + filename);
    }
  }

  // Save node count for README
  console.log("\n[5/6] Saving metadata...");
  const metaPath = path.join(PROJECT_DIR, ".node-count.json");
  fs.writeJsonSync(metaPath, {
    generatedAt: generatedAt,
    version: dataVersion,
    totalProxies: proxies.length,
    fromScraper: fromScraper,
    byType: (() => { const c = {}; proxies.forEach(p => { c[p.type] = (c[p.type] || 0) + 1; }); return c; })(),
    byRegion: (() => { const c = {}; proxies.forEach(p => { const r = (p.region || "unknown").toLowerCase(); c[r] = (c[r] || 0) + 1; }); return c; })(),
    subscriptionFiles: Object.keys(fileMap).map(k => fileMap[k]).filter(f => outputs[f.replace(/\.[^.]+$/, "_yaml") || f.replace(/\.[^.]+$/, "_txt")]),
  }, { spaces: 2 });
  console.log("  OK .node-count.json");

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Static site generation complete!");
  console.log("  Version:    " + dataVersion);
  console.log("  Proxies:    " + proxies.length);
  console.log("  Source:     " + (fromScraper ? "scraper (live)" : "FreeSubsCheck_temp (reference)"));
  console.log("  Output:     " + OUTPUT_DIR + "/");
  console.log("  Files:      " + Object.keys(fileMap).join(", "));
  console.log("=".repeat(60));

  // Generate README subscription links
  generateReadmeLinks(config);
  generateReadmeLinks(config);
  return true;
}

// ============================================
// Generate README subscription links (Feature 3)
// Adds subscription links table to README.md after generation
// ============================================
function generateReadmeLinks(config) {
  const port = config.settings.port || 3000;
  const baseUrl = 'http://localhost:' + port;
  const links = [
    '| Clash (Mihomo) | \`' + baseUrl + '/api/consolidated?type=clash\` |',
    '| V2ray | \`' + baseUrl + '/api/consolidated?type=v2ray\` |',
    '| Sing-Box | \`' + baseUrl + '/api/consolidated?type=singbox\` |'
  ];
  
  const newSection = [
    '',
    '## \ud83d\udce1 可用订阅链接',
    '',
    '| \u683c\u5f0f | \u94fe\u63a5 |',
    '|------|------|',
    ...links,
    '',
    '> \u26a0\ufe0f \u5b9e\u65f6\u66f4\u65b0\uff0c\u6bcf\u6b21\u6267\u884c npm run build \u540e\u81ea\u52a8\u66f4\u65b0\u3002',
    ''
  ].join('\n');
  
  // Read README
  const readmePath = path.join(PROJECT_DIR, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  
  let readme = fs.readFileSync(readmePath, 'utf8');
  
  // Remove old subscription links section if exists
  readme = readme.replace(/\n## \ud83d\udce1 \u53ef\u7528\u8ba2\u9605\u94fe\u63a5\n[\s\S]*?(?=\n## |$)/, '');
  
  // Insert before License section or at end
  const licenseIdx = readme.indexOf('## \ud83d\udcdc License');
  if (licenseIdx > 0) {
    readme = readme.slice(0, licenseIdx) + newSection + readme.slice(licenseIdx);
  } else {
    readme += newSection;
  }
  
  fs.writeFileSync(readmePath, readme);
  console.log('  OK README subscription links updated');
}


main().then(success => {
  if (success) { console.log("Done."); process.exit(0); }
  else { console.error("Failed."); process.exit(1); }
}).catch(err => {
  console.error("Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
