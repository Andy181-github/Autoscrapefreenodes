const fs = require('fs-extra');
const path = require('path');

const config = require('./config.json');
const OUTPUT_DIR = 'dist';
const DATA_DIR = path.join(__dirname, config.settings.dataDir || 'data');

async function generateStaticSite() {
  try {
    console.log('开始生成静态网站...');
    console.log('清空输出目录: ' + OUTPUT_DIR);
    fs.ensureDirSync(OUTPUT_DIR);
    fs.emptyDirSync(OUTPUT_DIR);
    console.log('复制静态资源...');
    fs.copySync('public', OUTPUT_DIR);
    const apiDir = path.join(OUTPUT_DIR, 'api');
    fs.ensureDirSync(apiDir);
    const configData = {
      sites: config.sites.map(site => ({ url: site.url, description: site.description, enabled: site.enabled })),
      settings: { updateInterval: config.settings.updateInterval, maxArticlesPerSite: config.settings.maxArticlesPerSite, lastUpdated: new Date().toISOString() }
    };
    fs.writeJsonSync(path.join(apiDir, 'config.json'), configData);
    fs.ensureDirSync(DATA_DIR);
    console.log('执行数据抓取...');
    const scraper = require('./scraper');
    const scrapeResult = await scraper.scrapeAllSites();
    fs.writeJsonSync(path.join(DATA_DIR, 'consolidated.json'), scrapeResult, { spaces: 2 });
    console.log('抓取结果已保存');
    const sitesData = {};
    const subscriptionsData = {};
    if (scrapeResult.feeds) {
      for (const [feedName, feedData] of Object.entries(scrapeResult.feeds)) {
        if (feedData && feedData.urls && feedData.urls.length > 0) {
          const sn = feedName.toLowerCase().replace(/[-\s]/g, '_');
          sitesData[sn] = { feedName, url: feedData.urls[0], siteName: feedName + ' Feed', scrapedAt: scrapeResult.generatedAt, totalSubscriptions: feedData.count, subscriptions: feedData.urls.map((u, i) => ({ type: feedName, name: feedName + ' Subscription ' + (i+1), url: u })) };
          subscriptionsData[sn] = sitesData[sn];
        }
      }
    }
    const sf = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== 'consolidated.json');
    sf.forEach(file => { try { sitesData[file.replace('.json', '')] = fs.readJsonSync(path.join(DATA_DIR, file)); } catch(e){} });
    fs.writeJsonSync(path.join(apiDir, 'sites.json'), sitesData);
    fs.writeJsonSync(path.join(apiDir, 'subscriptions.json'), subscriptionsData);
    console.log('创建内联数据文件...');
    const ic = JSON.stringify(configData, null, 2);
    const is2 = JSON.stringify(subscriptionsData, null, 2);
    const iS = JSON.stringify(sitesData, null, 2);
    const ir = JSON.stringify({ success: true, message: '静态站点不支持实时刷新功能。数据会在每次构建时自动更新。' }, null, 2);
    const idj = 'const INLINE_CONFIG = ' + ic + ';\nconst INLINE_SUBSCRIPTIONS = ' + is2 + ';\nconst INLINE_SITES = ' + iS + ';\nconst REFRESH_RESPONSE = ' + ir + ';';
    fs.writeFileSync(path.join(OUTPUT_DIR, 'js', 'inline-data.js'), idj);
    console.log('静态网站生成完成！');
    return true;
  } catch (error) {
    console.error('生成静态网站时出错:', error);
    return false;
  }
}
generateStaticSite().then(success => {
  if (success) { console.log('静态网站文件已生成在 ' + OUTPUT_DIR + ' 目录中'); process.exit(0); }
  else { console.error('静态网站生成失败'); process.exit(1); }
});