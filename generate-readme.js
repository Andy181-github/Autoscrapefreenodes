// generate-readme.js — 只更新 README 顶部的 3 个节点数量徽章 (SubsCheck / XiaoXi / kooker.jp)。
//
// 注意: README 正文 (同步时间 / 节点统计 / 地区分布 / 订阅链接) 由 scraper.js 的
// updateREADME() 统一写入。历史版本里本脚本曾整篇重写 README (表格格式的订阅链接 +
// 自己的"### 📊 节点统计"区块), 与 scraper.js 的列表格式交错, 导致 README 里同时
// 出现两套订阅链接区块 (即"混入内容")。现在本脚本只替换 3 行徽章, 且仅在数字变化时写盘。

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

const ROOT_DIR = __dirname;

function getCounts() {
  const counts = { subscheck: 0, xiaoxi: 0, kooker: 0 };

  // Count mihomo.yaml proxies
  const mihomoPath = path.join(ROOT_DIR, 'artifacts', 'subs', 'mihomo.yaml');
  if (fs.existsSync(mihomoPath)) {
    try {
      const doc = yaml.load(fs.readFileSync(mihomoPath, 'utf8'));
      if (doc && doc.proxies && Array.isArray(doc.proxies)) {
        counts.subscheck = doc.proxies.length;
      }
    } catch (e) { /* ignore */ }
  }

  // Count byxiaoxi.txt non-empty lines
  const xiaoxiPath = path.join(ROOT_DIR, 'artifacts', 'subs', 'byxiaoxi.txt');
  if (fs.existsSync(xiaoxiPath)) {
    const lines = fs.readFileSync(xiaoxiPath, 'utf8').split('\n').filter(l => l.trim());
    counts.xiaoxi = lines.length;
  }

  // Count kooker.jp.txt non-empty lines
  const kookerPath = path.join(ROOT_DIR, 'artifacts', 'subs', 'kooker.jp.txt');
  if (fs.existsSync(kookerPath)) {
    const lines = fs.readFileSync(kookerPath, 'utf8').split('\n').filter(l => l.trim());
    counts.kooker = lines.length;
  }

  return counts;
}

function updateBadges() {
  const counts = getCounts();
  const readmePath = path.join(ROOT_DIR, 'README.md');
  let readme;
  try {
    readme = fs.readFileSync(readmePath, 'utf8');
  } catch (e) {
    console.log('README.md not found; nothing to update.');
    return false;
  }

  let changed = false;
  const badgeRules = [
    [
      /!\[SubsCheck\]\(https:\/\/img\.shields\.io\/badge\/SubsCheck-\d+-green\)/,
      `![SubsCheck](https://img.shields.io/badge/SubsCheck-${counts.subscheck}-green)`
    ],
    [
      /!\[XiaoXi\]\(https:\/\/img\.shields\.io\/badge\/XiaoXi-\d+-orange\)/,
      `![XiaoXi](https://img.shields.io/badge/XiaoXi-${counts.xiaoxi}-orange)`
    ],
    [
      /!\[kooker\.jp\]\(https:\/\/img\.shields\.io\/badge\/kooker\.jp-\d+-purple\)/,
      `![kooker.jp](https://img.shields.io/badge/kooker.jp-${counts.kooker}-purple)`
    ]
  ];

  for (const [re, replacement] of badgeRules) {
    const next = readme.replace(re, replacement);
    if (next !== readme) {
      readme = next;
      changed = true;
    }
  }

  if (!changed) {
    console.log('Badge counts unchanged; skipping README write.');
    return false;
  }

  fs.writeFileSync(readmePath, readme, 'utf8');
  console.log(`Badges updated: SubsCheck=${counts.subscheck}, XiaoXi=${counts.xiaoxi}, kooker=${counts.kooker}`);
  return true;
}

// Run
updateBadges();
