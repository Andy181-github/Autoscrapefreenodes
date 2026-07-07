const fs = require('fs-extra');
const path = require('path');

const HISTORICAL_FILE = path.join(__dirname, '..', 'data', 'historical.json');

async function loadHistoricalProxies() {
  try {
    if (!fs.existsSync(HISTORICAL_FILE)) {
      console.log('[History] No historical data found, skipping fallback');
      return [];
    }
    const data = await fs.readJson(HISTORICAL_FILE);
    if (!data || !data.proxies || !Array.isArray(data.proxies)) {
      console.log('[History] Invalid historical data format');
      return [];
    }
    console.log('[History] Loaded ' + data.proxies.length + ' historical proxies');
    return data.proxies;
  } catch (e) {
    console.log('[History] Error loading historical data: ' + e.message);
    return [];
  }
}

async function saveHistoricalProxies(proxies) {
  try {
    const dir = path.dirname(HISTORICAL_FILE);
    await fs.ensureDir(dir);
    const data = {
      savedAt: new Date().toISOString(),
      version: '3.3.0',
      count: proxies.length,
      proxies: proxies.map(p => ({
        name: p.name, type: p.type, server: p.server, port: p.port,
        region: p.region, latency: p.latency, uuid: p.uuid, password: p.password,
        cipher: p.cipher, network: p.network, tls: p.tls, sni: p.sni,
        quality: p.quality, mediaBadges: p.mediaBadges
      }))
    };
    await fs.writeJson(HISTORICAL_FILE, data, { spaces: 2 });
    console.log('[History] Saved ' + data.count + ' proxies to historical.json');
  } catch (e) {
    console.log('[History] Error saving historical data: ' + e.message);
  }
}

module.exports = { loadHistoricalProxies, saveHistoricalProxies };
