# Tasks: fix-critical-code-issues

## Progress: 0/24 complete

## TDD Iron Rules

1. **No production code without a failing test**
2. **Only refactor after tests pass**
3. **Didn't see test fail before writing code = don't know if test is correct**

---

## Phase 1: 紧急安全修复 (P0)

### Task 1.1: 移除硬编码 API Key

**Files:**
- Modify: `server.js:46`
- Test: 手动验证

**Step 1: 定位问题代码**

检查 `server.js` 中是否包含硬编码密钥。

**Step 2: 移除硬编码密钥**

```javascript
// Before
curl -X POST https://x-relay.vercel.app/api \
  -H "x-api-key: 2857d873479991ec..." \
  ...

// After
curl -X POST https://x-relay.vercel.app/api \
  -H "x-api-key: YOUR_API_KEY" \
  ...
```

**Step 3: 检查生产环境**

确认硬编码密钥是否已在生产使用，如有需立即轮换。

**Step 4: 提交**

```bash
git add server.js
git commit -m "security: remove hardcoded API key from example"
```

---

### Task 1.2: 修复 SQL 注入风险

**Files:**
- Modify: `api/database/deprecated-proxies-dao.ts:69-73, 78-81`
- Test: `api/database/__tests__/database.test.ts`

**Step 1: 编写测试**

```typescript
// api/database/__tests__/database.test.ts
describe('SQL Injection Prevention', () => {
  it('should reject non-integer days parameter', async () => {
    await expect(deleteOldDeprecatedProxies('1; DROP TABLE deprecated_proxies--'))
      .rejects.toThrow('Invalid days parameter');
  });
  
  it('should accept valid integer days', async () => {
    // Mock or use test database
    const result = await deleteOldDeprecatedProxies(7);
    expect(result).toBeDefined();
  });
});
```

**Step 2: 运行测试确认失败**

```bash
npm test -- --run api/database/__tests__/database.test.ts
```

**Step 3: 实现修复**

```typescript
// api/database/deprecated-proxies-dao.ts
export async function deleteOldDeprecatedProxies(days: number): Promise<number> {
  // 验证输入
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('Invalid days parameter: must be integer between 1 and 365');
  }
  
  const query = `
    DELETE FROM deprecated_proxies 
    WHERE deprecated_at < NOW() - INTERVAL '${days} days'
  `;
  // ... 执行查询
}
```

**Step 4: 运行测试确认通过**

**Step 5: 提交**

```bash
git add api/database/deprecated-proxies-dao.ts api/database/__tests__/database.test.ts
git commit -m "security: fix SQL injection in deprecated-proxies-dao"
```

---

### Task 1.3: 更新有漏洞的依赖

**Files:**
- Modify: `package.json`

**Step 1: 检查漏洞**

```bash
npm audit
```

**Step 2: 更新依赖**

```bash
npm update tar rollup minimatch esbuild
```

**Step 3: 验证更新**

```bash
npm audit
npm test
```

**Step 4: 提交**

```bash
git add package.json package-lock.json
git commit -m "security: update vulnerable dependencies (tar, rollup, minimatch, esbuild)"
```

---

### Task 1.4: 强制生产环境 API Key 验证

**Files:**
- Modify: `api/config.ts`
- Modify: `api/index.ts:54-63`
- Test: `api/__tests__/unit.test.ts`

**Step 1: 编写测试**

```typescript
describe('Production API Key Enforcement', () => {
  it('should reject requests without API key in production', async () => {
    process.env.VERCEL = '1';
    process.env.ENABLE_API_KEY = 'false';
    process.env.API_KEYS = '';
    
    const response = await handler(new Request('http://localhost/api'));
    expect(response.status).toBe(500);
  });
});
```

**Step 2: 运行测试确认失败**

**Step 3: 实现强制检查**

```typescript
// api/config.ts
export function validateProductionConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (isProduction()) {
    if (!process.env.API_KEYS || process.env.API_KEYS.trim() === '') {
      errors.push('API_KEYS must be set in production');
    }
    if (process.env.ENABLE_API_KEY !== 'true') {
      errors.push('ENABLE_API_KEY must be true in production');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// api/index.ts
const { valid, errors } = validateProductionConfig();
if (!valid) {
  console.error('[Config] Invalid production config:', errors);
  return new Response(JSON.stringify({ 
    error: 'Server misconfigured',
    details: errors 
  }), { status: 500 });
}
```

