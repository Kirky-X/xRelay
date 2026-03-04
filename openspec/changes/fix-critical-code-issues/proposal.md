# Proposal: fix-critical-code-issues

## Summary

修复代码审查中发现的 62 个问题，包括 4 个 Critical、12 个 High、20+ 个 Medium 问题，提升项目安全性、性能和代码质量。

## Motivation

代码审查发现多个严重问题：
- **安全风险**：硬编码 API Key、SQL 注入风险、依赖漏洞 (CVE)
- **性能瓶颈**：串行代理尝试最坏延迟 40+ 秒
- **架构缺陷**：全局状态、定时任务失效、缺乏抽象层
- **质量问题**：重复代码、过长方法、魔法字符串

## Goals

### Phase 1: 紧急安全修复 (P0)
- [ ] 移除硬编码 API Key，检查生产使用情况
- [ ] 修复 SQL 注入风险
- [ ] 更新有漏洞的依赖 (tar, rollup, minimatch, esbuild)

### Phase 2: 高优先级修复 (P1)
- [ ] 完善 SSRF 防护 (DNS 重绑定、IPv6 映射地址)
- [ ] 强制生产环境 API Key 验证
- [ ] 并行化代理尝试，降低延迟
- [ ] 修复定时任务 (使用 Vercel Cron)
- [ ] 拆分 handler 函数为中间件
- [ ] 提取共享 KV 客户端模块

### Phase 3: 架构优化 (P2)
- [ ] 添加缓存/限流抽象层
- [ ] 重构 proxy-manager 模块
- [ ] 统一配置管理

### Phase 4: 质量改进 (P3)
- [ ] 消除重复代码
- [ ] 移除魔法字符串/数字
- [ ] 修复类型断言问题
- [ ] 统一日志格式

## Non-Goals

- 不进行 API 版本控制（单独 change）
- 不重构前端样式（单独 change）
- 不添加新功能

## Scope

### Scope Involved

| Item | Content |
|------|---------|
| **Modify** | `server.js`, `api/security.ts`, `api/index.ts`, `api/config.ts` |
| **Modify** | `api/database/deprecated-proxies-dao.ts`, `api/proxy-manager.ts` |
| **Modify** | `api/cache.ts`, `api/rate-limiter.ts`, `api/proxy-tester.ts` |
| **Modify** | `api/request-handler.ts`, `api/database/cleanup.ts` |
| **Create** | `api/kv-client.ts` (共享 KV 模块) |
| **Create** | `api/interfaces/cache-store.ts` (抽象接口) |
| **Create** | `api/middleware/*.ts` (中间件拆分) |
| **Modify** | `package.json` (依赖更新) |

### Impact Scope

| Component | Impact |
|-----------|--------|
| 代理请求流程 | 并行化改造 |
| 数据库操作 | SQL 安全修复 |
| 限流/缓存 | 抽象层引入 |
| 本地开发 | server.js 修复 |

## Success Criteria

1. [ ] 所有 Critical 问题修复完成
2. [ ] `npm audit` 无高危漏洞
3. [ ] 代理请求 P95 延迟 < 5 秒
4. [ ] 测试覆盖率保持或提升
5. [ ] 所有现有测试通过

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| 并行化改造影响现有逻辑 | High | 充分测试，渐进式部署 |
| 中间件拆分引入 bug | Medium | 保持行为一致，添加集成测试 |
| 依赖更新破坏兼容性 | Medium | 使用 lock 文件，测试验证 |
| 抽象层增加复杂度 | Low | 保持接口简洁，文档完善 |

## Timeline

| Phase | Duration | Milestone |
|-------|----------|-----------|
| Phase 1 | 1 天 | 安全问题修复 |
| Phase 2 | 2-3 天 | 高优先级修复 |
| Phase 3 | 2 天 | 架构优化 |
| Phase 4 | 1 天 | 质量改进 |

**Total**: 6-7 天
