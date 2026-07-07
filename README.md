# AutoScrapeFreeNodes

<div align="center">

**自动化免费节点订阅聚合系统 v3.0**

从多个公开渠道自动抓取、去重、检测IP、重命名节点，整合为 Clash / V2ray / Sing-Box 三种格式的订阅链接

[![GitHub Stars](https://img.shields.io/github/stars/Andy181-github/Autoscrapefreenodes?style=flat-square)](https://github.com/Andy181-github/Autoscrapefreenodes/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Andy181-github/Autoscrapefreenodes?style=flat-square)](https://github.com/Andy181-github/Autoscrapefreenodes/network/members)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg?style=flat-square)](https://nodejs.org/)

</div>

---

## ✨ 功能特性

- **多源抓取** — 自动从 `clashnode.github.io`、`clash-meta.github.io`、`airportnode.com` 抓取订阅链接
- **内容去重** — 基于 SHA256 hash 比对订阅文件内容，消除重复链接
- **节点IP检测** — 解析订阅文件中的节点信息，根据 IP 地址和节点名称推断所在地区
- **智能重命名** — 自动为节点添加地区前缀（如 `hk-节点名`、`jp-节点名`）
- **三格式整合** — 输出 Clash (YAML)、V2ray (TXT)、Sing-Box (JSON) 三种格式
- **定时更新** — 支持 cron 定时任务和手动 API 触发
- **静态部署** — 一键生成静态站点部署到 GitHub Pages
- **API Token 保护** — 刷新接口支持 token 验证

## 📋 数据源

| 来源 | URL | 说明 |
|------|-----|------|
| ClashNode | [clashnode.github.io/free-nodes](https://clashnode.github.io/free-nodes/) | Clash 免费节点分享 |
| Clash-Meta | [clash-meta.github.io/free-nodes](https://clash-meta.github.io/free-nodes/) | Clash Meta 免费节点分享 |
| AirportNode | [airportnode.com/freenode](https://airportnode.com/freenode/) | 机场节点分享 |

> ⚠️ 所有数据源均为公开分享网站，仅供学习研究用途。

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/Andy181-github/Autoscrapefreenodes.git
cd Autoscrapefreenodes
npm install
```

### 配置

编辑 `config.json`：

```json
{
  "settings": {
    "apiToken": "your_secret_token",  // API刷新接口密钥
    "updateInterval": 720,             // 定时更新间隔（分钟）
    "port": 3000
  }
} 
```

### 运行

**动态模式（推荐开发使用）：**
```bash
npm start           # 启动服务器 (port 3000)
npm run dev         # 启动服务器 + nodemon热重载
```

**静态部署模式：**
```bash
npm run build       # 生成静态站点到 dist/
npm test            # 测试静态站点
```

## 📡 API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/config` | 获取配置信息 | ❌ |
| GET | `/api/subscriptions` | 获取所有订阅数据 | ❌ |
| GET | `/api/consolidated` | 获取整合后的数据 | ❌ |
| POST | `/api/refresh` | 触发数据抓取更新 | ✅ Token |

**触发刷新：**
```bash
# 方式1: 查询参数
curl -X POST "http://localhost:3000/api/refresh?token=YOUR_TOKEN"

# 方式2: 请求头
curl -X POST "http://localhost:3000/api/refresh" -H "x-api-token: YOUR_TOKEN"
```

## 📁 项目结构

```
Autoscrapefreenodes/
├── scraper.js           # 核心抓取逻辑（去重、IP检测、重命名）
├── index.js             # Express 服务器 + API 端点
├── generate-static.js   # 静态站点生成器
├── config.json          # 配置文件
├── data/
│   └── consolidated.json  # 整合后的订阅数据
├── public/              # 前端静态文件
│   ├── index.html
│   └── js/
│       ├── app.js
│       ├── config.js
│       └── inline-data.js
├── .github/workflows/   # GitHub Actions
│   ├── deploy.yml       # 静态部署到 gh-pages
│   └── update-data.yml  # 数据自动更新
├── Dockerfile
└── package.json
```

## 🔄 版本号历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v3.0.0 | 2026-07-06 | 重写 scraper.js 实现真实抓取；添加 SHA256 内容去重；节点IP检测与地区重命名；三格式订阅整合；API Token 验证 |
| v2.1.0 | 2026-07-05 | 更新文档、修复链接、清理测试数据 |
| v2.0.0 | 2026-07-04 | 初始抓取框架 |
| v1.0.0 | 2026-07-03 | 项目初始化 |

## 🐳 Docker 部署

```bash
docker build -t autoscrape .
docker run -p 3000:3000 -e API_TOKEN=your_token autoscrape
```

或使用 docker-compose：
```bash
docker-compose up -d
```

## ⚙️ 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `API_TOKEN` | API刷新接口密钥 | 从 config.json 读取 |

## 🔒 安全说明

- `/api/refresh` 接口支持 Token 验证，请设置强密码
- 生产环境建议使用 HTTPS
- 数据源为公开网站，请遵守各网站的使用条款
- 本工具仅供学习研究，请勿用于商业用途

## 🛠 开发

```bash
npm install              # 安装依赖
npm run dev              # 开发模式（热重载）
npm run build            # 构建静态站点
npm test                 # 测试静态站点
```

## 📄 License

[MIT](LICENSE) © Andy181-github
