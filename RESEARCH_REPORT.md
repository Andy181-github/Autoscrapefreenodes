# AutoScrapeFreeNodes 项目功能报告

## 项目概述

**项目名称**: AutoScrapeFreeNodes  
**版本**: 3.9.0  
**主要功能**: 自动抓取、去重、检测、合并免费代理节点，生成多种格式的订阅文件

---

## 核心功能模块

### 1. 数据源管理

#### 支持的数据源类型
- **GitHub Pages 站点**：爬取博客文章中的订阅链接
- **机场节点网站**：如 airportnode.com/freenode
- **直接订阅URL**：通过 config.json 配置的直接订阅地址

#### 爬虫流程
```
获取HTML → 提取订阅URL → 获取订阅内容 → 解析节点
```

### 2. 协议解析器

支持解析以下协议格式：

| 格式 | 解析函数 | 说明 |
|------|----------|------|
| Clash YAML | parseClashYaml() | .yaml/.yml 文件 |
| Sing-Box JSON | parseSingBoxJson() | .json 文件 |
| V2ray 纯文本 | parseV2rayTxt() | .txt 文件，包含 vmess/trojan/ss/vless/hysteria 等 |

### 3. 地区检测系统

**三层检测策略**：
1. **名称检测**：从节点名称识别地区（hk, tw, jp, us, sg, kr, uk, de 等）
2. **IP段检测**：识别云服务提供商IP段（AWS/GCP/Azure/Cloudflare/阿里云/腾讯云）
3. **服务器主机名检测**：通过域名关键词推断地区（railway.app→us, hkg→hk, tokyo→jp 等）

**地区优先级排序**：US(1) > HK(2) > TW(3) > JP(4) > SG(5) > KR(6) > UK(7) > DE(8) > CA(9) > AU(10) > NL(11) > FR(12)

### 4. 去重机制

三级去重策略：

```javascript
// 第一级：URL去重
seenUrls.add(url)

// 第二级：内容去重（SHA256哈希）
contentHash = sha256(content)
seenContent.set(contentHash, ...)

// 第三级：节点级去重（server:port键）
proxyKey = server + ':' + port
if (新分数 > 旧分数) 替换
```

### 5. 连通性检测

**TCP连接测试**：
- 超时时间：6秒
- 并发数：50个同时检测
- 批量处理：每批50个节点
- 统计进度：每500个节点输出一次

### 6. IP地理定位与欺诈评分

**IP地理定位**：
- 使用 ip-api.com 获取国家代码
- 国家代码映射到地区（US→us, HK→hk, TW→tw 等）
- 结果缓存避免重复请求

**欺诈评分算法**（0-100分，越高越可疑）：
- 已知代理/VPN服务商：+25分
  - Bandwagon, RackNerd, Hostinger, Namecheap, DigitalOcean, Vultr, Linode, Hetzner, OVH, Contabo 等
- 云服务提供商：+15分
  - Amazon AWS, Google GCP, Azure, 阿里云, 腾讯云, 华为云 等
- 数据中心IP段：+10分
  - 45-46段(OVH), 104段(Cloudflare/Google), 172段, 198段, 206段, 209段
- 名称关键词：+15分
  - proxy, vpn, tor, anonym, relay, jump, ssh, tunnel, bypass, freeproxy, freevpn

### 7. 质量评分系统

**基础分 + 加成 = 最终分**：
- 基础分：50分
- 非云IP：+20分
- 地区可识别：+15分
- VLESS/Trojan协议：+5分
- 启用TLS：+5分
- UDP转发：+5分
- **上限**：100分

### 8. 过滤与排序

**过滤条件**：
- 地区为 unknown 或 cloud → 剔除
- 欺诈评分 > 30 → 剔除
- 延迟 > 5000ms → 剔除
- 质量分 < 60 → 剔除

**排序规则**：
1. 主排序：质量分降序
2. 次排序：地区优先级升序（US优先）

### 9. 输出文件生成

#### 输出文件格式

| 文件名 | 格式 | 用途 |
|--------|------|------|
| mihomo.yaml | Clash Meta配置 | 完整配置，含代理组规则 |
| all.yaml | Clash配置 | 仅代理列表 |
| base64.txt | Base64编码 | 通用订阅格式 |
| byxiaoxi.txt | 纯文本 | XiaoXi客户端 |
| kooker.jp.txt | 带国旗前缀 | kooker.jp客户端 |