**Step 4: 运行测试确认通过**

**Step 5: 提交**

```bash
git add api/config.ts api/index.ts api/__tests__/unit.test.ts
git commit -m "security: enforce API key in production environment"
```

---

## Phase 2: 高优先级修复 (P1)

### Task 2.1: 提取共享 KV 客户端模块

**Files:**
- Create: `api/kv-client.ts`
- Modify: `api/cache.ts`
- Modify: `api/rate-limiter.ts`
- Test: `api/__tests__/kv-client.test.ts`

**Step 1: 编写测试**

```typescript
// api/__tests__/kv-client.test.ts
import { getKV, resetKV } from '../kv-client';

describe('KV Client', () => {
  beforeEach(() => resetKV());
  
  it('should return null when KV not configured', async () => {
    delete process.env.KV_REST_API_URL;
    const kv = await getKV();
    expect(kv).toBeNull();
  });
  
  it('should return singleton instance', async () => {
    process.env.KV_REST_API_URL = 'http://test';
    process.env.KV_REST_API_TOKEN = 'test-token';
    
    const kv1 = await getKV();
    const kv2 = await getKV();
    expect(kv1).toBe(kv2);
  });
});
```

**Step 2: 运行测试确认失败**

**Step 3: 实现共享模块**

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
  kvInstance = createClient({ url: kvUrl, token: kvToken });
  
  return kvInstance;
}

export function resetKV(): void {
  kvInstance = null;
}
```

**Step 4: 更新 cache.ts 和 rate-limiter.ts**

```typescript
// api/cache.ts
import { getKV } from './kv-client';
// 删除重复的 getKV 实现
```

**Step 5: 运行测试确认通过**

**Step 6: 提交**

```bash
git add api/kv-client.ts api/cache.ts api/rate-limiter.ts api/__tests__/kv-client.test.ts
git commit -m "refactor: extract shared KV client module"
```

---

### Task 2.2: 完善 SSRF 防护

**Files:**
- Modify: `api/security.ts`
- Test: `api/__tests__/security.test.ts`

**Step 1: 编写测试**

```typescript
// api/__tests__/security.test.ts
describe('SSRF Protection', () => {
  it('should block 0.0.0.0', async () => {
    const result = await isBlockedIP('0.0.0.0');
    expect(result).toBe(true);
  });
  
  it('should block IPv6 mapped localhost', async () => {
    const result = await isBlockedIP('::ffff:127.0.0.1');
    expect(result).toBe(true);
  });
  
  it('should allow public IP', async () => {
    const result = await isBlockedIP('8.8.8.8');
    expect(result).toBe(false);
  });
});
```

**Step 2: 运行测试确认失败**

**Step 3: 实现 SSRF 防护增强**

```typescript
// api/security.ts
function normalizeIPv6Mapping(ip: string): string {
  // 处理 IPv6 映射地址 ::ffff:x.x.x.x
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
  const match = ip.match(v4Mapped);
  return match ? match[1] : ip;
}

