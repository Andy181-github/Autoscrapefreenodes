# 🌐 订阅自动更新

![Update](https://img.shields.io/badge/更新频率-每6小时-blue)
![SubsCheck](https://img.shields.io/badge/SubsCheck-1664-green)
![XiaoXi](https://img.shields.io/badge/XiaoXi-1664-orange)
![kooker.jp](https://img.shields.io/badge/kooker.jp-1664-purple)

> **最后同步时间**：2026/11/01 04:21:55 (北京时间)
> **ISO 时间**：2026-10-31T20:21:55.381Z

> ⚠️ **订阅链接已迁移**：5 个订阅文件已从仓库根目录移至 `artifacts/subs/` 子目录。
> 旧的根目录 raw URL 现已 404，请按下方「订阅链接」中的新地址（`.../main/artifacts/subs/<file>`）更新客户端订阅地址。
> 迁移对照表与迁移步骤详见 [docs/MIGRATION.md](docs/MIGRATION.md)。

## ⚙️ 更新机制（GitHub Free 计划资源预算）

本仓库使用 GitHub **Free 计划**，Actions 分钟数有限，因此更新策略为：

- **触发方式**：每 6 小时定时运行一次（UTC `0 */6 * * *`）为主；`push` 仅在改动涉及源码（`scraper.js`/`test*`/`lib/`/`config.json`/`package*`/`.github/workflows/`）时触发，纯订阅产物提交（`artifacts/subs/*`、`README`、`data/historical.json`）不触发——避免 CI 自我推送循环消耗 Free 额度。手动 `workflow_dispatch` 随时可触发。
- **单一 workflow**：`.github/workflows/deploy.yml` 在一次运行中完成依赖安装 → `npm test` → 节点抓取 → 发布文件结构校验 → Mihomo v1.19.33 真实内核配置校验 → 云端出站健康探测 → README/历史数据更新 → 一次 Git 提交。
- **发布安全**：
  - 输出采用「临时目录 + 结构校验 + 原子替换」，任一文件失败时**正式订阅文件保持上版字节不变**。
  - 零节点或过滤后为空时，CI 以非零退出码失败并写 `artifacts/run-status.json` 标记 `failed`；**旧订阅保留但不被冒充为新产物**。
  - mihomo 生成配置的控制面默认绑定 `127.0.0.1:9090`、`allow-lan: false`；如需远程管理请显式修改并自行配置 `external-controller-secret` 认证。
- **检测等级说明**：订阅生成阶段仅经过 **TCP 可达性预筛**（`detectLevel: "tcp"`），未做代理协议握手/出网验证。`sourceHeuristicScore` 是静态来源特征启发式分，仅用于重复端点择优与排序，不参与节点过滤，也**不代表实测速度或可用率**。真实健康评分以双端 Mihomo 出站检测报告为准。

### 手动触发

在 [Actions 页面](https://github.com/Andy181-github/Autoscrapefreenodes/actions) 选择「自动更新免费节点订阅与数据」→ `Run workflow`。直接 push 源码改动（如 `scraper.js`）也会自动触发；纯产物提交不会触发（由 6 小时定时兜底更新）。


## 项目能力与质量验证

本项目是 GitHub Actions 驱动的公开代理订阅采集与生成工具，不是代理服务端，也不保证任何节点持续可用。当前主要处理链路：

1. 从 `config.json` 配置的公开来源采集订阅内容。
2. 解析 Clash、V2Ray、Sing-box 等输入，归一化协议字段并去重。
3. 执行 TCP 可达性预筛、地区识别和静态来源特征处理。
4. 生成 Mihomo、标准 Clash、Base64 和 TXT 共 5 种订阅产物。
5. 发布前使用 `validate-released.js` 校验产物，并使用 Mihomo 内核实际解析配置。
6. 独立运行真实出站探测；健康报告不会反向过滤或覆盖原始订阅。

### 静态特征分与真实健康评分

- `sourceHeuristicScore`：根据节点来源/元数据特征计算的静态启发式分，只用于去重择优与排序，不代表实测速度或可用率。
- `asfn-health-quality-v2`：基于 Mihomo 真实 HTTPS 出站请求计算的健康质量分。至少 8 次样本后才给出数值，公式、状态分级及统计限制见[双端健康检测说明](docs/节点真实健康检测双端使用说明.md)。
- V2 当前是可复算的工程排序分，尚未完成长期统计校准；不要把分数解释为未来可用概率或 SLA。
- GitHub Actions 云端探测报告会以 workflow run 为单位归档 14 天，供跨时间窗口校准。该归档配置在本地提交推送并由 GitHub Actions 实际运行后才会生效。

### 本地检测与测试

在项目根目录执行：

```bash
npm install
npm test
```

Windows 本地全量健康检测（需 PowerShell）：

```powershell
.\scripts\probe-local.ps1
```

先小批量试跑可使用 `-Limit 20`；默认 `-Limit 0` 检测全部节点。检测参数和报告字段详见[双端健康检测说明](docs/节点真实健康检测双端使用说明.md)。

### 项目文件结构

```text
AutoScrapeFreeNodes/
├── scraper.js                 # 抓取、解析、归一化、去重与订阅生成
├── validate-released.js       # 发布订阅结构校验
├── generate-readme.js         # 只更新 3 个节点数量徽章
├── scripts/                   # Mihomo 健康探测及 Windows 本地启动脚本
├── lib/                       # 历史数据等辅助模块
├── test.js                    # 主测试
├── test-regression.js         # 回归测试
├── test-clash-compat.js       # Clash/Mihomo 协议兼容测试
├── test-probe.js              # 健康探测评分测试
├── config.json                # 公开订阅来源与采集配置
├── artifacts/subs/            # 5 个公开订阅产物
├── artifacts/health/          # 探测报告（本地报告默认忽略 Git）
├── .github/workflows/         # 自动抓取、校验、探测和发布
└── docs/                      # 使用说明、迁移说明与历史归档
```

### 文档索引

| 文档 | 用途/状态 |
|---|---|
| [节点真实健康检测双端使用说明](docs/节点真实健康检测双端使用说明.md) | 当前有效：云端/本地探测、评分公式、状态分级和限制 |
| [节点质量评分 V2 实测校验](docs/节点质量评分V2实测校验-2026-11-01.md) | 当前有效：1,072 节点全量实测与复算结果、评分校准计划 |
| [订阅链接迁移说明](docs/MIGRATION.md) | 当前有效：订阅产物目录迁移和新 URL |
| [Agent 系统设计归档](docs/AGENT-SYSTEM-DESIGN-ARCHIVE.md) | 历史设计稿；不代表当前仓库存在文档中描述的 Agent 源码 |
| [v3.3 优化历史](docs/OPTIMIZATION-HISTORY-v3.3.md) | 历史指标和旧实现记录，不作为当前功能依据 |
| [v3.3 功能报告归档](docs/RESEARCH_REPORT-v3.3-ARCHIVE.md) | 历史功能说明，部分内容已过时 |
| [代码清理报告归档](docs/CLEANUP_REPORT-ARCHIVE.md) | 历史清理记录，需结合当前源码复核 |
| [Docker 化方案归档](docs/DOCKERIZATION-PLAN-ARCHIVE.md) | 未实施的参考方案；当前仓库没有 Dockerfile/Compose 文件 |

README 中的同步时间、节点统计和地区分布由 `scraper.js` 更新；`generate-readme.js` 只更新 SubsCheck、XiaoXi、kooker.jp 三个数量徽章。不要手工把单次健康探测结果写成订阅节点统计。

---

### 节点统计
- **有效节点数**: 1664
- **平均静态特征分（非健康评分）**: 81/100

### 🌍 地区分布
- **美国**: 1019 nodes
- **德国**: 206 nodes
- **荷兰**: 144 nodes
- **新加坡**: 57 nodes
- **日本**: 49 nodes
- **法国**: 45 nodes
- **中国**: 38 nodes
- **英国**: 30 nodes
- **澳大利亚**: 24 nodes
- **香港**: 18 nodes
- **加拿大**: 16 nodes
- **韩国**: 13 nodes
- **台湾**: 5 nodes
### 🚀 订阅链接
- **Mihomo / Clash Meta**: [mihomo.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/mihomo.yaml)
- **Clash / Standard**: [all.yaml](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/all.yaml)
- **Base64 (通用)**: [base64.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/base64.txt)
- **通用TXT (XiaoXi)**: [byxiaoxi.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/byxiaoxi.txt)
- **通用TXT (kooker.jp)**: [kooker.jp.txt](https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/kooker.jp.txt)

---

## ⚖️ 免责声明 (Disclaimer)

### 1. 权利归属及性质
本仓库（下称"本项目"）仅为个人学习 **GitHub Actions** 自动化流程及 **YAML** 数据处理的技术演示。项目内分享的所有资源（包括但不限于订阅链接、节点数据）均搜集自互联网公开渠道，本项目不存储、不分发、不产生任何实质性的加密通信流量。

### 2. 法律合规性
* **合规义务**：用户在下载、安装或使用本项目涉及的任何资源时，必须确保其行为符合所在国家/地区的法律法规。
* **禁止违规**：严禁将本项目提供的技术方案或资源用于任何形式的非法用途。因用户违规使用产生的任何行政或刑事责任，由用户本人独立承担，与本项目及其贡献者无关。

### 3. 风险提示及担保限制
* **无保证声明**：本项目不对资源的稳定性、有效性、安全性作任何形式的保证。节点可能随时失效、被封锁或存在安全隐患。
* **隐私风险**：第三方节点可能存在流量审计或日志记录行为。建议用户避免通过本项目提供的节点传输任何涉及个人隐私、财务安全或敏感数据的数据。

### 4. 责任免除
本项目贡献者不对因使用本项目而导致的任何直接、间接、附带或替代性损害（包括但不限于设备损坏、数据丢失、法律纠纷）承担法律责任。

---
**数据来源**: 互联网公开频道聚合
*由 [AutoScrapeFreeNodes](https://github.com/Andy181-github/AutoScrapeFreeNodes) & GitHub Actions 提供自动引擎驱动*
