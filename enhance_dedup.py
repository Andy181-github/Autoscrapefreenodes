import re

path = r'D:\Codex skill\AutoScrapeFreeNodes\scraper.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the generateRenamedContent function and add proxy-level dedup before it
# We need to add deduplication right after mergeAndDeduplicate returns feeds

# Find where allProxies is collected and add dedup there
old_collect = '''  // Collect all proxy objects from all feeds
  const allProxies = [];
  const proxySet = new Set();'''

new_collect = '''  // Collect all proxy objects from all feeds WITH PROXY-LEVEL DEDUPLICATION
  const allProxies = [];
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
  }'''

content = content.replace(old_collect, new_collect)

# Now replace the proxy collection loops to use the new dedup function
# Find the Clash proxy collection
old_clash_collect = '''    if (renamedContent.clash) {
      for (const [url, yamlContent] of Object.entries(renamedContent.clash)) {
        try {
          const config = yaml.load(yamlContent);
          if (config && config.proxies) {'''

new_clash_collect = '''    if (renamedContent.clash) {
      for (const [url, yamlContent] of Object.entries(renamedContent.clash)) {
        try {
          const config = yaml.load(yamlContent);
          if (config && config.proxies) {
            config.proxies.forEach(p => addProxyDeduped(p));'''

content = content.replace(old_clash_collect, new_clash_collect)

# Find the closing of the clash foreach and add break for next section
old_clash_close = '''        } catch (e) {
          console.log(\  [ERROR] Failed to parse Clash YAML from \: \\);
        }
      }
    }
    
    // Extract from V2ray renamed content'''

new_clash_close = '''        } catch (e) {
          console.log(\  [ERROR] Failed to parse Clash YAML from \: \\);
        }
      }
    }
    
    // Dedup count info
    console.log(\  [DEDUP] Total unique server:port combos: \\);
    
    // Extract from V2ray renamed content'''

content = content.replace(old_clash_close, new_clash_close)

# Update V2ray collection to use dedup
old_v2ray_collect = '''        if (renamedContent.v2ray) {
      for (const [url, txtContent] of Object.entries(renamedContent.v2ray)) {
        try {
          const lines = txtContent.split('\\n');
          lines.forEach(line => {
            try {
              const entry = parseV2rayLineToEntry(line);
              if (entry) {
                allProxies.push(entry);'''

new_v2ray_collect = '''        if (renamedContent.v2ray) {
      for (const [url, txtContent] of Object.entries(renamedContent.v2ray)) {
        try {
          const lines = txtContent.split('\\n');
          lines.forEach(line => {
            try {
              const entry = parseV2rayLineToEntry(line);
              if (entry) {
                addProxyDeduped(entry);'''

content = content.replace(old_v2ray_collect, new_v2ray_collect)

# Update Sing-Box collection to use dedup
old_singbox_collect = '''        if (renamedContent.singbox) {
      for (const [url, jsonContent] of Object.entries(renamedContent.singbox)) {
        try {
          const config = JSON.parse(jsonContent);
          if (config && config.outbounds) {
            config.outbounds.forEach(ob => {
              if (ob.server && ob.port) {
                const entry = singboxToEntry(ob);
                if (entry) allProxies.push(entry);'''

new_singbox_collect = '''        if (renamedContent.singbox) {
      for (const [url, jsonContent] of Object.entries(renamedContent.singbox)) {
        try {
          const config = JSON.parse(jsonContent);
          if (config && config.outbounds) {
            config.outbounds.forEach(ob => {
              if (ob.server && ob.port) {
                const entry = singboxToEntry(ob);
                if (entry) addProxyDeduped(entry);'''

content = content.replace(old_singbox_collect, new_singbox_collect)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Enhanced deduplication with server:port tracking')
