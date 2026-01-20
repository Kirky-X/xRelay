## Context
当前 xRelay 项目使用内存存储代理池和黑名单，存在状态丢失、无法跨实例共享等问题。为了提高代理管理的可靠性和效率，需要引入 PostgreSQL 持久化存储。

## Goals / Non-Goals

### Goals
- 实现代理状态的持久化存储
- 支持代理失败次数追踪和自动废弃
- 实现基于权重的智能代理选择
- 支持多实例部署时共享代理状态
- 实现自动清理过期废弃代理
- 保持向后兼容（未配置数据库时使用内存模式）

### Non-Goals
- 不支持其他数据库类型（仅 PostgreSQL）
- 不实现复杂的代理评分系统（仅基于失败次数）
- 不实现分布式锁（依赖数据库事务）
- 不实现代理地理位置信息存储

## Decisions

### 1. 数据库选择：PostgreSQL
**Decision**: 使用 PostgreSQL 作为持久化存储

**Rationale**:
- Vercel 提供 Neon PostgreSQL Serverless 集成，部署简单
- 支持事务，确保数据一致性
- 性能良好，适合读写频繁的场景
- 免费额度足够小型项目使用

**Alternatives considered**:
- MySQL: Vercel 集成不如 PostgreSQL 友好
- MongoDB: 过度设计，关系型数据库更适合此场景
- Redis: 可以作为缓存层，但不适合作为主存储（数据持久性）

### 2. 表结构设计
**Decision**: 两张表 - `available_proxies` 和 `deprecated_proxies`

**Rationale**:
- 分离活跃和废弃代理，查询性能更好
- 便于实现自动清理逻辑
- 清晰的语义，易于理解和维护

**Schema**:

```sql
-- 可用代理表
CREATE TABLE available_proxies (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,  -- 支持 IPv6
  port INTEGER NOT NULL,
  source VARCHAR(100) NOT NULL,
  failure_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ip, port)
);

CREATE INDEX idx_available_proxies_failure_count ON available_proxies(failure_count);
CREATE INDEX idx_available_proxies_last_used ON available_proxies(last_used_at);

-- 废弃代理表
CREATE TABLE deprecated_proxies (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL,
  source VARCHAR(100),
  failure_count INTEGER NOT NULL,
  deprecated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(ip, port)
);

CREATE INDEX idx_deprecated_proxies_deprecated_at ON deprecated_proxies(deprecated_at);
```

### 3. 代理选择算法
**Decision**: 基于权重的随机选择，权重 = success_count / (success_count + failure_count + 1)

**Rationale**:
- 优先选择成功率高的代理
- 保留一定的随机性，避免某些代理过载
- 公式简单，计算开销小

**Alternatives considered**:
- 纯随机选择: 无法利用历史数据
- 仅选择失败次数最少的: 忽略成功次数
- 复杂的评分系统: 过度设计

### 4. 多代理回退机制
**Decision**: 每次请求选取 5 个代理，依次尝试，失败后切换下一个

**Rationale**:
- 提高请求成功率
- 5 个代理足够覆盖大多数情况
- 依次尝试避免并发开销

**Implementation**:
```typescript
async function executeWithFallback(request: Request, proxies: ProxyInfo[]): Promise<Response> {
  for (const proxy of proxies) {
    try {
      return await executeViaProxy(request, proxy);
    } catch (error) {
      reportProxyFailed(proxy);
      continue;
    }
  }
  throw new Error('All proxies failed');
}
```

### 5. 数据库客户端选择
**Decision**: 使用 `pg` 客户端库

**Rationale**:
- 成熟的 PostgreSQL 客户端
- 支持连接池
- 文档完善，社区活跃
- 兼容 Vercel Edge Runtime（使用 `@neondatabase/serverless` 作为替代）

**Alternatives considered**:
- Prisma: ORM 过重，增加复杂度
- TypeORM: 同上
- `@neondatabase/serverless`: 专为 Neon 优化，但限制较多

### 6. 向后兼容策略
**Decision**: 检测 DATABASE_URL 环境变量，未配置时使用内存模式

**Rationale**:
- 不强制用户配置数据库
- 保持现有功能不受影响
- 便于渐进式迁移

**Implementation**:
```typescript
const useDatabase = !!process.env.DATABASE_URL;
const proxyManager = useDatabase
  ? new DatabaseProxyManager()
  : new MemoryProxyManager();
```

## Risks / Trade-offs

### Risk 1: 数据库连接失败导致服务不可用
**Mitigation**:
- 实现连接重试机制
- 数据库不可用时降级到内存模式
- 添加健康检查端点

### Risk 2: 数据库查询性能瓶颈
**Mitigation**:
- 添加合适的索引
- 使用连接池
- 缓存频繁查询的结果
- 定期清理过期数据

### Risk 3: 多实例并发更新导致数据不一致
**Mitigation**:
- 使用数据库事务
- 乐观锁机制（version 字段）
- 合理设置隔离级别

### Trade-off 1: 权重计算复杂度 vs 准确性
- 选择简单的权重公式，牺牲一定的准确性换取性能

### Trade-off 2: 实时性 vs 性能
- 不实时更新代理状态，而是在请求完成后批量更新

## Migration Plan

### Phase 1: 准备
1. 添加数据库依赖
2. 创建迁移脚本
3. 在开发环境测试迁移

### Phase 2: 实现
1. 实现数据库模块
2. 修改代理管理逻辑
3. 添加兼容性处理

### Phase 3: 测试
1. 单元测试
2. 集成测试
3. 性能测试

### Phase 4: 部署
1. 在测试环境部署
2. 验证功能正常
3. 生产环境部署
4. 监控性能指标

### Rollback
- 保留内存模式作为回退选项
- 数据库不可用时自动切换到内存模式
- 提供环境变量控制模式切换

## Open Questions
1. 是否需要实现代理地理位置信息存储？（当前不需要）
2. 是否需要支持代理协议类型（HTTP/HTTPS/SOCKS）？需要
3. 是否需要实现代理预热机制？（后续优化）