# 订阅链接迁移说明

> ⚠️ **破坏性变更（v3.9.1 结构重构 Phase 2，2026-09-18）**
> 5 个订阅文件已从仓库根目录迁移到 `artifacts/subs/` 子目录。
> **旧的根目录 raw URL 现已 404，下游订阅客户端需一次性更新 URL。**

## 背景

为区分「CI 交付物」与「本地生成垃圾 / 缓存 / 遗留数据」，本次结构重构将：

- 本地运行垃圾、缓存、v3.3.x 遗留快照迁入 `artifacts/`（gitignore）
- 5 个**订阅交付文件**迁入 `artifacts/subs/`（仍被 git 跟踪，CI 用 `git add -f` 提交）
- 人工文档迁入 `docs/`

由于 5 个订阅文件是 `raw.githubusercontent.com` 公开链接的锚点，迁移路径后**所有下游订阅链接失效**，必须手动迁移。GitHub raw 服务对纯路径变更**不会**做 301 重定向（仅有仓库名大小写差异时才会自动重定向）。

## URL 变更对照

仓库：`Andy181-github/AutoScrapeFreeNodes`，分支：`main`

| 文件 | 旧 URL（已 404） | 新 URL |
|---|---|---|
| mihomo.yaml | `.../main/mihomo.yaml` | `.../main/artifacts/subs/mihomo.yaml` |
| all.yaml | `.../main/all.yaml` | `.../main/artifacts/subs/all.yaml` |
| base64.txt | `.../main/base64.txt` | `.../main/artifacts/subs/base64.txt` |
| byxiaoxi.txt | `.../main/byxiaoxi.txt` | `.../main/artifacts/subs/byxiaoxi.txt` |
| kooker.jp.txt | `.../main/kooker.jp.txt` | `.../main/artifacts/subs/kooker.jp.txt` |

**完整新 URL**（直接可用）：

```
https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/mihomo.yaml
https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/all.yaml
https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/base64.txt
https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/byxiaoxi.txt
https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/kooker.jp.txt
```

> 说明：`generate-readme.js` 用大写仓库名 `AutoScrapeFreeNodes`，`scraper.js` 历史硬编码用小写 `Autoscrapefreenodes`。两者在 GitHub 上都会 301 到正确大小写，**新旧 URL 均能正常解析**，无需区分大小写。

## 各客户端如何迁移

### 1. Mihomo / Clash Meta（订阅 URL）

把订阅地址中的 `/main/` 后直接跟文件名的部分，改为 `/main/artifacts/subs/` + 文件名。

例：
```diff
- url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/mihomo.yaml
+ url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/mihomo.yaml
```

Clash 客户端（Clash / ClashX / ClashX Meta）同理，替换 profile URL。

### 2. Clash / Standard（all.yaml）

```diff
- url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/all.yaml
+ url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/all.yaml
```

### 3. Base64 通用 / XiaoXi / kooker.jp（TXT）

```diff
- url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/base64.txt
+ url: https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/base64.txt
```
`byxiaoxi.txt`、`kooker.jp.txt` 同理（替换文件名）。

### 4. 批量替换（已有大量旧链接时）

在订阅配置文件里一次性全局替换：

```diff
- raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/
+ raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/
```

## 验证迁移

迁移后用浏览器或 `curl` 验证 200：

```bash
curl -I https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/artifacts/subs/mihomo.yaml
# 期望: HTTP/2 200
```

旧链接应返回 404：

```bash
curl -I https://raw.githubusercontent.com/Andy181-github/AutoScrapeFreeNodes/main/mihomo.yaml
# 期望: 404 Not Found
```

## 后续 CI 行为

- `update-subs.yml`（每 2 小时）与 `deploy.yml`（每 5 小时）现在用 `git add -f artifacts/subs/...` 提交新路径的订阅文件。
- 推送后 GitHub Pages / raw 服务立即以新路径生效。
- 若上游第三方订阅源（`config.json` 中 6 个 raw URL）不可达，`batchGeoCheck`/抓取流程会按 L2 磁盘缓存（24h）兜底，不影响本次路径迁移。

## 回滚（如需要）

如需回退到根目录方案，参考 `data/team-artifacts/20260711/refactor-plan.md` 的 Phase 2 反向步骤：

1. `git mv artifacts/subs/{mihomo.yaml,all.yaml,base64.txt,byxiaoxi.txt,kooker.jp.txt}` 回根目录
2. 还原 `scraper.js`、`generate-readme.js`、`.gitignore`、`update-subs.yml`、`deploy.yml` 中对应的路径与 `git add -f` 逻辑
3. 重新生成 README 并推送

> 回滚同样会影响下游（又一次链接变更），请在发布渠道先公告。
