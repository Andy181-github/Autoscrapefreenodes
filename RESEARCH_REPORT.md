# GitHub Research Report: Free Node Scraping & Subscription Aggregation

## Research Date: 2026-07-06
## Target Project: D:\Codex skill\AutoScrapeFreeNodes (v3.2.0)

---

## 1. Promising Repos Found

### A. beck-8/subs-check (5,051 stars, Go) — THE authoritative reference
- Most popular node check tool; almost all others build on it
- Full config: 60+ options including media unlock, IP risk scoring, historical retention
- Key features we did NOT study deeply: media platform detection, webhook notifications

### B. MiracleNan/subscribe-true-grading (4 stars, Python) — Novel quality grading
- Multi-stage pipeline: quick probe + AI reachability + long-connection + IP reputation
- 6-dimension scoring (S/A/B/C/D tiers)
- Noise filter regex to exclude scam/promotional node names
- Proxy fingerprinting across 12 fields for better dedup
- Uses mihomo binary for REAL proxy probing (not static field filtering)

### C. LordVibeCoding/clash-sub-aggregator (TypeScript/Go) — Full-stack aggregator
- Region-based filtering (HK/SG/TW/JP hardcoded)
- Base64 auto-decode + SQLite persistence
- Health check via mihomo API with semaphore-based concurrency (5 parallel)
- Blacklist mechanism with auto-restart mihomo on changes
- UUID-based subscription management
- Built-in React web UI (Vite + shadcn)

### D. tankeito/clash-verge-auto-switch (4 stars, Python) — macOS auto-switching
- Launchd-based scheduled speed testing
- Auto-switches to lowest-latency healthy node

### E. kooker/FreeSubsCheck (63 stars) — Already studied

---

## 2. Optimization Ideas (NOT in current project)

### PRIORITY 1 — High Impact, Low Effort

#### 2.1 Media Platform Unlock Detection
- Source: beck-8/subs-check, MiracleNan
- Current: NO media unlock detection
- Idea: Probe Netflix/OpenAI/Gemini/Disney+/YouTube/Claude/Spotify/TikTok
- Tag nodes with platform badges
- Impact: Huge user value for node selection

#### 2.2 Noise/Scam Filter Regex
- Source: MiracleNan
- Current: No filtering of promotional node names
- Idea: Filter names containing 剩余流量/到期/套餐/购买/免费/付费 etc.
- Impact: Clean up output significantly

#### 2.3 Enhanced Node Naming with Platform Badges
- Source: beck-8/subs-check, MiracleNan
- Current: Only country flag prefix
- Idea: Add [NF][GPT+][GM][D+] badges to node names
- Format: ���🇭🇰[NF][GPT+]hk-proxy
- Impact: Makes node selection much easier

#### 2.4 Proxy Fingerprint Deduplication
- Source: MiracleNan
- Current: Only Server:Port dedup
- Idea: Extend to type+UUID+password+cipher+network+flow
- Impact: Better dedup for VMess/VLESS

### PRIORITY 2 — Medium Impact, Medium Effort

#### 2.5 Historical Node Retention (Keep-Old-Nodes)
- Source: beck-8/subs-check
- Current: No memory of previously working nodes
- Idea: Save snapshots, carry forward nodes from last N days
- Auto-clean history older than keep-days
- Impact: Reduces churn, keeps reliable nodes alive

#### 2.6 Shuffle Test Order
- Source: beck-8/subs-check
- Current: Sequential testing
- Idea: Randomize test order to prevent IP clustering
- Impact: Reduces false negatives from burst traffic

#### 2.7 AI Reachability Scoring
- Source: MiracleNan
- Current: Simple latency only
- Idea: Multi-target weighted scoring (GPT:25, Daily:20, GitHub:12, YouTube:8)
- Impact: Better node quality assessment

#### 2.8 Configurable Speed Test URL
- Source: beck-8/subs-check
- Current: No speed testing
- Idea: Warn against Speedtest/Cloudflare (nodes block these)
- Recommend: GitHub release files or custom CF Worker

### PRIORITY 3 — Lower Impact or Higher Effort

#### 2.9 WebDAV/S3/Gist Auto-Upload
- Source: beck-8/subs-check
- Auto-upload results to cloud storage

#### 2.10 Sub-Store Integration
- Source: beck-8/subs-check
- Embedded Sub-Store for advanced transformation

#### 2.11 Mihomo API Integration
- Source: LordVibeCoding
- Direct mihomo API for real proxy testing

#### 2.12 Callback Scripts + Notifications
- Source: beck-8/subs-check (100+ via Apprise)
- Post-check hooks for Telegram/DingTalk/etc.

---

## 3. Comparison Matrix

| Feature | Current | beck-8 | MiracleNan | LordVibe |
|---------|:-:|:-:|:-:|:-:|
| Multi-source scraping | Yes | No | No | No |
| YAML/TXT/JSON parsing | Yes | Yes | Yes | Yes |
| Server:Port dedup | Yes | Yes | No | Name dedup |
| Region detection | Basic | IP-based | No | Hardcoded |
| Flag emoji prefix | Yes | Yes | No | No |
| Connectivity check | Partial (DNS) | mihomo probe | mihomo | mihomo API |
| Speed testing | No | Yes | Yes | Yes |
| Media unlock | No | 8 platforms | 4 targets | No |
| Noise/scam filter | No | No | Yes (regex) | No |
| Historical retention | No | Yes (keep-days) | No | No |
| Shuffle test order | No | Yes | No | No |
| Quality scoring | No | No | S/A/B/C/D | No |
| Base64 decode | Yes | Yes | Yes | Yes |
| Auto-upload | No | WebDAV/S3/Gist | No | No |
| Web UI | No | Built-in | No | React+shadcn |
| Docker support | Yes | Yes | No | Yes |
| Cron scheduling | Yes | Yes | No | No |

---

## 4. Recommended Implementation Order

1. Noise filter regex (10 min)
2. Proxy fingerprint dedup (30 min)
3. Platform badge tagging (1-2 hours)
4. Historical node retention (2-3 hours)
5. Shuffle test order (15 min)
6. Quality scoring system (3-4 hours)
7. Configurable speed test URL (30 min)
8. WebDAV/S3 upload (2 hours)

---

## 5. Additional Repos Worth Exploring

- ProxyList/free-proxy — Popular free proxy list (check scraping patterns)
- free-proxy-ml/free-proxy-ml — ML-based proxy detection (novel approach)
- Hamed-Gharghi/V2Ray-Checker — GUI+CLI checker with Windows exe
- RichTiTAN/V2rayTested — Small app for subscription checking
- missuo/SubsNetflixCheck — Netflix unlock check tool (5 stars)