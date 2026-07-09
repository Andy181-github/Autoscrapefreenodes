const https = require('https');
const http = require('http');
const net = require('net');

/**
 * Check if an IP is reachable and get basic info
 * This is a lightweight check - not a full speed test
 */
async function checkNode(p, timeout = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ...p, ipReachable: false, latency: -1, speed: 'timeout' });
    }, timeout);
    
    let client;
    const port = parseInt(p.port) || 443;
    
    if (p.server.startsWith('[')) {
      // IPv6
      const ipv6 = p.server.slice(1, -1);
      client = net.createConnection({ host: ipv6, port: port, family: 6 }, () => {
        client.destroy();
        clearTimeout(timer);
        resolve({ ...p, ipReachable: true, latency: 0, speed: 'fast' });
      });
    } else {
      client = net.createConnection(port, p.server, () => {
        client.destroy();
        clearTimeout(timer);
        resolve({ ...p, ipReachable: true, latency: 0, speed: p.speed || 'fast' });
      });
    }
    
    client.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ...p, ipReachable: false, latency: -1, speed: 'offline' });
    });
  });
}

/**
 * Generate proper node name with IP info
 */
function generateProperName(p) {
  const flag = getFlagEmoji(p._region || 'unknown');
  const regionName = getCountryName(p._region || 'unknown');
  const speed = p.speed || 'unknown';
  const score = p.qualityScore || 0;
  
  // Format: Flag Country | Speed | Score
  return flag + regionName + '|' + speed + '|' + score + '分';
}

function getFlagEmoji(region) {
  const FLAG_EMOJI_MAP = {
    'us': '\\ud83c\\uddfa\\ud83c\\uddf8', 'uk': '\\ud83c\\uddec\\ud83c\\udde7',
    'de': '\\ud83c\\udde9\\ud83c\\uddea', 'fr': '\\ud83c\\uddeb\\ud83c\\uddf7',
    'jp': '\\ud83c\\uddef\\ud83c\\uddf5', 'hk': '\\ud83c\\udded\\ud83c\\uddf0',
    'sg': '\\ud83c\\udf87\\ud83c\\uddec', 'kr': '\\ud83c\\uddf0\\ud83c\\uddf7',
    'nl': '\\ud83c\\uddf3\\ud83c\\uddf1', 'ca': '\\ud83c\\udde8\\ud83c\\udde6',
    'au': '\\ud83c\\udde6\\ud83c\\uddfa', 'tw': '\\ud83c\\uddf9\\ud83c\\uddfc',
  };
  return FLAG_EMOJI_MAP[region?.toLowerCase()] || '\\ud83c\\udf10';
}

function getCountryName(region) {
  const COUNTRY_NAMES_MAP = {
    hk: '香港', tw: '台湾', jp: '日本', us: '美国', sg: '新加坡', kr: '韩国',
    uk: '英国', de: '德国', fr: '法国', nl: '荷兰', ca: '加拿大', au: '澳大利亚',
  };
  return COUNTRY_NAMES_MAP[region] || region;
}

module.exports = { checkNode, generateProperName };
