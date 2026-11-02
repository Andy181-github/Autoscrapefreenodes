# AutoScrapeFreeNodes 公开仓库安全审计报告

> 审计基线：分支 `main`；HEAD `da5e0e9`（公开仓库：`Andy181-github/Autoscrapefreenodes`）。
> 本审计以"任何匿名访问者都可读取仓库全部 git 历史"为前提，逐项区分「已确认风险」「需关注事项」「已排除项」。

## 1. 凭据与密钥扫描（已排除）

| 检查项 | 结果 |
|---|---|
| GitHub PAT（`ghp_` / `github_pat_`） | 未发现 |
| 云服务密钥（`AKIA` / `AIza` / `sk-`） | 未发现 |
| 私钥块（`-----BEGIN ... PRIVATE KEY`） | 未发现 |
| 硬编码 `password=` / `token=` 赋值（源码） | 未发现（仅测试夹具中的假数据） |
| 个人邮箱 / 本机路径泄露 | 未发现 |
| `.env` 类文件入库 | `.gitignore` 已排除，git 中不存在 |

**订阅文件中的节点 IP / UUID / password 是产品数据**（本仓库功能即分发免费节点），不属于凭据泄露，但意味着任何使用本订阅的流量可被上游节点方观测——这是 README 免责声明已覆盖的风险。

## 2. 已确认问题（本次修复）

### 2.1 package.json 与 package-lock.json 严重漂移 → CI `npm ci` 失败【critical】

- **证据**：本地执行 `npm ci --dry-run` 报 `EUSAGE: lock file's js-yaml@5.2.1 does not satisfy js-yaml@4.3.2`，exit 1。
- **根因**：`package-lock.json` 根节点声明 7 个依赖（`axios/cheerio/cors/cron/express/fs-extra/js-yaml@^5.2.1`）+ 1 个 devDependency（`nodemon`），而 `package.json` 只声明 4 个（`js-yaml@^4.1.0`）。该漂移自早期提交（`827eca9 项目上传` 时代）遗留，此前 CI 用 `npm install` 不校验漂移故未暴露；workflow 改用 `npm ci` 后立即失败。
- **影响**：`deploy.yml` 的"安装依赖"步骤失败 → 每 6 小时定时运行 + 每次 push 全部失败 → 订阅停止更新。
- **修复**：`npm install --package-lock-only` 重新生成 lockfile，根节点与 `package.json` 对齐（4 个依赖），`js-yaml` 锁回 4.3.2；移除 90 个未被任何源码 `require` 的死依赖包（`express/cron/cors/luxon/nodemon` 及其传递依赖）。
- **验证**：`npm ci --dry-run` exit 0；`npm test` 8/8 + 回归 20/20 通过；源码对 `js-yaml` 仅使用 `load/dump`（4.x API 兼容）。

### 2.2 lockfile 混用 npmmirror 镜像源【warning】

- **证据**：旧 lockfile 中 109/142 个包的 `resolved` 指向 `registry.npmmirror.com`，其余 33 个指向 `registry.npmjs.org`。
- **影响**：两个不同注册源混合提供同一依赖树，integrity 校验虽能防篡改，但构建来源不可审计；且 npmmirror 条目在境外 CI runner 上可能加速也可能因镜像策略变更而延迟。
- **处置**：重新生成的 lockfile 中 50/51 个包仍指向本机活动的 `registry.npmmirror.com`（本机 `~/.npmrc` 配置，属开发者个人设置，**不应**写入仓库强制所有人走镜像）。
- **建议（未实施，待确认）**：若希望 CI 构建来源与 npmjs.org 对齐，可在仓库根新增 `.npmrc` 写 `registry=https://registry.npmjs.org/`，再重新生成一次 lockfile。

## 3. 需关注事项（不阻断，但应知晓）

### 3.1 订阅产物含第三方节点凭据（产品固有属性）

