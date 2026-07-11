# CHANGELOG

## v4.0.0 (2026-07-11)

### Breaking Changes
- **过滤条件收紧**: 延迟阈值 2000ms -> 1500ms, 欺诈分数阈值 40 -> 30
- **节点命名格式变更**: 国旗 国家|速度|分数分 -> 国旗 国家|分数|延迟|原名

### New Features
- **ip-api.com 集成**: 替换 ipchacha.cn 作为 geo 检查和欺诈检测数据源
  - 新增 proxy 字段检测（代理/VPN 标记）
  - 新增 hosting 字段检测（数据中心/机房标记）
  - 新增 mobile 字段检测（移动网络标记）
- **欺诈评分系统**:
  - 代理 IP: +50 分（高风险，>30 自动过滤）
  - 数据中心: +35 分（中等风险，>30 自动过滤）
  - 移动网络: +15 分（轻微风险）
  - 纯净住宅 IP: 0 分
- **节点名称增强**: 包含质量评分和延迟信息

### Improvements
- README 同步时间修复（字符串操作替代正则，解决 ANSI 反转码问题）
- 历史节点回退延迟阈值同步更新为 1500ms
- 代码结构清理，删除冗余代码

### Technical Details
- Geo check API: http://ip-api.com/json/{ip}?fields=status,countryCode,regionName,city,timezone,isp,org,as,query,proxy,hosting,mobile
- 免费配额: 45次/分钟，无需 API Key
- 过滤逻辑: raudScore > 30 或 latency > 1500 或 qualityScore < 60 的节点将被移除
