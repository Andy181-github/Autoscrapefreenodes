# AutoScrapeFreeNodes 节点质量评分、筛选与命名优化报告

- 审计日期：2026-11-01
- 仓库：D:\Codex-skill\AutoScrapeFreeNodes
- 基线分支：main
- 基线 HEAD：94bb4bd4111d20d68d4263c957a5536ef4cce61a
- 审计方式：本地源码、测试、工作流和实际 Mihomo 内核验证；未运行真实节点抓取，未发布远程订阅。

## 一、结论

本次没有重写节点抓取器，也没有把静态特征分数改名冒充实测质量分。优化重点是把仓库已有的真实代理探测结果接入最终订阅生成链路：

1. 静态来源特征分 sourceHeuristicScore 与真实健康质量分 qualityScore 分开。
2. 候选阶段先做地区、风险和协议字段筛选；只有真实探测阶段才产生健康质量分。
3. 把 config.json 中原本没有实际参与筛选的 minQualityScore 用于生成独立高质量订阅。
4. 真实探测完成后，把分数标记写入 YAML 和 URI/TXT 节点名称，并更新 Mihomo 代理组引用。
5. 评分数据不足时明确标记 Q?，不补造数字分。

## 二、代码级基线发现

### 2.1 原有静态分不是节点健康分

- scraper.js:1170-1177 的 buildDisplayName() 只生成地区与速度标签，并明确不把静态来源启发式分写入名称。
- scraper.js:1495-1515 的 YAML 节点转换（静态分计算位于 1502-1510）使用地区、IP 类别、TLS、UDP 等静态属性生成 sourceHeuristicScore。
- README 统计区的平均值也是“平均静态特征分”，不是实时可用性或速度分。

这部分逻辑保留。静态特征可以用于初筛和同级候选排序，但不能证明代理出站成功。

### 2.2 已有实测探测模块，但结果此前没有进入主订阅命名链路

scripts/probe-nodes.js 已经实现：

- 通过本地临时 Mihomo 实例加载候选节点；
- 使用两个独立 HTTP 204 测试目标；
- 多轮请求并记录成功、失败和延迟；
- 使用 95% Wilson 成功率置信下界；
- 使用延迟中位数和 MAD 抖动；
- 样本不足时将 qualityScore 设为 null；
- 输出 report.json、working.yaml 和 stable.yaml。

.github/workflows/deploy.yml 原本会执行云端真实节点检测，但只把探测结果作为独立报告和分层文件保存；主订阅名称并没有使用这些分数。config.json 的 settings.minQualityScore 原本也没有被探测脚本消费。

### 2.3 候选筛选存在两个实际问题

- batchGeoCheck() 之前只给 IP 节点计算欺诈风险分，域名节点没有风险分，后续又被 Number(proxy.fraudScore || 0) 一类默认值逻辑当成零风险。
- 原 isCandidateEligible() 将缺失的 latency 转成 0，因此未测延迟会被当作零毫秒通过阈值。

这两项均已在本次修改中处理。

## 三、评分模型与筛选规则

### 3.1 实测健康质量分

保留原探测模块的可解释模型：

| 维度 | 权重 | 计算依据 |
|---|---:|---|
| 可靠性 | 70 | 95% Wilson 成功率置信下界 |
| 延迟 | 15 | 成功请求延迟中位数的指数衰减 |
| 抖动 | 10 | 成功请求延迟 MAD 的指数衰减 |
| 目标覆盖 | 5 | 成功测试目标数 / 配置目标数 |
| 合计 | 100 | 四项相加后取整 |

最低证据要求：至少 8 次请求样本；分类还要求至少两个独立目标都成功过。

状态判定继续沿用现有规则：

- stable：Wilson 下界不低于 0.65，且每个配置目标至少成功一次。
- working：Beta 平滑成功率不低于 0.60、Wilson 下界不低于 0.30，且每个配置目标至少成功一次。
- unreliable：样本足够，但不满足 working/stable 条件。
- insufficient_data：样本不足，不输出数字质量分。

该分数是当前探测配置下的证据评分，不是带宽 Mbps、长期 SLA 或绝对安全保证。

### 3.2 质量订阅分层

探测脚本新增 quality.yaml：

- working.yaml：working + stable；
- stable.yaml：仅 stable；
- quality.yaml：working + stable，并且 qualityScore >= settings.minQualityScore；
- 默认最低质量分来自 config.json 的 minQualityScore: 60，也可用 --min-quality-score 覆盖；
- 分层文件按质量分从高到低排序，分数相同再按延迟排序。

原 mihomo.yaml 和 all.yaml 保留候选池，不因某次实测失败而直接清空主订阅。用户可以优先使用 quality.yaml，需要更宽候选集时再使用全量订阅。

### 3.3 候选过滤

batchGeoCheck() 现在给 IP 和域名节点都计算本地欺诈启发式分。

getCandidateRejectionReason() 返回明确拒绝原因：

- invalid_node
- unknown_region
- cloud_region
- fraud_score_unknown
- fraud_score_invalid
- fraud_score_exceeded
- latency_exceeded

过滤阈值来自 config.settings.maxFraudScore 和 config.settings.maxLatency。只有显式提供的 probeLatencyMs 或 latencyMs 才算实测延迟；历史占位字段 latency: 0 不参与延迟判断。主抓取阶段没有真实代理延迟证据时，不会伪造零毫秒成绩。

每次过滤会输出按原因统计的淘汰数量，便于判断节点减少是地区、风险、数据缺失还是实测延迟造成的。

