/**
 * Vercel Edge Function - 主入口
 * 处理所有代理请求
 */

// 类型定义
interface RequestBody {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  useCache?: boolean;
}

interface ErrorResponse {
  error: string;
  code: string;
  retryAfter?: number;
}

interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

// 配置
const CONFIG = {
  maxProxyAttempts: 3,
  useFallback: true,
  enableCache: true
};

export const config = {
  runtime: 'edge',
};

/**
 * 主处理函数
 */
export default async function handler(request: Request): Promise<Response> {
  const startTime = Date.now();

  // 1. 获取客户端 IP
  const clientIp = getClientIp(request);
  console.log(`[Main] 请求来自 IP: ${clientIp}`);

  // 2. 检查限流（全局）
  const { checkGlobalRateLimit } = await import('./rate-limiter');
  const globalLimit = checkGlobalRateLimit();
  if (!globalLimit.allowed) {
    console.log(`[Main] 全局限流触发`);
    return createJsonResponse(429, {
      error: 'Rate limit exceeded. Please try again later.',
      code: 'RATE_LIMIT_GLOBAL',
      retryAfter: Math.ceil(globalLimit.resetIn / 1000)
    });
  }

  // 3. 检查限流（IP 级别）
  const { checkIpRateLimit } = await import('./rate-limiter');
  const ipLimit = checkIpRateLimit(clientIp);
  if (!ipLimit.allowed) {
    console.log(`[Main] IP限流触发: ${clientIp}`);
    return createJsonResponse(429, {
      error: 'Rate limit exceeded for your IP.',
      code: 'RATE_LIMIT_IP',
      retryAfter: Math.ceil(ipLimit.resetIn / 1000)
    });
  }

  // 4. 解析请求体
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return createJsonResponse(400, {
      error: 'Invalid JSON body',
      code: 'INVALID_JSON'
    });
  }

  // 5. 验证请求
  if (!body.url) {
    return createJsonResponse(400, {
      error: 'Missing required field: url',
      code: 'MISSING_URL'
    });
  }

  // 验证 URL
  try {
    new URL(body.url);
  } catch {
    return createJsonResponse(400, {
      error: 'Invalid URL format',
      code: 'INVALID_URL'
    });
  }

  // 6. 检查缓存（如果启用）
  if (CONFIG.enableCache && body.useCache !== false) {
    const { getCachedResponse } = await import('./cache');
    const cachedResponse = getCachedResponse(body.url, body.method || 'GET');
    if (cachedResponse) {
      console.log(`[Main] 返回缓存结果`);
      return createJsonResponse(200, {
        ...cachedResponse,
        cached: true,
        responseTime: Date.now() - startTime
      });
    }
  }

  // 7. 发送代理请求
  const { sendProxyRequest } = await import('./request-handler');
  const result = await sendProxyRequest(
    {
      url: body.url,
      method: body.method || 'GET',
      headers: body.headers || {},
      body: body.body
    },
    {
      maxProxyAttempts: CONFIG.maxProxyAttempts,
      useFallback: CONFIG.useFallback
    }
  );

  // 8. 缓存成功响应
  if (CONFIG.enableCache && body.useCache !== false && result.success) {
    const { cacheResponse } = await import('./cache');
    cacheResponse(body.url, body.method || 'GET', result);
  }

  // 9. 返回结果
  const statusCode = result.success ? 200 : 502;

  return createJsonResponse(statusCode, {
    success: result.success,
    data: result.data,
    status: result.status,
    usedProxy: result.usedProxy,
    fallbackUsed: result.fallbackUsed,
    error: result.error,
    responseTime: Date.now() - startTime,
    rateLimit: {
      global: globalLimit,
      ip: ipLimit
    }
  });
}

/**
 * 获取客户端 IP
 */
function getClientIp(request: Request): string {
  // Vercel Edge 会设置这些 header
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (forwardedFor) {
    // x-forwarded-for 可能包含多个 IP，取第一个
    return forwardedFor.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

/**
 * 创建 JSON 响应
 */
function createJsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache'
    }
  });
}