#### Mihomo 配置结构
```yaml
mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: true
external-controller: 0.0.0.0:9090

proxies: [所有有效节点]

proxy-groups:
  - 节点选择 (select)
    - 自动选择 (url-test)
    - 手动转换 (fallback)
  - 全球直连 (select)
  - 漏网之鱼 (select)

rules:
  - GEOSITE,category-ads-all,DIRECT
  - GEOSITE,cn,全球直连
  - GEOIP,CN,全球直连,no-resolve
  - GEOIP,LAN,全球直连,no-resolve
  - MATCH,漏网之鱼
```

### 10. URI构建器

支持构建以下协议的订阅URI：
- vmess:// (V2Ray)
- trojan:// (Trojan)
- ss:// (Shadowsocks)
- vless:// (VLESS)
- hysteria:// (Hysteria)
- hysteria2:// (Hysteria2)
- tuic:// (TUIC)
- http:// (HTTP代理)
- https:// (HTTPS代理)

### 11. 历史记录管理

**lib/history.js 提供**：
- `loadHistoricalProxies()`：加载历史节点数据
- `saveHistoricalProxies()`：保存当前节点到历史

存储路径：`data/historical.json`

### 12. README自动生成

**generate-readme.js 功能**：
- 读取生成的yaml/txt文件统计节点数量
- 生成包含统计信息的README.md
- 智能判断是否重新生成（对比节点数和时间差）
- 自动生成GitHub Raw链接

### 13. 名称重命名

**renamedContent 生成功能**：
- Clash YAML：重写 proxy.name，添加地区前缀
- Sing-Box JSON：重写 outbound.tag，添加地区前缀
- V2ray TXT：更新 remarks 参数，添加地区前缀

---

## 执行流程

```
1. 加载配置 (config.json)
       ↓
2. 爬取所有数据源
   - scrapeGithubPagesSite()
   - scrapeAirportNode()
   - fetchDirectSubscription()
       ↓
3. 合并去重 (mergeAndDeduplicate)
       ↓
4. 生成重命名内容 (generateRenamedContent)
       ↓
5. 提取所有节点对象
       ↓
6. TCP连通性检测 (runChecks)
       ↓
7. IP地理定位 + 欺诈评分 (batchGeoCheck)
       ↓
8. 计算质量评分 (calculateQualityScore)
       ↓
9. 过滤低质量节点
       ↓
10. 按质量和地区排序
       ↓
11. 生成所有输出文件
    - mihomo.yaml
    - all.yaml
    - base64.txt
    - byxiaoxi.txt
    - kooker.jp.txt
       ↓
12. 更新 README.md
```

---

## 外部依赖

```json
{
  "axios": "^1.4.0",        // HTTP请求
  "cheerio": "^1.0.0-rc.12", // HTML解析
  "fs-extra": "^11.1.1",     // 文件系统操作
  "js-yaml": "^4.0.0"       // YAML解析
}
```

---

## 关键设计特点

1. **多格式支持**：兼容 Clash/Sing-Box/V2ray 三大主流协议
2. **智能去重**：三层去重确保数据质量
3. **质量评估**：多维度评分系统筛选优质节点
4. **自动化程度高**：从爬取到输出全流程自动化
5. **多客户端适配**：输出多种格式满足不同客户端需求
6. **可扩展架构**：通过 config.json 轻松添加新数据源

---

## 技术亮点

- **并发优化**：TCP检测和地理定位均使用Promise.all批量处理
- **内存优化**：使用Map/Set进行高效去重
- **容错处理**：每个环节都有try-catch和日志记录
- **性能监控**：实时打印处理进度和统计信息

---

## 评分标准总结

```
基础分50
+ 非云IP (+20)
+ 地区识别 (+15)
+ VLESS/Trojan协议 (+5)
+ TLS加密 (+5)
+ UDP转发 (+5)
= 最高100分

过滤条件:
- 地区为 unknown 或 cloud → 剔除
- 欺诈评分 > 30 → 剔除
- 延迟 > 5000ms → 剔除
- 质量分 < 60 → 剔除
```

---

## 支持的地区代码

| 代码 | 地区 |
|------|------|
| us | 美国 |
| hk | 香港 |
| tw | 台湾 |
| jp | 日本 |
| sg | 新加坡 |
| kr | 韩国 |
| uk | 英国 |
| de | 德国 |
| fr | 法国 |
| nl | 荷兰 |
| ca | 加拿大 |
| au | 澳大利亚 |
| cn | 中国 |

---

*报告生成时间: 2026*
