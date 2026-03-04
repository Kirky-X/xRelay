# Tasks: 安全与性能问题修复

## Progress: 11/20 complete

## TDD Iron Rules

1. **No production code without a failing test**
2. **Only refactor after tests pass**
3. **Didn't see test fail before writing code = don't know if test is correct**

---

## Phase 1: Critical 安全修复 (P0) - ✅ 完成

### Task 1.1: SQL 参数化修复 - ✅ 完成

**Commit:** `4728165 security: use parameterized query for INTERVAL in deprecated-proxies-dao`

修复内容:
- 使用 `INTERVAL '1 day' * $1` 替代字符串拼接
- 防止 SQL 注入风险

---

### Task 1.2: SSRF IPv6 映射地址完善 - ✅ 完成 (已验证)

验证结果:
- `normalizeIPv6Mapping()` 已正确处理所有 IPv6 映射格式
- `::ffff:127.0.0.1` 和 `::ffff:7f00:1` 均被正确转换为 IPv4 并阻止

---

### Task 1.3: DNS 重绑定防护 - ✅ 完成

**Commit:** `490c297 security: add DNS rebinding protection`

新增功能:
- `resolveDns()` - 使用 Cloudflare DNS-over-HTTPS 解析域名
- `validateDnsResolution()` - 验证 DNS 解析结果是否为公网 IP
- `clearDnsCache()` - 清除 DNS 缓存
- 60 秒 DNS 缓存 TTL

---

## Phase 2: High 优先级修复 (P1) - ✅ 完成

### Task 2.1: Cron 端点认证强化 - ✅ 完成

**Commit:** `22dc4b6 security: enforce CRON_SECRET in production environment`

修复内容:
- 生产环境强制要求 CRON_SECRET 配置
- 移除生产环境对 x-vercel-cron header 的信任

---

### Task 2.2: 时序攻击修复 - ✅ 完成

**Commit:** `e25cddb security: fix timing attack in API key comparison`

修复内容:
- 使用固定长度填充 (padEnd)
- 长度检查移至比较末尾
- 确保恒定时间比较

---

### Task 2.3: O(n²) 加权选择优化 - ✅ 完成

**Commit:** `9886d88 perf: optimize weighted proxy selection from O(n²) to O(n log n)`

优化内容:
- 使用数据库层加权随机: `-LOG(RANDOM()) / weight`
- 移除嵌套循环
- 性能从 O(n²) 提升至 O(n log n)

---

### Task 2.4: 重复代理测试移除 - ✅ 完成

**Commit:** `f9cb453 perf: remove duplicate proxy testing in batch`

修复内容:
- 移除 `testProxiesInBatch` 中的重复测试
- 直接使用第一次测试的延迟信息排序
- 测试时间减少约 50%

---

### Task 2.5: Serverless 状态管理 - ⏸️ 暂缓

建议: 使用 Vercel KV 替代内存状态

---

## Phase 3: Medium 优先级修复 (P2) - 部分完成

### Task 3.1: 日志模块统一 - ⏸️ 暂缓

建议: 逐步替换 console.log 为 logger

---

### Task 3.2: 配置去重 - ⏸️ 暂缓

建议: 统一 PROXY_SOURCES 定义位置

---

### Task 3.3: 原子限流操作 - ⏸️ 暂缓

建议: 使用 Redis Lua 脚本

---

### Task 3.4: 代理端口验证 - ✅ 完成

**Commit:** `22e65d5 fix: add proxy port validation`

新增功能:
- `validateProxyPort()` - 端口范围验证 (1-65535)
- `validateProxyInfo()` - IP 和端口综合验证
- 特权端口警告 (<1024)

---

### Task 3.5: 批量插入限制 - ✅ 完成

**Commit:** `272bcd1 fix: add batch insert limit to prevent parameter overflow`

修复内容:
- 每批最多 1000 条代理
- 避免 PostgreSQL 参数限制 (65535)
- 大批量插入自动分批处理

---

### Task 3.6: 代理来源验证 - ✅ 完成

**Commit:** `26c7102 fix: add proxy source validation`

新增功能:
- `validateProxySource()` - 来源字符串验证
- 长度限制 (50 字符)
- 字符限制 (a-zA-Z0-9_-)
- 无效来源默认为 'unknown'

---

### Task 3.7: 危险 Header 完善 - ✅ 完成

**Commit:** `3161be1 fix: enhance dangerous headers filtering`

增强内容:
- 新增危险 headers: te, trailer, expect, range, if-*, front-end-https 等
- CRLF 注入防护
- Header 名称 RFC 7230 验证
- 空字节过滤

---

### Task 3.8: ProxyAgent 复用 - ⏸️ 暂缓

建议: 实现代理连接池

---

### Task 3.9: 全局状态上限 - ⏸️ 暂缓

建议: 为 failedProxyBlacklist 添加 LRU 淘汰

---

### Task 3.10: 数据库初始化位置 - ⏸️ 暂缓

建议: 移至模块顶层或使用单例模式

---

## Phase 4: Low 优先级修复 (P3) - 未开始

### Task 4.1: 错误信息脱敏

生产环境错误信息脱敏处理

### Task 4.2: CORS 配置统一

统一使用 CORS_CONFIG

### Task 4.3: 类型导入优化

从 undici 导入官方类型

---

## 测试结果

```
Test Files  4 failed | 4 passed (8)
Tests       4 failed | 112 passed (116)
```

失败的 4 个测试为数据库连接测试（本地无 PostgreSQL），为预期行为。

---

## 提交历史

```
3161be1 fix: enhance dangerous headers filtering
26c7102 fix: add proxy source validation
272bcd1 fix: add batch insert limit to prevent parameter overflow
22e65d5 fix: add proxy port validation
f9cb453 perf: remove duplicate proxy testing in batch
9886d88 perf: optimize weighted proxy selection from O(n²) to O(n log n)
e25cddb security: fix timing attack in API key comparison
22dc4b6 security: enforce CRON_SECRET in production environment
490c297 security: add DNS rebinding protection
4728165 security: use parameterized query for INTERVAL in deprecated-proxies-dao
```