# AutoScrapeFreeNodes

![Version](https://img.shields.io/badge/version-3.3.1-blue)
![Update](https://img.shields.io/badge/更新频率-每2小时-blue)
![Node](https://img.shields.io/badge/节点-自动抓取-green)
![License](https://img.shields.io/badge/license-MIT-purple)

> **最后同步时间**：自动生成（GitHub Actions 每2小时更新）

---

## 功能特性

- **多源抓取**：从 GitHub Pages 站点和 airportnode.com 自动抓取免费节点订阅链接
- **内容去重**：基于 SHA256 指纹对订阅链接内容进行去重，减少重复节点
- **智能命名**：根据节点名称自动识别地区（港/台/日/美/新等），添加地区前缀
- **三格式输出**：整合为 Clash/Mihomo、V2ray、Sing-Box 三种格式的订阅链接
- **质量评分**：对节点进行评分排序，优先保留高质量节点
- **GitHub Actions 自动更新**：每2小时自动运行爬虫，更新订阅文件

## 输出文件

| 文件 | 格式 | 说明 |
|------|------|------|
| mihomo.yaml | Clash Meta | 带代理组配置的完整 Clash Meta 配置文件 |
| all.yaml | Clash Standard | 仅包含代理列表的 Clash 标准 YAML |
| base64.txt | Base64 URI | 通用协议 URI |
| byxiaoxi.txt | Base64 URI | XiaoXi 兼容格式 |
| kooker.jp.txt | Base64 URI | kooker.jp 兼容格式，带国旗 emoji |
| README.md | Markdown | 自动生成的订阅链接和统计信息 |

## 订阅链接

| 类型 | 订阅地址 |
| :--- | :--- |
| **Mihomo / Clash Meta** | [mihomo.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/mihomo.yaml) |
| **Clash / Standard** | [all.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/all.yaml) |
| **Base64 (通用)** | [base64.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/base64.txt) |
| **通用TXT (XiaoXi)** | [byxiaoxi.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/byxiaoxi.txt) |
| **通用TXT (kooker.jp)** | [kooker.jp.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/kooker.jp.txt) |

## 数据源

- https://clashnode.github.io/free-nodes/
- https://clash-meta.github.io/free-nodes/
- https://airportnode.com/freenode

## 快速开始

`ash
npm install
node scraper.js
node generate-readme.js
`

## 版本历史

- **v3.3.1** - 重构为纯静态文件架构，移除 Express 服务器，输出文件到根目录
- **v3.3.0** - 添加 IP 地区检测、节点重命名、内容去重、三格式整合
- **v3.2.0** - 添加质量评分系统、节点排序
- **v3.1.0** - 添加媒体解锁检测、指纹去重
- **v3.0.0** - 初始版本，多源抓取基础功能

---

## 免责声明

本仓库仅为个人学习 GitHub Actions 自动化流程及 YAML 数据处理的技术演示。项目内分享的所有资源均搜集自互联网公开渠道。用户必须确保其行为符合所在国家/地区的法律法规。本项目不对资源的稳定性、有效性、安全性作任何保证。