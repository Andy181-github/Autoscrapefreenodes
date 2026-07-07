# AutoScrapeFreeNodes

<div align="center">
**自动化免费节点订阅聚合系统 v3.3**
从多个公开渠道自动抓取、去重、检测、合并 Clash / V2ray / Sing-Box 订阅链接
[![GitHub Stars](https://img.shields.io/github/stars/Andy181-github/Autoscrapefreenodes?style=flat-square)](https://github.com/Andy181-github/Autoscrapefreenodes/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
</div>

---

## ✨ 功能特性

- **多源抓取** — 自动从 `clashnode.github.io`、`clash-meta.github.io`、`airportnode.com` 抓取订阅链接
- **内容去重** — 基于 SHA256 hash 比对订阅文件内容，消除重复链接
- **节点级解析** — 下载每个订阅文件，解析出独立代理节点（参照 [li5bo5/subs-check](https://github.com/li5bo5/subs-check)）
- **Fingerprint 全字段去重** — 按服务器IP+端口去重节点，避免同一节点出现在多个订阅中
- **节点IP检测** — 解析订阅文件中的节点信息，根据 IP 地址和节点名称推断所在地区
- **智能重命名** — 自动为节点添加国旗 emoji 地区前缀（如 `🇭🇰hk-proxy`、`🇯🇵jp-tokyo`）
- **连通性检测** — 对每个节点进行快速 DNS + HTTP 连接测试（参照 [beck-8/subs-check](https://github.com/beck-8/subs-check)）
- **三格式整合** — 输出 Clash (YAML)、V2ray (TXT)、Sing-Box (JSON) 三种格式
- **FreeSubsCheck 风格输出** — 生成 mihomo.yaml / all.yaml / base64.txt / byxiaoxi.txt / kooker.jp.txt
- **定时更新** — 支持 cron 定时任务和手动 API 触发
- **静态部署** — 一键生成静态站点部署到 GitHub Pages
- **API Token 保护** — 刷新接口支持 token 验证

## 📋 数据源

| 来源 | URL | 说明 |
|------|-----|------|
| ClashNode | [clashnode.github.io/free-nodes](https://clashnode.github.io/free-nodes/) | Clash 免费节点分享 |
| Clash-Meta | [clash-meta.github.io/free-nodes](https://clash-meta.github.io/free-nodes/) | Clash Meta 免费节点分享 |
| AirportNode | [airportnode.com/freenode](https://airportnode.com/freenode) | 机场节点分享 |

> ⚠️ 所有数据源均为公开分享网站，仅供学习研究用途。

## 🚀 快速开始

```bash
git clone https://github.com/Andy181-github/Autoscrapefreenodes.git
cd Autoscrapefreenodes
npm install
npm start           # 启动服务器
curl -X POST "http://localhost:3000/api/refresh?token=YOUR_TOKEN"  # 触发抓取
```

## 📡 API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/consolidated` | 获取整合数据（含 merged 输出） | ❌ |
| POST | `/api/refresh` | 触发数据抓取更新 | ✅ Token |

## 🔄 版本号历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v3.2.1 | 2026-07-07 | 修复：噪声过滤、URL更新、版本同步
| v3.3.0 | 2026-07-07 | 新增：Fingerprint 去重、媒体平台解锁检测、质量评分(S-A-B-C-D)、Shuffle 测试顺序、README 订阅链接 |
| v3.2.0 | 2026-07-06 | 节点级解析、Server:Port 去重、连通性检测、FreeSubsCheck 风格输出、国旗 emoji 重命名 |
| v3.1.0 | 2026-07-06 | 订阅文件有效性过滤、区域检测按别名长度优先匹配 |
| v3.0.0 | 2026-07-06 | 重写 scraper.js 实现真实抓取；SHA256 内容去重；节点IP检测与地区重命名；三格式订阅整合；API Token 验证 |
| v2.1.0 | 2026-07-05 | 更新文档、修复链接、清理测试数据 |

## 🏗 架构参考

本项目的节点检测与合并逻辑参考了以下开源项目：
- **[beck-8/subs-check](https://github.com/beck-8/subs-check)** — 节点连通性检测、速度测试、并发工作池
- **[li5bo5/subs-check](https://github.com/li5bo5/subs-check)** — YAML/URI 双格式解析、Base64 自动解码、Server:Port 去重
- **[kooker/FreeSubsCheck](https://github.com/kooker/FreeSubsCheck)** — 订阅文件有效性验证、合并输出格式、README 自动生成
- **[coldwater-10/V2Hub2](https://github.com/coldwater-10/V2Hub2)** — 协议类型检测、按协议分类输出、Base64 编码


## 📡 可用订阅链接

| 格式 | 链接 |
|------|------|
| Clash/Mihomo | `http://localhost:3000/api/consolidated?type=clash` |
| V2ray | `http://localhost:3000/api/consolidated?type=v2ray` |
| Sing-Box | `http://localhost:3000/api/consolidated?type=singbox` |

> 💡 将 `localhost:3000` 替换为你的服务器地址和端口。
> 首次使用请运行 `npm start` 启动服务。

## 📄 License

[MIT](LICENSE) © Andy181-github
