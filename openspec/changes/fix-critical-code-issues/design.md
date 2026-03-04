# Design: fix-critical-code-issues

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      API Entry Point                         │
│                       (api/index.ts)                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ API Key     │→ │ Rate        │→ │ Request             │  │
│  │ Middleware  │  │ Limiter     │  │ Parser              │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Proxy Request Handler                   │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────────┐    │    │
│  │  │ Security  │→ │ Proxy     │→ │ Response      │    │    │
│  │  │ Validator │  │ Selector  │  │ Builder       │    │    │
│  │  └───────────┘  └───────────┘  └───────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Infrastructure Layer                     │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  KV Client   │  Database    │  Cache       │  Rate Limiter │
│  (Shared)    │  (Postgres)  │  (Abstract)  │  (Abstract)   │
└──────────────┴──────────────┴──────────────┴───────────────┘
```

---

## Component Design

### 1. 共享 KV 客户端模块

**问题**: `getKV()` 在 `cache.ts` 和 `rate-limiter.ts` 中重复实现

**方案**: 提取到 `api/kv-client.ts`

```typescript
// api/kv-client.ts
import type { createClient } from "@vercel/kv";

type KVClient = ReturnType<typeof createClient>;

let kvInstance: KVClient | null = null;

export async function getKV(): Promise<KVClient | null> {
  if (kvInstance) return kvInstance;
  
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  
  if (!kvUrl || !kvToken) {
    console.log("[KV] KV 未配置，使用降级模式");
    return null;
  }
  
  const { createClient } = await import("@vercel/kv");
  kvInstance = createClient({
    url: kvUrl,
    token: kvToken,
  });
  
  return kvInstance;
}

export function resetKV(): void {
  kvInstance = null;
}
```

### 2. 缓存抽象接口

**问题**: 直接依赖 Vercel KV 具体实现

**方案**: 定义抽象接口，支持多种后端

```typescript
// api/interfaces/cache-store.ts
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { px?: number }): Promise<void>;
  del(key: string): Promise<void>;
  scanIterator(options: { match: string }): AsyncIterable<string>;
}

// api/adapters/kv-cache-store.ts
export class KVCacheStore implements CacheStore {
  constructor(private kv: KVClient) {}
  
  async get<T>(key: string): Promise<T | null> {
    return this.kv.get<T>(key);
  }
  // ... 其他方法
}

// api/adapters/memory-cache-store.ts
export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, { value: any; expiry?: number }>();
  // ... 本地开发用内存实现
}
```

### 3. 中间件拆分

**问题**: `handler` 函数 170+ 行，包含 12 个处理步骤

**方案**: 拆分为独立中间件

```typescript
// api/middleware/compose.ts
type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;

export function compose(...middlewares: Middleware[]): Middleware {
  return async (ctx, next) => {
    let index = 0;
    
    const dispatch = async (i: number): Promise<void> => {
      if (i >= middlewares.length) return next();
      await middlewares[i](ctx, () => dispatch(i + 1));
    };
    
    await dispatch(0);
  };
}

// api/middleware/api-key.ts
export async function validateApiKey(ctx: Context, next: () => Promise<void>): Promise<void> {
  const apiKey = ctx.request.headers.get("x-api-key");
  
  if (!ctx.config.enableApiKey) {
    return next();
  }
  
  if (!apiKey || !ctx.config.apiKeys.includes(apiKey)) {
    ctx.response = new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
    return;
  }
  
  await next();
}

// api/middleware/rate-limit.ts
export async function rateLimit(ctx: Context, next: () => Promise<void>): Promise<void> {
  // 限流逻辑
  await next();
}

// api/index.ts (重构后)
const handler = compose(
  corsMiddleware,
  validateApiKey,
  rateLimit,
  parseRequestBody,
  validateRequest,
  handleProxyRequest
);
```

### 4. 并行代理尝试

**问题**: 串行代理尝试最坏延迟 40+ 秒

**方案**: 并行竞速 + 快速失败

```typescript
// api/proxy-selector.ts
export async function selectProxyWithRace(
  proxies: ProxyInfo[],
  targetUrl: string,
  options: { maxParallel: number; timeout: number }
): Promise<{ proxy: ProxyInfo; response: Response } | null> {
  const { maxParallel = 3, timeout = 5000 } = options;
  
  // 分批并行尝试
  for (let i = 0; i < proxies.length; i += maxParallel) {
    const batch = proxies.slice(i, i + maxParallel);
    
    const results = await Promise.allSettled(
      batch.map(proxy => tryProxy(proxy, targetUrl, timeout))
    );
    
    const success = results.find(r => r.status === 'fulfilled' && r.value.ok);
    if (success) {
      return success.value;
    }
  }
  
  return null;
}
```

### 5. SSRF 防护增强

**问题**: 未防护 DNS 重绑定、IPv6 映射地址

**方案**: 多层防护

```typescript
// api/security.ts (增强版)
const BLOCKED_IP_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },      // 0.0.0.0/8
  { start: '127.0.0.0', end: '127.255.255.255' },  // Loopback
  { start: '10.0.0.0', end: '10.255.255.255' },    // Private A
  { start: '172.16.0.0', end: '172.31.255.255' },  // Private B
  { start: '192.168.0.0', end: '192.168.255.255' },// Private C
  { start: '169.254.0.0', end: '169.254.255.255' },// Link-local
];

