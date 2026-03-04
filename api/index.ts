/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Vercel Edge Function - 主入口
 * 使用中间件管道处理代理请求
 */

import { SECURITY_CONFIG, API_KEY_CONFIG, FEATURES, validateProductionConfig } from "./config.js";
import { isValidPublicIp } from "./security.js";
import { getCachedResponse, cacheResponse } from "./cache.js";
import { sendRequestWithMultipleProxies } from "./request-handler.js";
import type { ProxyRequest } from "./request-handler.js";
import { initDatabase } from "./database/connection.js";
import { logger } from "./logger.js";
import {
  compose,
  corsMiddleware,
  apiKeyMiddleware,
  rateLimitMiddleware,
  bodyParserMiddleware,
  urlValidationMiddleware,
  type MiddlewareContext,
  DEFAULT_CORS_CONFIG,
} from "./middleware/index.js";

export const config = {
  runtime: "nodejs",
};

/**
 * 获取请求头值（兼容 Headers 对象和普通对象）
 */
function getHeaderValue(headers: Headers | Record<string, string>, name: string): string | null {
  if (headers && typeof headers.get === "function") {
    return headers.get(name);
  } else if (headers && (headers as Record<string, string>)[name]) {
    return (headers as Record<string, string>)[name];
  }
  return null;
}

/**
 * 获取客户端 IP
 */
function getClientIp(request: Request): string {
  // 优先使用 cf-connecting-ip（Cloudflare）
  const cfIp = getHeaderValue(request.headers, "cf-connecting-ip");
  if (cfIp && isValidPublicIp(cfIp)) {
    return cfIp;
  }

  // 其次使用 x-forwarded-for
  const forwardedFor = getHeaderValue(request.headers, "x-forwarded-for");
  if (forwardedFor) {
    const clientIp = forwardedFor.split(",")[0].trim();
    if (isValidPublicIp(clientIp)) {
      return clientIp;
    }
  }

  // 最后使用 x-real-ip
  const realIp = getHeaderValue(request.headers, "x-real-ip");
  if (realIp && isValidPublicIp(realIp)) {
    return realIp;
  }

  return "unknown";
}

/**
 * 生产配置验证中间件
 */
async function productionConfigMiddleware(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
  const configValidation = validateProductionConfig();
  if (!configValidation.valid) {
    logger.main.error("Invalid production config", { errors: configValidation.errors });
    context.response = new Response(JSON.stringify({
      error: "Server misconfigured",
      code: "CONFIG_ERROR",
      details: configValidation.errors,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    return;
  }
  await next();
}

/**
 * 数据库初始化中间件
 */
async function databaseInitMiddleware(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
  await initDatabase();
  await next();
}

/**
 * 日志中间件
 */
async function loggingMiddleware(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
  logger.main.verbose("Request received", { clientIp: context.clientIp });
  const startTime = Date.now();
  await next();
  const duration = Date.now() - startTime;
  logger.main.verbose("Request completed", { duration: `${duration}ms` });
}

/**
 * 缓存检查中间件
 */
async function cacheMiddleware(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
  if (!context.body) {
    await next();
    return;
  }

  const useCache = FEATURES.enableCache && context.body.useCache !== false;
  if (useCache) {
    const cached = await getCachedResponse(context.body.url, context.body.method || "GET");
    if (cached) {
      logger.main.verbose("Returning cached response");
      context.response = createJsonResponse(200, cached, context.request);
      return;
    }
  }

  context.state.useCache = useCache;
  await next();
}

/**
 * 代理处理中间件
 */
async function proxyHandlerMiddleware(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
  if (!context.body) {
    context.response = createJsonResponse(500, {
      error: "Internal server error",
      code: "NO_BODY",
    }, context.request);
    return;
  }

  try {
    const proxyRequest: ProxyRequest = {
      url: context.body.url,
      method: context.body.method || "GET",
      headers: context.body.headers || {},
      body: context.body.body,
    };

    const response = await sendRequestWithMultipleProxies(
      proxyRequest,
      3, // maxProxyAttempts
      FEATURES.enableFallback,
    );

    // 缓存成功的响应
    if (response.success && context.state.useCache) {
      await cacheResponse(context.body.url, context.body.method || "GET", response);
    }

    context.response = createJsonResponse(200, response, context.request);
  } catch (error) {
    logger.main.error("Request handling failed", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    context.response = createJsonResponse(500, {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    }, context.request);
  }

  await next();
}

/**
 * 创建 JSON 响应
 */
function createJsonResponse(
  status: number,
  data: unknown,
  request?: Request,
): Response {
  const origin = request ? getHeaderValue(request.headers, "origin") : null;
  const corsOrigin = DEFAULT_CORS_CONFIG.allowedOrigins.includes(origin || "") ? origin || "" : "";

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * 组合中间件管道
 */
const pipeline = compose(
  // 1. 生产环境配置验证
  productionConfigMiddleware,
  // 2. 数据库初始化
  databaseInitMiddleware,
  // 3. 日志记录
  loggingMiddleware,
  // 4. API Key 验证
  apiKeyMiddleware(API_KEY_CONFIG),
  // 5. 限流检查
  rateLimitMiddleware({
    enabled: FEATURES.enableRateLimit,
    enableGlobalLimit: true,
    enableIpLimit: true,
  }),
  // 6. CORS 处理
  corsMiddleware(DEFAULT_CORS_CONFIG),
  // 7. 请求体解析
  bodyParserMiddleware({
    maxSize: SECURITY_CONFIG.maxRequestSize,
    allowedMethods: ["POST"],
  }),
  // 8. URL 验证
  urlValidationMiddleware(),
  // 9. 缓存检查
  cacheMiddleware,
  // 10. 代理处理
  proxyHandlerMiddleware,
);

/**
 * 主处理函数
 */
export default async function handler(request: Request): Promise<Response> {
  const context: MiddlewareContext = {
    request,
    clientIp: getClientIp(request),
    startTime: Date.now(),
    state: {},
  };

  await pipeline(context);

  // 如果没有设置响应，返回默认错误
  if (!context.response) {
    return createJsonResponse(500, {
      error: "Internal server error",
      code: "NO_RESPONSE",
    }, request);
  }

  return context.response;
}