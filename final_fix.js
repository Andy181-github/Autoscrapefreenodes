const fs = require("fs");
const path = "D:\\Codex skill\\AutoScrapeFreeNodes\\scraper.js";
let content = fs.readFileSync(path, "utf8");

// 1. Replace axios with native https in httpGet
content = content.replace(
  /async function httpGet\(url, retries = 2, timeout = 15000\) \{[\s\S]*?function extractUrls/,
  `async function httpGet(url, retries = 3, timeout = 15000) {
  httpGet._delay = httpGet._delay || 5000;
  httpGet._last = httpGet._last || 0;
  const now = Date.now();
  const wait = httpGet._delay - (now - httpGet._last);
  if (wait > 0) { await new Promise(r => setTimeout(r, wait)); }
  httpGet._last = Date.now();
  
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const https = require("https");
        const req = https.get(url, {
          headers: { "User-Agent": UA, "Accept": "*/*" },
          timeout: timeout
        }, (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => resolve({ data: data }));
        });
        
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });
      
      return result.data;
    } catch (e) {
      if (i === retries) throw e;
      console.log(\`  [WARN] Retry \${i+1}/\${retries} for \${url}: \${e.message}\`);
      await new Promise(resolve => setTimeout(resolve, 3000 * (i + 1)));
    }
  }
}

`
);

// 2. Fix convertYamlProxyToEntry - move region before usage
content = content.replace(
  /function convertYamlProxyToEntry\(p\) \{[\s\S]*?let region = "unknown";/,
  `function convertYamlProxyToEntry(p) {
  let region = "unknown";`
);

// 3. Update buildDisplayName to include quality score
content = content.replace(
  /function buildDisplayName\(p\) \{[\s\S]*?return flag \+ base \+ "\|" \+ lat;[\s\S]*?\}/,
  `function buildDisplayName(p) {
  const region = (p._region || "unknown").toLowerCase();
  const flag = getFlagEmoji(region);
  const base = cleanProxyName(p.name);
  const speed = p.speed || "unknown";
  const score = p.qualityScore || 0;
  return flag + base + "|" + speed + "|" + score + "分";
}`
);

fs.writeFileSync(path, content, "utf8");
console.log("Applied all fixes");