export async function isBlockedIP(ip: string): Promise<boolean> {
  const normalized = normalizeIPv6Mapping(ip);
  
  // 检查 0.0.0.0/8
  if (normalized.startsWith('0.')) return true;
  
  // 检查其他私有范围
  // ... 现有逻辑
}
```

**Step 4: 运行测试确认通过**

**Step 5: 提交**

```bash
git add api/security.ts api/__tests__/security.test.ts
git commit -m "security: enhance SSRF protection for IPv6 mapping and 0.0.0.0"
```

---

### Task 2.3: 并行化代理尝试

**Files:**
- Modify: `api/request-handler.ts`
- Modify: `api/config.ts`
- Test: `api/__tests__/proxy-race.test.ts`

**Step 1: 编写测试**

```typescript
// api/__tests__/proxy-race.test.ts
describe('Parallel Proxy Race', () => {
  it('should return first successful proxy', async () => {
    const proxies = [
      { host: 'slow.proxy', port: 8080 },
      { host: 'fast.proxy', port: 8080 },
    ];
    
    const result = await selectProxyWithRace(proxies, 'http://example.com', {
      maxParallel: 3,
      timeout: 1000
    });
    
    expect(result).toBeDefined();
    expect(result.proxy.host).toBe('fast.proxy');
  });
  
  it('should fail after all attempts', async () => {
    const proxies = [
      { host: 'bad.proxy', port: 8080 },
    ];
    
    const result = await selectProxyWithRace(proxies, 'http://example.com', {
      maxParallel: 3,
      timeout: 100
    });
    
    expect(result).toBeNull();
  });
});
```

**Step 2: 运行测试确认失败**

**Step 3: 实现并行代理选择**

```typescript
// api/request-handler.ts
async function selectProxyWithRace(
  proxies: ProxyInfo[],
  targetUrl: string,
  config: { maxParallel: number; timeout: number }
): Promise<{ proxy: ProxyInfo; response: Response } | null> {
  const { maxParallel = 3, timeout = 5000 } = config;
  
  for (let i = 0; i < proxies.length; i += maxParallel) {
    const batch = proxies.slice(i, i + maxParallel);
    
    const results = await Promise.allSettled(
      batch.map(proxy => tryProxyRequest(proxy, targetUrl, timeout))
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) {
        return result.value;
      }
    }
  }
  
  return null;
}
```

**Step 4: 运行测试确认通过**

**Step 5: 提交**

```bash
git add api/request-handler.ts api/config.ts api/__tests__/proxy-race.test.ts
git commit -m "perf: implement parallel proxy race selection"
```

---

### Task 2.4: 修复定时任务 (Vercel Cron)

**Files:**
- Create: `api/cron/cleanup.ts`
- Modify: `vercel.json`
- Modify: `api/database/cleanup.ts`

**Step 1: 创建 Cron 端点**

```typescript
// api/cron/cleanup.ts
import { runCleanup } from '../database/cleanup';

