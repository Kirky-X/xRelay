# Change: 修复安全与性能问题

## Why

代码审查发现 38 个问题（3 Critical, 9 High, 15 Medium, 11 Low），主要集中在：
- SQL 注入风险
- SSRF 防护绕过
- 性能瓶颈（O(n²) 算法）
- Serverless 架构问题

## What Changes

### Phase 1: 紧急安全修复 (P0)
- **BREAKING** 修复 SQL 注入：使用参数化查询替代字符串拼接
- 完善 SSRF 防护：增加 IPv6 映射地址检测
- 增强 DNS 重绑定防护：DNS 解析后验证 IP

### Phase 2: 高优先级修复 (P1)
- 修复 O(n²) 加权选择算法
- 强化 Cron 端点认证
- 修复时序攻击风险
- 优化 Serverless 状态管理

### Phase 3: 中优先级修复 (P2)
- 统一日志模块使用
- 消除配置重复
- 实现原子限流操作
- 完善输入验证

## Impact

- **Affected files**: 
  - `api/database/deprecated-proxies-dao.ts` - SQL 参数化
  - `api/security.ts` - SSRF 增强
  - `api/request-handler.ts` - DNS 重绑定防护
  - `api/database/available-proxies-dao.ts` - 算法优化
  - `api/cron/cleanup.ts` - 认证强化
  - `api/middleware/api-key.ts` - 时序攻击修复
  - `api/rate-limiter.ts` - 原子操作

- **Risk level**: Medium
  - SQL 参数化可能影响现有查询行为
  - SSRF 增强可能误拦截合法请求

- **Testing requirement**: 
  - 安全测试：SSRF 绕过测试、SQL 注入测试
  - 性能测试：加权选择算法基准测试
  - 回归测试：现有功能不受影响
