# 节点真实健康检测：云端 + 本地双端

## 检测口径

本项目原有 TCP 检测仅表示节点服务器端口可连接，不代表代理协议握手成功，也不代表可以经代理访问互联网。新增检测由 Mihomo 内核加载候选节点，再通过 Mihomo REST API 的单节点 delay 接口验证真实 HTTP(S) 出站。

- 云端：GitHub Actions 每 6 小时执行一次，代表 GitHub Actions runner 的网络出口。
- 本地：Windows 手动执行，代表运行脚本的这台 Windows 电脑当前网络出口。
- 两端报告分开保存，不能将云端成功解释为本地成功，反之亦然。
- 输入使用 artifacts/subs/mihomo.yaml，覆盖 Mihomo 订阅中的协议节点；不会只检测标准 Clash 的 all.yaml 子集。
- 原始 all.yaml、mihomo.yaml 和其他订阅不会因探测失败而删除或改写。

## 检测方法

每个节点通过 Mihomo REST API 分别访问两个独立 HTTP 204 目标：

- https://www.gstatic.com/generate_204
- https://cp.cloudflare.com/generate_204

默认每个目标重复 4 轮，即每节点 8 次请求；并发默认 20，每次 API 超时 8 秒。云端同样使用 4 轮、并发 40、5 秒超时。可通过 --timeout、--rounds 和 --concurrency 调整。少于 8 次样本的节点标记为 insufficient_data，不会进入 working.yaml 或 stable.yaml。Mihomo controller 仅监听随机分配的 127.0.0.1 端口，使用随机 secret；临时配置和进程结束后清理。不启用 TUN，不接管系统代理，不读取或修改 FlClash 配置。

## 质量评分与分级规则

每个节点在达到至少 8 次探测样本后才生成 0–100 的 health qualityScore，并在 report.json 中保留 qualityBreakdown 分项。少于 8 次时 `qualityScore` 与 `qualityBreakdown` 不提供数值（`null`），避免用小样本制造虚假的精确评分；这类节点仍保留原始成功率和状态 `insufficient_data`。

注意：`scraper.js` 的 `sourceHeuristicScore` 是静态来源/元数据启发式分，只用于重复端点择优和订阅排序；已取消其对节点发布的硬阈值过滤。它不代表代理出站成功率。只有本节定义的 `asfn-health-quality-v2` 才是基于真实出站样本计算的健康质量分。

- 可靠性 70 分：使用成功次数/总尝试次数的 95% Wilson 置信下界计分，而不是直接用样本成功率或 Beta 平滑均值。样本少时下界更保守；样本持续增加且成功率保持高位时，可靠性分才会逐步提高。
- 延迟 15 分：按成功请求的中位延迟指数衰减，避免单次最快/最慢值主导评分。
- 抖动 10 分：使用成功请求延迟的中位绝对偏差（MAD）衡量波动，降低单个极端慢请求对抖动分的过度影响。
- 双目标覆盖 5 分：两个独立目标均至少成功一次才获得满分。

当前权重与衰减常数是可解释的工程评分模型 v2，已用边界样例、样本量单调性和异常延迟鲁棒性测试验证计算一致性；尚未用长期历史标签做统计校准，因此分数适合本次同环境排序，不应解释为真实可用概率。

评分公式：`70 × Wilson95下界 + 15 × exp(-中位延迟/5000) + 10 × exp(-MAD/3000) + 5 × 双目标覆盖率`。`jitterMs` 字段保留兼容名称，但 v2 中表示延迟 MAD，而不是最大值减最小值。少于 8 次样本时不发布数值质量分；汇总均分/中位数只统计有有效质量分的节点，并额外记录 `scoredNodes`。

分级不只看质量分，而是结合样本量和 95% Wilson 成功率置信下界，避免少量偶然成功被标成稳定。Wilson 计算将每次请求视为 Bernoulli 观测；同一节点对相同目标的重复请求可能存在时间相关性，因此该下界是保守的工程证据指标，不是严格 SLA 或独立同分布保证：

| 级别 | 判定 | 含义 |
|---|---|---|
| stable | 至少 8 次；Wilson 95% 下界 >= 0.65；每个目标至少成功 1 次 | 高置信度稳定候选 |
| working | 至少 8 次；平滑成功率 >= 0.60；Wilson 95% 下界 >= 0.30；每个目标至少成功 1 次 | 有重复成功证据，但稳定性较低 |
| unreliable | 样本充足但未达到 working 条件 | 本轮不建议作为可用节点 |
| insufficient_data | 总尝试次数少于 8 | 证据不足，不作可用/不可用结论 |

working.yaml 收录 working + stable；stable.yaml 只收录 stable。质量分是同一次探测环境下的节点排序指标，不是长期 SLA，也不应直接比较不同地区/不同出口的云端与本地绝对分数。长期可靠性应结合多次定时报告观察。一次检测失败不删除原始候选节点。

失败分类包括 timeout、tls_error、auth_error、dns_error、connect_error、http_error、proxy_error。报告不写入节点密码、UUID、密钥等认证字段。

## GitHub Actions 云端检测

现有 deploy.yml 每 6 小时触发一次。爬虫生成订阅并通过 Mihomo 配置校验后，运行云端真实出站检测，产物提交到：

- artifacts/health/cloud/report.json
- artifacts/health/cloud/working.yaml
- artifacts/health/cloud/stable.yaml

报告包含 `asfn-health-quality-v2` 的 qualityScore、qualityBreakdown、Wilson 95% 置信下界、MAD 抖动和状态分布。云端检测不会过滤或覆盖原始订阅。若本轮探测失败，报告会保留失败原因和 0 个 working/stable 节点；不会把原始订阅清空。

云端 CI 使用 5 秒单次超时和 40 并发，以控制每 6 小时一次的 GitHub Actions 运行时间；本地复测默认使用 8 秒超时和 20 并发，可按本机网络情况调整。

## Windows 本地复测

在项目根目录打开 PowerShell 7 或 Windows PowerShell：

    .\scripts\probe-local.ps1

首次运行会下载并使用固定版本 Mihomo v1.19.33，放在项目 .tools 目录（已加入 .gitignore）。也可以指定已有内核：

    .\scripts\probe-local.ps1 -MihomoPath "C:\Tools\mihomo.exe"

指定输入、超时、轮次和并发：

    .\scripts\probe-local.ps1 -InputFile "artifacts/subs/mihomo.yaml" -TimeoutMs 10000 -Rounds 4 -Concurrency 15

首次可先用 -Limit 20 对前 20 个节点做小样本验证；默认 -Limit 0 表示检测全部节点。

本地结果保存在 artifacts/health/local/，目录已加入 .gitignore，不会自动提交到 GitHub。输出包括 report.json、working.yaml、stable.yaml。可以把本地报告与云端报告对比，识别“云端可用但本地不可用”或相反的节点。

## 结果解释限制

1. HTTP 204 测试只证明该节点在该检测时刻能通过代理访问指定 HTTPS 目标。
2. 不代表节点能访问所有网站，也不代表 UDP、游戏、流媒体或特定应用可用。
3. 云端和本地出口位置、DNS、运营商路由和防火墙不同，结果不同是预期现象。
4. 免费节点可能随时失效；建议结合多次定时报告观察，而不是依据单次结果作永久删除。
