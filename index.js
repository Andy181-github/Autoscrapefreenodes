const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { CronJob } = require('cron');
const scraper = require('./scraper');
const cors = require('cors');

const config = scraper.loadConfig();
const settings = config.settings;

const app = express();
const PORT = process.env.PORT || settings.port || 3000;

const dataDir = path.join(__dirname, settings.dataDir || 'data');
fs.ensureDirSync(dataDir);

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

const API_TOKEN = process.env.API_TOKEN || config.settings.apiToken || null;

function verifyToken(req, res, next) {
  if (!API_TOKEN) return next();
  const token = req.query.token || req.headers['x-api-token'];
  if (token === API_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized: invalid or missing API token' });
}

app.get('/api/config', (req, res) => {
  try {
    res.json({
      sites: config.sites.map(site => ({ url: site.url, description: site.description, enabled: site.enabled })),
      settings: { updateInterval: settings.updateInterval, maxArticlesPerSite: settings.maxArticlesPerSite, lastUpdated: new Date().toISOString() }
    });
  } catch (error) { res.status(500).json({ error: '获取配置失败' }); }
});

app.get('/api/subscriptions', (req, res) => {
  try {
    const subscriptionsData = {};
    const sites = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
    if (sites.length === 0) return res.json({});
    sites.forEach(site => {
      try {
        const siteData = fs.readJsonSync(path.join(dataDir, site));
        const siteName = site.replace('.json', '');
        const processedData = { url: siteData.url, siteName: siteData.siteName, scrapedAt: siteData.scrapedAt, subscriptionCount: siteData.totalSubscriptions || 0, subscriptions: [] };
        if (siteData.articles && Array.isArray(siteData.articles)) {
          siteData.articles.forEach(article => {
            if (article.subscriptions && Array.isArray(article.subscriptions)) {
              processedData.subscriptions = processedData.subscriptions.concat(article.subscriptions.map(sub => ({ ...sub, articleTitle: article.title, articleUrl: article.url })));
            }
          });
        }
        subscriptionsData[siteName] = processedData;
      } catch (e) { console.error('Error reading ' + site + ': ' + e.message); }
    });
    res.json(subscriptionsData);
  } catch (error) { res.status(500).json({ error: '获取订阅数据失败' }); }
});

app.get('/api/consolidated', (req, res) => {
  try {
    const consolidatedPath = path.join(dataDir, 'consolidated.json');
    if (fs.existsSync(consolidatedPath)) {
      const data = fs.readJsonSync(consolidatedPath);
      const { renamedContent: _, merged: _merged, ...safeData } = data;
      res.json(safeData);
    } else {
      res.json({ message: '暂无整合数据，请先运行抓取' });
    }
  } catch (error) { res.status(500).json({ error: '获取整合数据失败' }); }
});

app.post('/api/refresh', verifyToken, async (req, res) => {
  try {
    console.log('[API] Manual refresh triggered');
    const result = await scraper.scrapeAllSites();
    const consolidatedPath = path.join(dataDir, 'consolidated.json');
    fs.writeJsonSync(consolidatedPath, result, { spaces: 2 });
    res.json({ success: true, message: '数据更新完成', data: { version: result.version, summary: result.summary, generatedAt: result.generatedAt } });
  } catch (error) {
    console.error('[API] Refresh failed:', error);
    res.status(500).json({ success: false, message: '数据更新失败', error: error.message });
  }
});

if (settings.updateInterval && settings.updateInterval > 0) {
  const intervalMinutes = settings.updateInterval;
  new CronJob('0 */' + intervalMinutes + ' * * * *', async function() {
    console.log('[Cron] Scheduled update started');
    try {
      const result = await scraper.scrapeAllSites();
      const consolidatedPath = path.join(dataDir, 'consolidated.json');
      fs.writeJsonSync(consolidatedPath, result, { spaces: 2 });
      console.log('[Cron] Scheduled update completed');
    } catch (error) { console.error('[Cron] Scheduled update failed:', error); }
  }, null, true);
}

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Frontend: http://localhost:' + PORT);
  console.log('API: http://localhost:' + PORT + '/api/subscriptions');
  console.log('Consolidated: http://localhost:' + PORT + '/api/consolidated');
});