export async function isBlockedIP(ip: string): Promise<boolean> {
  // 1. 检查 IPv6 映射地址 (::ffff:127.0.0.1)
  const normalizedIP = normalizeIPv6Mapping(ip);
  
  // 2. 检查 IP 范围
  if (isInBlockedRange(normalizedIP, BLOCKED_IP_RANGES)) {
    return true;
  }
  
  return false;
}

export async function validateUrlWithDNSRebind(
  urlString: string
): Promise<{ valid: boolean; reason?: string }> {
  const url = new URL(urlString);
  
  // 第一次 DNS 解析
  const ips1 = await dnsResolve(url.hostname);
  
  // 短暂等待
  await sleep(100);
  
  // 第二次 DNS 解析（检测重绑定）
  const ips2 = await dnsResolve(url.hostname);
  
  if (!arraysEqual(ips1, ips2)) {
    return { valid: false, reason: 'DNS rebinding detected' };
  }
  
  // 检查解析结果是否为内网 IP
  for (const ip of ips1) {
    if (await isBlockedIP(ip)) {
      return { valid: false, reason: `Blocked IP: ${ip}` };
    }
  }
  
  return { valid: true };
}
```

### 6. 定时任务修复

**问题**: `setInterval` 在无服务器环境失效

**方案**: 使用 Vercel Cron Jobs + API 端点

```typescript
// api/cron/cleanup.ts (新端点)
export default async function handler(request: Request): Promise<Response> {
  // 验证 Cron 密钥
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // 执行清理
  const result = await runCleanup();
  
  return Response.json({ success: true, ...result });
}
```

```json
// vercel.json (添加 cron 配置)
{
  "crons": [{
    "path": "/api/cron/cleanup",
    "schedule": "0 */6 * * *"
  }]
}
```

---

## Data Model

无新增数据模型，仅修改现有逻辑。

---

## API Design

### 新增端点

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/cron/cleanup` | Cron 触发的清理任务 |

### 行为变更

| API | Before | After |
|-----|--------|-------|
| `/api` | 串行代理尝试 | 并行代理尝试 (最多 3 个并行) |
| `/api` | 无 DNS 重绑定检测 | 双重 DNS 解析验证 |

---

## Error Handling

### 代理尝试失败

```typescript
// Before: 串行失败后返回最后一个错误
// After: 记录所有失败原因，返回聚合错误
{
  "error": "All proxies failed",
  "details": [
    { "proxy": "x.x.x.x:8080", "reason": "Connection timeout" },
    { "proxy": "y.y.y.y:8080", "reason": "SSL error" }
  ]
}
```

### 限流降级

```typescript
// Before: KV 不可用时完全放行
// After: KV 不可用时使用内存限流
export async function checkRateLimit(ip: string): Promise<{ allowed: boolean }> {
  const kv = await getKV();
  
  if (!kv) {
    // 降级到内存限流
    return memoryRateLimiter.check(ip);
  }
  
  return kvRateLimiter.check(kv, ip);
}
```

---

## Migration Plan

### Phase 1: 安全修复 (无破坏性变更)

1. 更新 `package.json` 依赖
2. 修复 `server.js` 硬编码 API Key
3. 修复 `deprecated-proxies-dao.ts` SQL 注入

### Phase 2: 中间件重构 (行为保持一致)

1. 创建 `api/middleware/` 目录
2. 实现中间件函数
3. 使用 `compose` 组合
4. 验证行为一致性

### Phase 3: 并行化改造 (需测试)

1. 实现 `selectProxyWithRace`
2. 添加配置开关 (`PARALLEL_PROXY_ENABLED`)
3. 渐进式部署

### Phase 4: 定时任务迁移

1. 创建 `/api/cron/cleanup` 端点
2. 添加 `CRON_SECRET` 环境变量
3. 配置 `vercel.json` cron
4. 移除 `setInterval` 代码

---

## Configuration Changes

### 新增环境变量

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Cron 端点认证密钥 |
| `PARALLEL_PROXY_ENABLED` | No | 并行代理开关 (default: true) |
| `PARALLEL_PROXY_MAX` | No | 最大并行数 (default: 3) |

### 行为变更

| Config | Before | After |
|--------|--------|-------|
| `MAX_REQUEST_SIZE` | 10MB | 100KB |
| `ENABLE_API_KEY` | 可选 | 生产环境必须为 true |
