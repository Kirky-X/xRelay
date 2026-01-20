/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Vercel Edge Function - 主入口
 * 处理所有代理请求
 */

import { SECURITY_CONFIG, API_KEY_CONFIG } from "./config";
import { validateUrl, isValidPublicIp } from "./security";
import { checkGlobalRateLimit, checkIpRateLimit } from "./rate-limiter";
import { getCachedResponse, cacheResponse } from "./cache";
import { sendRequestWithMultipleProxies } from "./request-handler";
import type { ProxyRequest } from "./request-handler";

// 类型定义
interface RequestBody {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  useCache?: boolean;
}
const CONFIG = {
  maxProxyAttempts: 3,
  useFallback: true,
  enableCache: true,
};

export const config = {
  runtime: "nodejs18",
};

/**
 * 验证 API Key
 */
function validateApiKey(request: Request): boolean {
  // 如果未启用 API Key 验证，直接通过
  if (!API_KEY_CONFIG.enabled) {
    return true;
  }

  // 如果没有配置任何 API Key，直接通过（避免误拦截）
  if (API_KEY_CONFIG.keys.length === 0) {
    return true;
  }

  // 获取请求中的 API Key
  const apiKey = request.headers.get(API_KEY_CONFIG.headerName);
  
  if (!apiKey) {
    return false;
  }

  // 检查 API Key 是否有效
  return API_KEY_CONFIG.keys.includes(apiKey);
}

/**
 * 主处理函数
 */
export default async function handler(request: Request): Promise<Response> {
  const startTime = Date.now();

  // 1. 验证 API Key
  if (!validateApiKey(request)) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] API Key 验证失败`);
    }
    return createJsonResponse(
      401,
      {
        error: "Unauthorized",
        code: "INVALID_API_KEY",
      },
      request,
    );
  }

  // 2. 获取客户端 IP
  const clientIp = getClientIp(request);
  if (SECURITY_CONFIG.enableVerboseLogging) {
    console.log(`[Main] 请求来自 IP: ${clientIp}`);
  }

  // 3. 检查限流（全局）
  const globalLimit = await checkGlobalRateLimit();
  if (!globalLimit.allowed) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] 全局限流触发`);
    }
    return createJsonResponse(
      429,
      {
        error: "Rate limit exceeded. Please try again later.",
        code: "RATE_LIMIT_GLOBAL",
        retryAfter: Math.ceil(globalLimit.resetIn / 1000),
      },
      request,
    );
  }

  // 4. 检查限流（IP 级别）
  const ipLimit = await checkIpRateLimit(clientIp);
  if (!ipLimit.allowed) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] IP限流触发`);
    }
    return createJsonResponse(
      429,
      {
        error: "Rate limit exceeded for your IP.",
        code: "RATE_LIMIT_IP",
        retryAfter: Math.ceil(ipLimit.resetIn / 1000),
      },
      request,
    );
  }

  // 5. 处理 OPTIONS 请求（CORS 预检）
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    const allowedOrigins = [
      "https://vercel-proxy-shield.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ];
    const corsOrigin = allowedOrigins.includes(origin || "") ? origin || "" : "";

    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-api-key",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 6. 只允许 POST 请求
  if (request.method !== "POST") {
    return createJsonResponse(
      405,
      {
        error: "Method not allowed",
        code: "METHOD_NOT_ALLOWED",
        allowedMethods: ["POST"],
      },
      request,
    );
  }

  // 7. 解析请求体
  let body: RequestBody;
  try {
    body = await request.json();

    // 检查请求体大小
    const bodySize = JSON.stringify(body).length;
    if (bodySize > SECURITY_CONFIG.maxRequestSize) {
      if (SECURITY_CONFIG.enableVerboseLogging) {
        console.log(`[Main] 请求体过大: ${bodySize} bytes`);
      }
      return createJsonResponse(
        413,
        {
          error: "Request body too large",
          code: "REQUEST_TOO_LARGE",
          maxSize: SECURITY_CONFIG.maxRequestSize,
        },
        request,
      );
    }
  } catch (error) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] 解析请求体失败: ${error}`);
    }
    return createJsonResponse(
      400,
      {
        error: "Invalid JSON body",
        code: "INVALID_JSON",
      },
      request,
    );
  }

  // 8. 验证必需字段
  if (!body.url) {
    return createJsonResponse(
      400,
      {
        error: "URL is required",
        code: "MISSING_URL",
      },
      request,
    );
  }

  // 9. 验证 URL
  const urlValidation = validateUrl(body.url);
  if (!urlValidation.valid) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] URL验证失败: ${urlValidation.error}`);
    }
    return createJsonResponse(
      400,
      {
        error: "Invalid URL",
        code: "INVALID_URL",
        reason: urlValidation.error,
      },
      request,
    );
  }

  // 10. 检查缓存
  let useCache = body.useCache !== false; // 默认启用缓存
  if (useCache) {
    const cached = await getCachedResponse(body.url, body.method || "GET");
    if (cached) {
      if (SECURITY_CONFIG.enableVerboseLogging) {
        console.log(`[Main] 返回缓存响应`);
      }
      return createJsonResponse(200, cached, request);
    }
  }

  // 11. 处理代理请求
  try {
    const proxyRequest: ProxyRequest = {
      url: body.url,
      method: body.method || "GET",
      headers: body.headers || {},
      body: body.body,
    };

    const response = await sendRequestWithMultipleProxies(proxyRequest, CONFIG.maxProxyAttempts);

    // 缓存成功的响应
    if (response.success && useCache) {
      await cacheResponse(body.url, body.method || "GET", response);
    }

    const duration = Date.now() - startTime;
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] 请求完成，耗时: ${duration}ms`);
    }

    return createJsonResponse(200, response, request);
  } catch (error) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] 处理请求失败: ${error}`);
    }
    return createJsonResponse(
      500,
      {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      },
      request,
    );
  }
}

/**
 * 获取客户端 IP
 */
function getClientIp(request: Request): string {
  // 优先使用 cf-connecting-ip（Cloudflare）
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && isValidPublicIp(cfIp)) {
    return cfIp;
  }

  // 其次使用 x-forwarded-for
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const clientIp = forwardedFor.split(",")[0].trim();
    if (isValidPublicIp(clientIp)) {
      return clientIp;
    }
  }

  // 最后使用 x-real-ip
  const realIp = request.headers.get("x-real-ip");
  if (realIp && isValidPublicIp(realIp)) {
    return realIp;
  }

  return "unknown";
}

/**
 * 创建 JSON 响应
 */
function createJsonResponse(
  status: number,
  data: unknown,
  request?: Request,
): Response {
  const origin = request?.headers.get("origin");
  const allowedOrigins = [
    "https://vercel-proxy-shield.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ];

  const corsOrigin = allowedOrigins.includes(origin || "") ? origin || "" : "";

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
