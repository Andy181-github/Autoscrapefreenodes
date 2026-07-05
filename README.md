# AutoScrapeFreeNodes

<div align="center">

**自动化免费节点订阅聚合系统**

从多个公开渠道自动抓取、去重、整合 Clash / V2ray / Sing-Box 订阅链接

[![GitHub Stars](https://img.shields.io/github/stars/Andy181-github/Autoscrapefreenodes?style=flat-square)](https://github.com/Andy181-github/Autoscrapefreenodes/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Andy181-github/Autoscrapefreenodes?style=flat-square)](https://github.com/Andy181-github/Autoscrapefreenodes/network/members)
[![License: MIT](https://img.shields.io/github/license/Andy181-github/Autoscrapefreenodes?style=flat-square)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-18%2B-%23339933?style=flat-square)](https://nodejs.org/)

[在线预览](https://andy181-github.github.io/Autoscrapefreenodes/) · [快速开始](#-%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B) · [部署指南](#-%E9%83%A8%E7%BD%B2) · [更新日志](#-v200-)

</div>

---

## 📋 项目简介

AutoScrapeFreeNodes 是一个自动化免费节点订阅聚合工具，从多个公开渠道定期抓取、去重、整合订阅链接，最终输出三条标准化订阅：

| 协议 | 说明 | 输出格式 |
|------|------|----------|
| **Clash** | 兼容 Clash / Clash Meta / Clash Premium | `.yaml` |
| **V2ray** | 兼容 V2Ray / Xray / Hysteria 等 | `.txt` (Base64) |
| **Sing-Box** | 兼容 Sing-Box / Mihomo 新内核 | `.json` |

### 核心特性

- **多源聚合** — 自动抓取 GitHub Pages 站点上的免费节点分享文章
- **智能去重** — 同一 URL 只保留一份，避免重复订阅
- **三频道整合** — 按协议类型自动分类为 Clash / V2ray / Sing-Box 三条订阅
- **定时更新** — GitHub Actions 每日自动运行，数据持续刷新
- **静态部署** — 支持 GitHub Pages 纯静态托管，零服务器成本
- **Docker 支持** — 一行 `docker compose up` 即可运行完整服务

### 数据来源

| 站点 | 类型 | 状态 |
|------|------|------|
| [clashnode.github.io/free-nodes](https://clashnode.github.io/free-nodes/) | GitHub Pages | ✅ 稳定 |
| [clash-meta.github.io/free-nodes](https://clash-meta.github.io/free-nodes/) | GitHub Pages | ✅ 稳定 |
| [airportnode.com](https://www.airportnode.com/category-1.html) | 独立博客 | ⚠️ 偶发 502 |

> ⚠️ 所有数据均来自第三方公开页面，工具本身不存储、不分发任何节点资源。

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9（或使用 yarn / pnpm）

### 本地运行（完整模式）

```bash
# 克隆仓库
git clone https://github.com/Andy181-github/Autoscrapefreenodes.git
cd Autoscrapefreenodes

# 安装依赖
npm install

# 启动服务（默认端口 3000）
npm start

# 开发模式（自动重启）
npm run dev
```

访问 `http://localhost:3000` 查看控制台。

### 静态预览（无依赖）

直接双击打开 `public/index.html` 即可查看上次抓取的数据快照。

### 构建静态站点

```bash
npm run build   # 生成 dist/ 目录，可部署到 GitHub Pages
```

---

## 🗂️ 项目结构

```
Autoscrapefreenodes/
├── scraper.js              # 核心抓取器：解析文章、提取订阅、去重整合
├── index.js                # Express 服务器 + 定时任务 + API 端点
├── generate-static.js      # 静态站点生成器
├── config.json             # 站点配置 + 抓取参数
├── package.json            # 项目元信息 + 依赖
├── data/                   # 抓取数据目录
│   ├── clashnode_github_io.json    # 来源 1 原始数据
│   ├── clash_meta_github_io.json   # 来源 2 原始数据
│   └── consolidated.json           # 去重整合后的最终输出（三条订阅）
├── public/                 # 前端静态文件
│   ├── index.html          # 控制台主页
│   ├── css/                # 样式表
│   └── js/                 # 前端脚本
├── .github/workflows/
│   ├── deploy.yml          # 构建 + 部署到 GitHub Pages
│   └── update-data.yml     # 仅更新数据（不构建静态站）
├── Dockerfile
└── docker-compose.yml
```

---

## ⚙️ 配置说明

### config.json

```json
{
  "sites": [
    {
      "url": "https://clashnode.github.io/free-nodes/",
      "enabled": true,
      "description": "Clash Node 免费节点订阅"
    }
  ],
  "settings": {
    "updateInterval": 720,       // 定时抓取间隔（分钟）
    "maxArticlesPerSite": 10,    // 每个站点最多抓取文章数
    "port": 3000,                // 服务端口
    "dataDir": "data"            // 数据目录
  }
}
```

- 修改 `sites` 数组可添加/移除抓取源
- 设置 `"enabled": false` 可临时禁用某个站点
- 自定义订阅可通过 `config.json` 中的 `subscriptions` 字段手动添加

---

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config` | 获取公开配置信息 |
| `GET` | `/api/subscriptions` | 获取所有订阅数据 |
| `GET` | `/api/sites` | 获取各站点详细数据 |
| `POST` | `/api/refresh` | 手动触发抓取（生产环境建议加鉴权） |
| `GET` | `/api/consolidated` | 获取去重整合后的三条订阅 |

---

## 🐳 部署

### Docker Compose（推荐）

```bash
docker compose up -d
# 访问 http://localhost:3000
```

### GitHub Actions（自动部署）

项目已内置两个工作流：

1. **deploy.yml** — 抓取数据 → 构建静态站 → 部署到 `gh-pages` 分支
   - 定时：北京时间每日 00:30
   - 也可手动触发或 push 到 `main` 时自动运行

2. **update-data.yml** — 仅抓取数据并提交到 `main` 分支
   - 定时：北京时间每日 00:30 和 12:30

---

## 📝 更新日志

### v2.0.0 _(当前版本)_

**重大变更：**

- ✅ **真实抓取** — 废弃 mock 数据，实现基于 `cheerio` 的真实 HTML 解析
- ✅ **智能去重** — 同一 URL 跨文章、跨站点自动去重
- ✅ **三频道整合** — 输出 consolidated.json，包含 Clash / V2ray / Sing-Box 三条独立订阅
- ✅ **版本追踪** — 从 URL 中提取日期戳（如 `20260701`），标注最新版本
- ✅ **双策略解析** — 适配两种不同的订阅标记格式（分隔符式 + 冒号式）
- ✅ **数据目录** — 每个来源站点的原始数据保存在 `data/` 下，便于调试

**已知问题：**

- ⚠️ airportnode.com 文章页频繁返回 502（目标服务器问题，非代码缺陷）

### v1.x

- 初始版本，使用模拟数据
- 基础 Express 服务 + 静态前端

---

## 🔒 安全须知

| 风险项 | 说明 | 缓解措施 |
|--------|------|----------|
| 节点安全性 | 抓取来源为第三方公开页面，节点质量无法保证 | 使用者自行判断，不建议用于敏感场景 |
| 法律合规 | 使用免费节点可能违反当地法律法规 | 使用者需自行遵守所在地区法律 |
| `/api/refresh` 无鉴权 | 任何人可触发抓取 | 生产环境建议添加 token 认证或反向代理限流 |
| CORS `*` | 开放所有来源 | 生产环境建议限制为可信域名 |

---

## ⚖️ 免责声明

1. 本项目仅作为技术交流与学术研究使用。
2. 所有节点数据均来源于第三方互联网公开页面，工具本身不存储、不分发任何服务器资源。
3. 使用者应自行判断节点安全性，并严格遵守当地相关法律法规。
4. 作者不对因使用本工具导致的任何形式的损失或法律纠纷负责。
5. 使用本项目即表示你同意上述条款。

---

## 📄 License

[MIT License](LICENSE)

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Andy181-github/Autoscrapefreenodes&type=date)](https://star-history.com/#Andy181-github/Autoscrapefreenodes&Date)
