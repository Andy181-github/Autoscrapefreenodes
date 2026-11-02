# AutoScrapeFreeNodes CI 首轮实测与发布竞态修复记录

日期：2026-11-02

## 一、GitHub Actions 实际运行结果

本次提交 `2774e88c34af6853c15741eb27b310805f5e5330` 已触发 GitHub Actions。

| 运行 | Run ID | 触发类型 | 结果 |
|---|---:|---|---|
| 本次代码推送 | 41459645275 | push | success |
| 后续定时任务 | 41460037597 | schedule | failure |

成功的 push 运行完成了以下全部步骤：依赖安装、npm 测试、抓取、订阅产物校验、Mihomo 校验、云端真实节点检测、实测分数标记、校准快照归档、README/历史数据更新及产物提交。

成功运行生成的远端产物提交为：

```text
26a81786e033102618919dfe8a1583c8cb0204ed
```

远端 `artifacts/health/cloud/quality.yaml` 已发布 166 个节点。

## 二、首轮真实探测数据

来源：成功运行 41459645275 的 `health-calibration-41459645275` artifact 中的 `report.json`。不是本地模拟数据。

| 指标 | 实测值 |
|---|---:|
| 输入节点 | 1,663 |
| 完成探测 | 1,663 |
| stable | 153 |
| working | 41 |
| unreliable | 1,469 |
| insufficient_data | 0 |
| 平均节点成功率 | 12.3% |
| 平均质量分 | 9.27 |
| 中位质量分 | 0 |
| 最高质量分 | 77 |
| 最低质量分 | 0 |
| 最低质量分层阈值 | 60 |
| quality.yaml 节点数 | 166 |

达到 60 分的 166 个节点由 153 个 stable 和 13 个 working 组成。其余 28 个 working/stable 节点未达到质量分门槛。

质量分分布：

| 分数区间 | 节点数 |
|---|---:|
| 0–9 | 1,420 |
| 10–19 | 5 |
| 20–29 | 4 |
| 30–39 | 16 |
| 40–49 | 35 |
| 50–59 | 17 |
| 60–69 | 18 |
| 70–79 | 148 |

探测配置：两个独立 HTTPS 204 目标、每目标 4 轮、每节点 8 次样本、5 秒超时、并发 40。失败样本主要为 http_error（10,748 次）和 timeout（921 次）。

解释：当前免费节点池整体质量偏低，Q 分数中位数为 0；60 分筛选确实把可用候选池收窄到 166 个。暂不应仅凭这一次运行调整评分权重，按既定计划积累 14 天数据后再校准。

### 公开报告字段检查

对本次 3.9 MB 的 `report.json` 做了递归字段名检查。节点记录包含名称、协议类型、服务器地址、端口、探测样本和质量指标；没有发现 password、UUID、secret、token、credential、authorization 或 private-key 等敏感字段名。该报告仍包含节点服务器地址和端口，属于公开节点元数据。

## 三、定时任务失败根因

定时运行 41460037597 的抓取、测试、Mihomo 验证、真实探测、分数标记和校准快照步骤全部成功；失败只发生在“提交更新”步骤。

实际时序：

1. schedule 事件于 14:14:25Z 创建，事件 SHA 为 `2774e88`。
2. push 运行基于同一 SHA 执行，最终于 14:19:18Z 完成，并把产物提交 `26a8178` 推到 main。
3. 已排队的 schedule 运行于 14:19:33Z 开始，但仍使用触发时的旧 SHA `2774e88`。
4. schedule 运行生成自己的订阅和质量报告后，执行原有 `git pull --rebase origin main`。
5. 旧基线生成的文件与远端新产物冲突，README、quality/report/working/stable、all.yaml、mihomo.yaml、TXT 订阅及历史数据均出现 rebase 冲突。

因此这不是探测失败，也不是 Mihomo 不兼容，而是排队运行使用旧触发 SHA，rebase 旧产物造成的发布竞态。

## 四、工作流修复

已修改并推送 `.github/workflows/deploy.yml` 的“提交更新”步骤，修复提交为 `e65616c9c2d52ba90715334b4644990a6718b9d9`：

- 只允许 `refs/heads/main` 运行向 main 发布，避免从其他分支手动触发时覆盖主分支产物。
- 生成本地提交后执行 `git fetch origin main`。
- 将远端 main 与本次运行的 `GITHUB_SHA` 比较；若远端已经前进，则安全跳过过期产物，不再尝试 rebase。
- 删除生成物提交的 `git pull --rebase` 路径，改为基于未变化的基线直接 fast-forward push。
- 若 fetch 后又有并发提交导致 push 被拒绝，再 fetch 判断；只有确认远端已前进才安全跳过。若远端没有前进，则保留真正的认证/权限/远端错误并使 job 失败。

这样不会把旧运行的订阅快照和历史数据强行重放到新 main 上；下一轮定时或源码触发任务会从最新 main 重新生成。

## 五、本地验证

- GitHub Actions workflow YAML 解析通过。
- 从 workflow 中提取的“提交更新”bash 脚本通过 `bash -n` 语法检查。
- `git diff --check` 通过。
- 使用临时 bare Git 仓库模拟“本次运行提交产物期间，远端 main 已被另一运行更新”的竞态；新 guard 正确识别旧基线并跳过，没有 rebase 或覆盖远端文件。

竞态修复已推送。随后 GitHub Actions push 运行 `41464046723` 在完整抓取、真实探测和评分发布后成功结束（7 分 10 秒），自动产物提交为 `cd74a7e44351fa33b81a330a310f4dd02bc9bf7e`。本轮正常基线发布路径已在 GitHub 上验证；旧 SHA 跳过分支已通过临时 bare Git 仓库竞态模拟验证。

## 六、仍需处理

1. `config.json` 中 `settings.proxyProbe.enabled=false` 目前没有被运行时代码或 CI 工作流读取，仅在 `scraper.js` 注释中说明它不控制 CI 云端探测。该配置属于未接线设置，后续应明确删除、改名或接入单独的 cloud health probe 开关，不能让维护者误以为它能关闭 CI 探测。
2. 继续积累 14 天报告，按真实成功率置信下界、延迟中位数/MAD、目标覆盖率和状态变化评估评分阈值；不要根据一次样本改权重。
3. 后续仍需观察真实排队并发场景，确认旧 SHA 分支在 GitHub Actions 中显示 warning 并正常结束；目前该分支已有本地 bare Git 仓库模拟证据，尚未在真实 GitHub 排队竞态中命中。

## 七、Node.js 24 运行时升级

本次成功运行 `41464046723` 虽然通过，但 GitHub 给出 Node.js 20 action runtime 弃用告警。随后将工作流升级为 Node 24：

- `actions/checkout@v7`
- `actions/setup-node@v7`
- `actions/upload-artifact@v7`
- 项目脚本运行时 `node-version: '24'`

通过 GitHub API 读取三个 action 的 `action.yml`，确认它们均声明 `runs.using: node24`。升级后的 GitHub Actions 运行 `41465887976` 已在 Node 24 下完整成功，耗时 6 分 54 秒；npm 测试、抓取、Mihomo 校验、真实节点探测、Q 分数标记和产物发布全部通过。Node.js 20 弃用告警已消失，仅保留 `ubuntu-latest` 迁移到 Ubuntu 26 的非阻塞提示。
