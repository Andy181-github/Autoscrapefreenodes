# AutoScrapeFreeNodes

![Update](https://img.shields.io/badge/更新频率-每6小时-blue)
![SubsCheck](https://img.shields.io/badge/SubsCheck-1625-green)
![XiaoXi](https://img.shields.io/badge/XiaoXi-1625-orange)
![kooker.jp](https://img.shields.io/badge/kooker.jp-1625-purple)

> **最后同步时间**：2026/11/12 12:58:50 (北京时间)
> **ISO 时间**：2026-11-12T04:58:50.699Z

## 项目简介

AutoScrapeFreeNodes 是一个基于 Node.js 和 GitHub Actions 的公开订阅采集、解析、检测与生成项目。它聚合配置中的公开订阅来源，整理为多种客户端可用的订阅格式，并定时更新仓库中的订阅文件。

本项目不是代理服务端，不保证第三方节点持续可用。

## 主要功能

- **多来源采集**：从 `config.json` 中启用的公开来源读取订阅。
- **协议解析与归一化**：处理 Clash、V2Ray、Sing-box 等输入，校验协议字段并去重。
- **节点预筛**：执行 TCP 端口可达性检查、地区识别和来源风险启发式处理。
- **多格式输出**：生成 Mihomo、标准 Clash、Base64 和 TXT 订阅文件。
- **独立健康探测**：通过 Mihomo 对节点执行真实 HTTPS 出站检测，生成 working、stable、quality 分层结果和评分报告。
- **发布校验**：使用项目测试、订阅结构校验和 Mihomo 内核校验，降低错误产物发布风险。

静态来源特征分与真实健康评分是两种不同指标。TCP 可达也不代表代理协议可用；健康分只依据实际探测样本计算，不能视为长期可用率承诺。

## 自动化流程

GitHub Actions 使用 Node.js 24，每 6 小时自动运行一次，也支持手动触发；源码、配置或工作流变更时可触发 push 流程。自动任务执行依赖安装、测试、订阅抓取、格式校验、Mihomo 解析、云端健康探测、README 与历史数据更新，最后提交生成物。

- 工作流：[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- 手动运行：[GitHub Actions](https://github.com/Andy181-github/Autoscrapefreenodes/actions)
- 订阅文件：`artifacts/subs/`
- 云端健康报告与分层结果：`artifacts/health/cloud/`

## 项目结构

```text
AutoScrapeFreeNodes/
├── package.json / package-lock.json # 项目命令与依赖锁定
├── LICENSE                     # 开源许可
├── scraper.js                  # 主流程：采集、解析、过滤、去重和订阅生成
├── validate-released.js        # 发布前订阅文件校验
├── update-readme-badges.js     # 更新 README 顶部的订阅数量徽章
├── run-agents.js               # 可选的 Agent 分析流程入口
├── agents/                     # Agent 分析模块
├── scripts/
│   ├── probe-nodes.js          # Mihomo 健康探测与质量评分
│   ├── apply-health-scores.js  # 将实测分数写入节点名称
│   └── probe-local.ps1         # Windows 本地探测入口
├── lib/history.js              # 历史数据维护
├── test*.js                    # 主测试、回归、协议兼容和评分测试
├── config.json                 # 订阅来源及采集设置
├── artifacts/
│   ├── subs/                   # 对外发布的订阅文件
│   └── health/cloud/           # 云端探测报告和分层订阅
├── data/historical.json        # 节点历史数据
├── docs/                       # 使用说明、审计记录和历史归档
└── .github/workflows/          # 自动更新与发布工作流
```

## 本地使用

在项目根目录执行：

```bash
npm ci
npm test
npm start
```

其他常用命令：

```bash
npm run readme:badges  # 仅刷新 README 数量徽章
npm run agents         # 运行可选的 Agent 分析流程
```

Windows 本地健康探测（可先用 `-Limit 20` 小批量试跑）：

```powershell
.\scripts\probe-local.ps1 -Limit 20
```

## 相关文档

- [双端健康检测说明](docs/health-probe-guide.md)
- [质量评分 V2 实测校验](docs/quality-score-v2-validation-2026-11-01.md)
- [质量评分、筛选与命名实现记录](docs/quality-scoring-and-node-labels-2026-11-01.md)
- [订阅文件路径迁移说明](docs/subscription-path-migration.md)
- [公开仓库安全审计](docs/public-repository-security-audit.md)
- [CI 实测与发布竞态修复记录](docs/ci-probe-and-publish-race-2026-11-02.md)

### 节点统计
- **有效节点数**: 1625
- **平均静态特征分（非健康评分）**: 81/100

### 🌍 地区分布
- **美国**: 966 nodes
- **德国**: 217 nodes
- **荷兰**: 104 nodes
- **新加坡**: 65 nodes
- **法国**: 59 nodes
- **英国**: 50 nodes
- **日本**: 48 nodes
- **加拿大**: 29 nodes
- **香港**: 22 nodes
- **韩国**: 20 nodes
- **澳大利亚**: 19 nodes
- **中国**: 15 nodes
- **台湾**: 11 nodes
### 🚀 订阅链接
- **Mihomo / Clash Meta**: [mihomo.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/mihomo.yaml)
- **稳定节点**: [stable.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/health/cloud/stable.yaml)
- **可用节点 (working + stable)**: [working.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/health/cloud/working.yaml)
- **高质量节点 (达到最低分数)**: [quality.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/health/cloud/quality.yaml)
- **Clash / Standard**: [all.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/all.yaml)
- **Base64 (通用)**: [base64.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/base64.txt)
- **通用TXT (XiaoXi)**: [byxiaoxi.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/byxiaoxi.txt)
- **通用TXT (kooker.jp)**: [kooker.jp.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/kooker.jp.txt)

---

## ⚖️ 免责声明

本项目仅聚合互联网公开来源并生成订阅数据，不提供代理服务，也不保证第三方节点的可用性、安全性或隐私保护。使用者应自行核实节点风险并遵守所在地法律法规；请勿通过不可信节点传输密码、财务信息或其他敏感数据。