`artifacts/subs/*` 与 `data/historical.json`（git 跟踪）包含约 1500 个来自 6 个上游公开仓库（`kooker/FreeSubsCheck`、`anaer/Sub`、`ermaozi/get_subscribe` 等）的节点。这些 URI 中的 UUID/password/密钥本身即上游公开分发内容，本项目未引入额外凭据。
- 风险：使用这些节点的人暴露 IP 与流量；节点被滥用的责任由用户承担 —— 已由 README「⚖️ 免责声明」明确。
- 建议保持：免责声明在 README 中常显；若上游源撤回了某密钥，本项目无法追溯（节点每 6 小时重新抓取，过期密钥自然淘汰）。

### 3.2 `agent` 系统使用 `child_process.exec` 跑测试（仅本地，不进 CI）

`agents/multi-agent-system.js:125` 对 `testCommand`（常量 `'cd .. && node test.js'`，`multi-agent-system.js:30`）执行 `exec`。命令是硬编码字符串、不接受外部输入，`exec` 在本地 `npm run agents` 场景下无注入面。**CI 不运行该文件**，故不构成供应链风险。
- 建议：无需立即改动；若未来 `testCommand` 改为可配置，须改为数组式 `execFile` 或白名单校验。

### 3.3 CI 提交步骤使用 `git pull --rebase` + `GITHUB_TOKEN`

`deploy.yml` 提交步骤：`git pull --rebase origin main && git push`。
- 令牌：`GITHUB_TOKEN` 是 GitHub 自动注入的**短期、最小权限**令牌（本 workflow 已声明 `permissions: contents: write`，未给 admin），非长期 PAT，无泄露面。
- 竞态：共享 `concurrency: autosubscribe-release`（`cancel-in-progress: false`）已消除并行 push 竞态。
- 供应链：`npm ci` 基于 lockfile + integrity SHA512 校验，包内容被篡改即安装失败；`actions/checkout@v4`、`actions/setup-node@v4` 为 GitHub 官方 action，未使用第三方 action。

### 3.4 本地 git stash 与旧分支残留（不影响公开仓库）

本地存在 `stash@{0}`（`main` 上的 wip）与 `stash@{1}`（`codex/enhanced-scoring`），以及本地分支 `codex-p0-hardening`。这些不在远端，对公开仓库无暴露，但若本地 stash 中含旧代码，清理时勿误推。

## 4. 已排除项

- 无硬编码 API 密钥、无 `.env` 入库、无私钥、无个人邮箱。
- 无第三方 GitHub Action、无 `curl | sh` 式远程脚本执行、无 `eval` 动态代码（`code-review-agent.js` 中仅为字符串检测规则）。
- `logger.js` 写 `logs/`（已 gitignore），`run-status.json` 已 gitignore，不含敏感字段。
- `docs/` 下 6 份历史文档（`AGENTS/CLEANUP/OPTIMIZATION/RESEARCH/MIGRATION/walkthrough`）均为项目自述与迁移说明，无凭据。

## 5. 遗留建议（按优先级）

| 优先级 | 事项 | 说明 |
|---|---|---|
| P0 | 提交本次 lockfile 修复 | 恢复 CI `npm ci` 可运行，否则订阅停止更新 |
| P1 | 决定 `.npmrc` 注册源策略 | 统一 `registry.npmjs.org` 并重生成 lockfile，使 CI 来源可审计 |
| P2 | 评估移除 `data/historical.json` 的 git 跟踪 | 当前仅存元信息（count/savedAt），体积与风险低；若未来扩为存全量节点凭据历史，应改 gitignore + 仅 CI 内生成 |
| P2 | 定期跑 `npm audit` | 在本地或手动 workflow 中执行，不在定时任务中增加 |

## 6. 复核命令

```powershell
git rev-parse HEAD
npm ci --dry-run            # 应 exit 0
npm test                    # 8/8 + 20/20
node -e "console.log(require('js-yaml/package.json').version)"  # CI 装出 4.3.2
```
