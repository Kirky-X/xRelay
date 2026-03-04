# Design: 安全与性能问题修复

## Context

xRelay 是一个 Vercel Edge Function 代理服务，经过上一轮修复后仍有以下问题需要解决：

- SQL 注入风险（参数化不完整）
- SSRF 防护绕过风险
- DNS 重绑定攻击风险
- O(n²) 算法性能问题
- Serverless 状态管理问题

## Goals / Non-Goals

**Goals:**
- 修复所有 Critical 和 High 级别安全问题
- 优化关键性能瓶颈
- 提升代码可维护性

**Non-Goals:**
- 不重构整体架构
- 不添加新功能
- 不修改现有 API 接口

## Decisions

### 1. SQL 参数化方案

**Decision**: 使用 PostgreSQL 参数化查询替代字符串拼接

**Rationale**: 
- 消除 SQL 注入风险
- 利用数据库查询优化
- 代码更清晰

**Implementation**:
```sql
-- Before
WHERE deprecated_at < NOW() - INTERVAL '${days} days'

-- After  
WHERE deprecated_at < NOW() - ($1 || ' days')::interval
```

### 2. SSRF 防护增强

**Decision**: 实现 DNS 解析后二次验证

**Rationale**:
- 防止 DNS 重绑定攻击
- 覆盖更多 IPv6 映射格式

**Implementation**:
```typescript
// DNS 解析后验证
const resolved = await dnsLookup(hostname);
if (isBlockedIP(resolved)) {
  throw new Error('Blocked IP after DNS resolution');
}
```

### 3. 加权选择算法优化

**Decision**: 使用数据库层加权随机

**Rationale**:
- O(n²) → O(1) 复杂度
- 利用数据库索引优化
- 减少内存占用

**Implementation**:
```sql
SELECT * FROM available_proxies 
ORDER BY -LOG(RANDOM()) / (failure_count + 1) 
LIMIT $1
```

### 4. Serverless 状态管理

**Decision**: 依赖外部存储，移除全局可变状态

**Rationale**:
- Serverless 多实例状态不共享
- Vercel KV 提供可靠存储

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| SQL 参数化影响现有行为 | 添加单元测试验证 |
| DNS 解析增加延迟 | 缓存 DNS 结果 |
| 数据库加权随机不精确 | 可接受的近似解 |

## Migration Plan

1. 先修复安全问题（向后兼容）
2. 逐步优化性能（可增量部署）
3. 最后清理技术债务

## Open Questions

- 是否需要缓存 DNS 解析结果？TTL 设置多少？
- 加权随机算法精度是否满足业务需求？
