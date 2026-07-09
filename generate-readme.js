// generate-readme.js — Generate README.md with subscription links and stats
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

const ROOT_DIR = __dirname;
const REPO_OWNER = 'Andy181-github'; // Will be overridden by GH_ACTIONS_REPO_OWNER env var
const REPO_NAME = 'AutoScrapeFreeNodes'; // Will be overridden by GH_ACTIONS_REPO_NAME env var

function getCounts() {
  const counts = { subscheck: 0, xiaoxi: 0, kooker: 0 };

  // Count mihomo.yaml proxies
  const mihomoPath = path.join(ROOT_DIR, 'mihomo.yaml');
  if (fs.existsSync(mihomoPath)) {
    try {
      const doc = yaml.load(fs.readFileSync(mihomoPath, 'utf8'));
      if (doc && doc.proxies && Array.isArray(doc.proxies)) {
        counts.subscheck = doc.proxies.length;
      }
    } catch (e) { /* ignore */ }
  }

  // Count byxiaoxi.txt non-empty lines
  const xiaoxiPath = path.join(ROOT_DIR, 'byxiaoxi.txt');
  if (fs.existsSync(xiaoxiPath)) {
    const lines = fs.readFileSync(xiaoxiPath, 'utf8').split('\n').filter(l => l.trim());
    counts.xiaoxi = lines.length;
  }

  // Count kooker.jp.txt non-empty lines
  const kookerPath = path.join(ROOT_DIR, 'kooker.jp.txt');
  if (fs.existsSync(kookerPath)) {
    const lines = fs.readFileSync(kookerPath, 'utf8').split('\n').filter(l => l.trim());
    counts.kooker = lines.length;
  }

  return counts;
}

function getBranch() {
  // In GitHub Actions, use the actual branch; otherwise default to main
  return process.env.GITHUB_REF ? process.env.GITHUB_REF.replace('refs/heads/', '') : 'main';
}

function generateREADME() {
  const counts = getCounts();
  const updateTime = new Date();
  const beijingTime = updateTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-');
  const isoTime = updateTime.toISOString();
  const branch = getBranch();

  // Check if there were changes compared to previous README
  const readmePath = path.join(ROOT_DIR, 'README.md');
  let hadChanges = true;
  if (fs.existsSync(readmePath)) {
    const oldReadme = fs.readFileSync(readmePath, 'utf8');
    // Simple heuristic: if proxy counts match and time is within 3 hours, skip regeneration
    const oldSubsMatch = oldReadme.match(/SubsCheck.*?(\d+)/);
    const oldXiaoxiMatch = oldReadme.match(/XiaoXi.*?(\d+)/);
    const oldKookerMatch = oldReadme.match(/kooker\.jp.*?(\d+)/);
    if (oldSubsMatch && oldXiaoxiMatch && oldKookerMatch) {
      if (parseInt(oldSubsMatch[1]) === counts.subscheck &&
          parseInt(oldXiaoxiMatch[1]) === counts.xiaoxi &&
          parseInt(oldKookerMatch[1]) === counts.kooker) {
        // Check timestamp
        const timeMatch = oldReadme.match(/最后同步时间.*?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        if (timeMatch) {
          const oldTime = new Date(timeMatch[1]);
          const diffHours = (updateTime - oldTime) / (1000 * 60 * 60);
          if (diffHours < 3) {
            hadChanges = false;
            console.log('README content unchanged, skipping regeneration.');
          }
        }
      }
    }
  }

  if (!hadChanges) return false;

  const rawBaseUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}`;

  const readme = `# 🌐 订阅自动更新

![Update](https://img.shields.io/badge/更新频率-每2小时-blue)
![SubsCheck](https://img.shields.io/badge/SubsCheck-${counts.subscheck}-green)
![XiaoXi](https://img.shields.io/badge/XiaoXi-${counts.xiaoxi}-orange)
![kooker.jp](https://img.shields.io/badge/kooker.jp-${counts.kooker}-purple)

> **最后同步时间**：\`${beijingTime}\` (北京时间)
> **ISO 时间**：\`${isoTime}\`

### 📊 节点统计
- **SubsCheck 节点数**：\`${counts.subscheck}\`
- **XiaoXi 节点数**：\`${counts.xiaoxi}\`
- **kooker.jp 节点数**：\`${counts.kooker}\`

### 🚀 订阅链接
| 类型 | 订阅地址 |
| :--- | :--- |
| **Mihomo / Clash Meta** | [\`mihomo.yaml\`](${rawBaseUrl}/mihomo.yaml) |
| **Clash / Standard** | [\`all.yaml\`](${rawBaseUrl}/all.yaml) |
| **Base64 (通用)** | [\`base64.txt\`](${rawBaseUrl}/base64.txt) |
| **通用TXT (XiaoXi)** | [\`byxiaoxi.txt\`](${rawBaseUrl}/byxiaoxi.txt) |
| **通用TXT (kooker.jp)** | [\`kooker.jp.txt\`](${rawBaseUrl}/kooker.jp.txt) |

---

## ⚖️ 免责声明 (Disclaimer)

### 1. 权利归属及性质
本仓库（下称"本项目"）仅为个人学习 **GitHub Actions** 自动化流程及 **YAML** 数据处理的技术演示。项目内分享的所有资源（包括但不限于订阅链接、节点数据）均搜集自互联网公开渠道，本项目不存储、不分发、不产生任何实质性的加密通信流量。

### 2. 法律合规性
* **合规义务**：用户在下载、安装或使用本项目涉及的任何资源时，必须确保其行为符合所在国家/地区的法律法规。
* **禁止违规**：严禁将本项目提供的技术方案或资源用于任何形式的非法用途。因用户违规使用产生的任何行政或刑事责任，由用户本人独立承担，与本项目及其贡献者无关。

### 3. 风险提示与担保限制
* **无保证声明**：本项目不对资源的稳定性、有效性、安全性作任何形式的保证。节点可能随时失效、被封锁或存在安全隐患。
* **隐私风险**：第三方节点可能存在流量审计或日志记录行为。建议用户避免通过本项目提供的节点传输任何涉及个人隐私、财务安全或敏感信息的数据。

### 4. 责任免除
本项目贡献者不对因使用本项目而导致的任何直接、间接、附带或惩罚性损害（包括但不限于设备损坏、数据丢失、法律纠纷）承担法律责任。

---
**数据来源**: 互联网公开频道聚合
*由 [AutoScrapeFreeNodes](https://github.com/${REPO_OWNER}/${REPO_NAME}) & GitHub Actions 提供自动引擎驱动*
`;

  fs.writeFileSync(readmePath, readme, 'utf8');
  console.log(`README.md generated: SubsCheck=${counts.subscheck}, XiaoXi=${counts.xiaoxi}, kooker=${counts.kooker}`);
  return true;
}

// Run
const changed = generateREADME();
if (!changed) {
  console.log('Skipping README update (no changes detected).');
}