export default async function handler(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization');
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedAuth) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  try {
    const result = await runCleanup();
    return Response.json({ success: true, ...result });
  } catch (error) {
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
```

**Step 2: 配置 vercel.json**

```json
{
  "crons": [{
    "path": "/api/cron/cleanup",
    "schedule": "0 */6 * * *"
  }]
}
```

**Step 3: 移除 setInterval**

```typescript
// api/database/cleanup.ts
// 删除 setInterval 相关代码
```

**Step 4: 提交**

```bash
git add api/cron/cleanup.ts vercel.json api/database/cleanup.ts
git commit -m "fix: replace setInterval with Vercel Cron for cleanup task"
```

---

### Task 2.5: 添加请求体大小限制

**Files:**
- Modify: `api/config.ts:109`
- Test: `api/__tests__/config.test.ts`

**Step 1: 编写测试**

```typescript
describe('Request Size Limit', () => {
  it('should reject requests larger than 100KB', async () => {
    const largeBody = 'x'.repeat(101 * 1024);
    const response = await handler(new Request('http://localhost/api', {
      method: 'POST',
      body: JSON.stringify({ body: largeBody })
    }));
    expect(response.status).toBe(413);
  });
});
```

**Step 2: 修改配置**

```typescript
// api/config.ts
export const REQUEST_CONFIG = {
  maxBodySize: 100 * 1024, // 100KB (was 10MB)
  timeout: 30000,
};
```

**Step 3: 运行测试确认通过**

**Step 4: 提交**

```bash
git add api/config.ts api/__tests__/config.test.ts
git commit -m "security: reduce max request body size to 100KB"
```

---

### Task 2.6: 添加 Headers 过滤

**Files:**
- Modify: `api/request-handler.ts:20-50`
- Test: `api/__tests__/headers-filter.test.ts`

**Step 1: 编写测试**

```typescript
describe('Headers Filtering', () => {
  it('should filter dangerous headers', () => {
    const input = {
      'Host': 'evil.com',
      'Content-Length': '999999',
      'X-Custom': 'valid'
    };
    
    const filtered = filterDangerousHeaders(input);
    expect(filtered).toEqual({ 'X-Custom': 'valid' });
  });
});
```

**Step 2: 实现过滤逻辑**

```typescript
// api/request-handler.ts
const DANGEROUS_HEADERS = new Set([
  'host', 'content-length', 'transfer-encoding',
  'connection', 'keep-alive', 'upgrade'
]);

export function filterDangerousHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    if (!DANGEROUS_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  
  return filtered;
}
```

**Step 3: 运行测试确认通过**

**Step 4: 提交**

```bash
git add api/request-handler.ts api/__tests__/headers-filter.test.ts
git commit -m "security: add headers filtering to prevent injection"
```

---

## Phase 3: 架构优化 (P2)

### Task 3.1: 拆分 handler 为中间件

**Files:**
- Create: `api/middleware/compose.ts`
- Create: `api/middleware/cors.ts`
- Create: `api/middleware/api-key.ts`
- Create: `api/middleware/rate-limit.ts`
- Modify: `api/index.ts`

**Step 1: 编写中间件测试**

```typescript
// api/__tests__/middleware.test.ts
describe('Middleware Composition', () => {
  it('should execute middlewares in order', async () => {
    const order: number[] = [];
    
    const m1 = async (ctx, next) => { order.push(1); await next(); };
    const m2 = async (ctx, next) => { order.push(2); await next(); };
    
    await compose(m1, m2)({}, async () => { order.push(3); });
    
    expect(order).toEqual([1, 2, 3]);
  });
});
```

**Step 2: 实现中间件框架**

**Step 3: 重构 handler**

**Step 4: 验证行为一致性**

**Step 5: 提交**

```bash
git add api/middleware/ api/index.ts api/__tests__/middleware.test.ts
git commit -m "refactor: split handler into middleware pipeline"
```

---

### Task 3.2: 统一 CORS 配置

**Files:**
- Modify: `api/config.ts`
- Modify: `api/index.ts`

**Step 1: 提取 CORS 配置**

```typescript
// api/config.ts
export const CORS_CONFIG = {
  allowedOrigins: [
    "https://vercel-proxy-shield.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Content-Type', 'x-api-key'],
};
```

**Step 2: 更新使用位置**

**Step 3: 提交**

```bash
git add api/config.ts api/index.ts
git commit -m "refactor: unify CORS configuration"
```

---

## Phase 4: 质量改进 (P3)

### Task 4.1: 移除魔法数字

**Files:**
- Modify: `api/proxy-fetcher.ts:90`
- Modify: `api/config.ts`

**Step 1: 提取常量**

```typescript
// api/config.ts
export const PROXY_FETCHER_CONFIG = {
  timeout: 10000,
  maxRetries: 3,
};
```

**Step 2: 提交**

---

### Task 4.2: 修复类型断言

**Files:**
- Modify: `api/request-handler.ts:41, 49`

**Step 1: 定义正确类型**

```typescript
// api/types.ts
export interface ProxyRequestOptions {
  method: HttpMethod;
  headers: Headers;
  signal: AbortSignal;
  body?: string;
}
```

**Step 2: 移除 `as any`**

**Step 3: 提交**

---

### Task 4.3: 统一日志格式

**Files:**
- Modify: 多个文件

**Step 1: 定义日志格式**

```typescript
// api/logger.ts
export function log(module: string, message: string, data?: object) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    module,
    message,
    ...data
  }));
}
```

**Step 2: 更新所有日志调用**

**Step 3: 提交**

---

## Notes

### 执行顺序

```
Phase 1 (安全) → Phase 2 (高优) → Phase 3 (架构) → Phase 4 (质量)
```

### 并行任务

以下任务可以并行执行：
- Task 1.1, 1.2, 1.3 (Phase 1 安全修复)
- Task 2.1, 2.2, 2.3 (Phase 2 部分)
- Phase 4 所有任务

### 验证检查点

每个 Phase 完成后：
1. 运行完整测试套件
2. 执行 `npm audit`
3. 手动测试关键路径
4. 检查构建产物