## 四、节点命名规范

统一使用：

- |Q0～|Q100：真实探测产生的质量分；
- |Q?：样本不足，或无法可靠匹配探测记录。

示例：

- 🇺🇸美国|fast|Q92
- 🇯🇵日本|unknown|Q?

命名处理具备以下约束：

1. 不使用 sourceHeuristicScore 作为 Q 分数。
2. 对重复执行进行幂等处理，不重复追加分数后缀。
3. 节点名最大 64 个 Unicode code point，超长名称会截断并保留分数后缀。
4. 处理重名时追加唯一序号。
5. mihomo.yaml 的 proxy-groups[].proxies 同步更新，避免节点名改变后代理组仍引用旧名称。
6. TXT/URI 中的 VMess JSON ps 和普通 URI fragment 同步更新。
7. 当自定义 URI 名称无法通过名称匹配时，只有在 type + server + port 身份组合唯一时才允许回退匹配；身份不唯一则标记 Q?，不猜测分数。

实现位于新增的 scripts/apply-health-scores.js。

## 五、工作流接入

.github/workflows/deploy.yml 已调整为：

1. 抓取并生成基础订阅。
2. 原有发布前校验及 Mihomo 内核校验。
3. 执行 scripts/probe-nodes.js，生成 report、working、stable、quality。
4. 执行 scripts/apply-health-scores.js，为主订阅和分层订阅加分数名称。
5. 再次运行 validate-released.js。
6. 再次用 Mihomo 内核验证重命名后的 all.yaml 和 mihomo.yaml。
7. 提交订阅文件、质量报告和质量分层文件。

重命名后的 Mihomo 二次校验沿用工作流已有的 GeoSite/GeoIP 规则处理方式：临时验证副本会移除外部地理规则，避免为了检查代理组引用而额外下载数据库；原正式配置文件不因此删除规则。

updateREADME() 已增加 artifacts/health/cloud/stable.yaml、working.yaml、quality.yaml 三个分层订阅入口。README 正文将在下一次正常抓取运行时由现有更新逻辑刷新。

## 六、测试与验证结果

### 6.1 自动化测试

本次完整 npm test 通过：

| 测试 | 结果 |
|---|---:|
| test.js | 9/9 测试组通过 |
| test-regression.js | 28 项通过 |
| test-clash-compat.js | 41 项通过 |
| test-probe.js | 通过 |
| 新增 test-score-labels.js | 通过 |

新增固定夹具覆盖：

- 候选过滤原因与阈值；
- legacy latency: 0 不被误判为真实测量；
- 域名节点同样计算欺诈风险分；
- 质量分阈值筛选和排序；
- Qxx、Q?、长名称和重复名称；
- YAML 节点重命名和 Mihomo 代理组引用同步；
- VMess JSON、VLESS/Trojan URI fragment 标记；
- 重复执行幂等。

### 6.2 语法和格式检查

已通过：

- node --check scraper.js
- node --check scripts/probe-nodes.js
- node --check scripts/apply-health-scores.js
- node --check test-score-labels.js
- .github/workflows/deploy.yml YAML 解析
- git diff --check

Git 提示工作区中的部分文件会在下次 Git 写入时转换 LF/CRLF；这是行尾风格提示，不是测试失败。

### 6.3 实际 Mihomo 内核验证

使用仓库 .tools/mihomo.exe 对一个临时合成配置进行了测试：

- 先把节点名称从 kernel-fixture 改为带质量分的名称；
- 同步更新 proxy-groups 对该节点的引用；
- 使用真实 Mihomo 二进制执行 -t。

结果：configuration file test is successful。

这证明本次名称改写和代理组引用更新可以通过当前本地 Mihomo 内核的配置校验；它不等同于真实代理节点出站成功。

## 七、未执行事项与限制

- 没有运行 npm start，没有触发真实来源抓取。
- 没有对真实免费节点执行本地或云端批量探测。
- 当前本地未发现 artifacts/health/cloud/report.json，因此无法给出真实节点的 Q 分数分布、quality.yaml 节点数量或质量提升比例。
- 没有触发 GitHub Actions，也没有推送或发布远程订阅；工作流中的云端探测和发布前校验仍需下一次 CI 运行确认。
- （后续维护记录：原 settings.proxyProbe 配置没有任何代码或 workflow 读取点，已在 2026-11-02 清理；云端探测由 GitHub Actions 显式调用 scripts/probe-nodes.js，与本地 TCP 检查分离。）
- 当前质量分只代表两个指定测试目标和本次采样窗口下的表现。建议积累 14 天报告后再根据实际分布调整阈值，不要仅凭单次平均分过度调权。

## 八、修改文件

| 文件 | 修改内容 |
|---|---|
| scraper.js | 域名/IP 风险评分、可解释过滤原因、未测延迟处理、README 质量订阅链接 |
| scripts/probe-nodes.js | minQualityScore 生效、质量分排序、生成 quality.yaml |
| scripts/apply-health-scores.js | 新增分数标记、URI/YAML 改名、代理组引用同步、原子写入 |
| test-score-labels.js | 新增过滤、质量分层、命名和 YAML/URI 回归测试 |
| package.json | 将新回归测试纳入 npm test |
| .github/workflows/deploy.yml | 探测后应用分数标记、再次校验、提交 quality.yaml |

本次保留了开始审计时已经存在的 .agnes/ 及其他未提交文档，没有重置或覆盖这些用户文件。所有本次代码改动仍在本地工作区，尚未提交 Git。
