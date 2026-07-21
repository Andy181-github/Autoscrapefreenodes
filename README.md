# AutoScrapeFreeNodes v3.8.0

![Version](https://img.shields.io/badge/version-3.8.0-blue)
![Update](https://img.shields.io/badge/更新频率-每5小时-blue)
![Protocol](https://img.shields.io/badge/协议-vmess%20%7C%20trojan%20%7C%20vless%20%7C%20ss-blue)
![Check](https://img.shields.io/badge/检测-TCP%20Connect-green)
![Scoring](https://img.shields.io/badge/评分-质量评分系统-yellow)

> **最后同步时间**：2026/07/22 01:34:45 (北京时间)
> **ISO 时间**：2026-07-21T17:34:45.396Z

### 节点统计
- **有效节点数**: 1314
- **平均质量分**: 80/100
- **总质量分**: 105120

### 🌍 地区分布
- **美国**: 992 nodes
- **荷兰**: 86 nodes
- **德国**: 49 nodes
- **英国**: 35 nodes
- **法国**: 34 nodes
- **日本**: 32 nodes
- **澳大利亚**: 25 nodes
- **中国**: 21 nodes
- **香港**: 18 nodes
- **新加坡**: 10 nodes
- **台湾**: 5 nodes
- **韩国**: 4 nodes
- **加拿大**: 3 nodes

### 🚀 订阅链接
- **Mihomo / Clash Meta**: [mihomo.yaml](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/mihomo.yaml)
- **Clash / Standard**: [all.yaml](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/all.yaml)
- **Base64 (通用)**: [base64.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/base64.txt)
- **通用TXT (XiaoXi)**: [byxiaoxi.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/byxiaoxi.txt)
- **通用TXT (kooker.jp)**: [kooker.jp.txt](https://raw.githubusercontent.com/Andy181-github/Autoscrapefreenodes/main/kooker.jp.txt)
---

## 功能特性

### 数据源管理
- **直接订阅链接**：从 GitHub Raw 直接获取预处理订阅数据
- **多源聚合**：整合 kooker/FreeSubsCheck、anaer/Sub、ermaozi/get_subscribe 等高质量数据源
- **内容去重**：基于 SHA256 哈希的智能去重，消除重复订阅源
- **代理级去重**：基于 server:port 去重，保留最高质量分节点

### 节点有效性检测
- **TCP Connect 检测**：6秒超时，50并发检测节点可达性
- **自动过滤**：移除不可达节点，仅保留有效节点输出
- **进度显示**：每500个节点显示一次检测进度

### 质量评分系统
- **基础分 50 分**：所有节点默认基础分
- **非云IP +20 分**：排除 AWS/GCP/Azure/Cloudflare/阿里云/腾讯云 IP
- **已知地区 +15 分**：从节点名称识别出具体地区（港/台/日/美/新等）
- **优质协议 +5 分**：vless/trojan 协议加分
- **TLS 加密 +5 分**：启用 TLS 的节点加分
- **UDP 支持 +5 分**：支持 UDP 转发的节点加分
- **满分 100 分**

### 节点命名规范
- **格式**：地区前缀-原始名称（如 us-proxy-name）
- **地区前缀**：如 us-, hk-, jp- 等
- **国旗 Emoji**：输出文件中使用国旗标识地区
- **排序规则**：按质量分降序，同分按地区优先级排序

### 输出格式
所有订阅链接中的节点名称包含：
- 国旗 emoji
- 地区名称（自动识别）
- 原始节点名称

### 自动更新
- **GitHub Actions**：每 5 小时自动运行
- **README 自动更新**：scraper 运行时自动更新同步时间、节点统计、地区分布
- **手动触发**：支持 workflow_dispatch 手动运行

---

## 数据源

| 来源 | 描述 | 格式 |
| :--- | :--- | :--- |
| **kooker/FreeSubsCheck** | 高质量预处理订阅数据 | YAML/TXT |
| **anaer/Sub** | 综合 Clash 订阅 | YAML |
| **ermaozi/get_subscribe** | 社区维护订阅 | YAML |

---

## 技术栈

- **Node.js 18+**：运行时环境
- **Axios**：HTTP 请求（禁用代理）
- **Cheerio**：HTML 解析
- **JS-YAML**：YAML 格式处理
- **fs-extra**：文件系统操作
- **Net (Node.js built-in)**：TCP 连接检测

---

## 配置

编辑 config.json 管理数据源。

---

## 使用方法

\\ash
npm install
node scraper.js
\\\

---

## 免责声明

本仓库仅为个人学习 GitHub Actions 自动化流程及 YAML 数据处理的技术演示。项目内分享的所有资源均搜集自互联网公开渠道，本项目不存储、不分发、不产生任何实质性的加密通信流量。

用户在下载、安装或使用本项目涉及的任何资源时，必须确保其行为符合所在国家/地区的法律法规。严禁将本项目提供的技术方案或资源用于任何形式的非法用途。

- 本项目不对资源的稳定性、有效性、安全性作任何形式的保证
- 节点可能随时失效、被封锁或存在安全隐患
- 第三方节点可能存在流量审计或日志记录行为
- 建议避免通过本项目提供的节点传输任何涉及个人隐私、财务安全或敏感信息的数据

本项目贡献者不对因使用本项目而导致的任何直接、间接、附带或惩罚性损害承担法律责任。

---

## 版本历史

- **v3.6.0** (2026-07-10)：添加 TCP 有效性检测、质量评分系统、README 自动更新
- **v3.5.0**：更新更新频率为5小时，节点名称加入评分
- **v3.4.0**：修复 GitHub Actions 工作流
- **v3.3.0**：切换到直接 GitHub Raw URL 数据源
- **v3.0.0**：三订阅整合、IP地区识别、内容去重