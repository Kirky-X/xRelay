/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Vercel Edge Function - 主入口
 * 处理所有代理请求
 */

import { SECURITY_CONFIG } from "./config";
import { validateUrl, isValidPublicIp } from "./security";

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
  runtime: "edge",
};

/**
 * 主处理函数
 */
export default async function handler(request: Request): Promise<Response> {
  const startTime = Date.now();

  // 1. 获取客户端 IP
  const clientIp = getClientIp(request);
  if (SECURITY_CONFIG.enableVerboseLogging) {
    console.log(`[Main] 请求来自 IP: ${clientIp}`);
  }

  // 2. 检查限流（全局）
  const { checkGlobalRateLimit } = await import("./rate-limiter");
  const globalLimit = checkGlobalRateLimit();
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

  // 3. 检查限流（IP 级别）
  const { checkIpRateLimit } = await import("./rate-limiter");
  const ipLimit = checkIpRateLimit(clientIp);
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

  // 4. 解析请求体
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
  } catch {
    return createJsonResponse(
      400,
      {
        error: "Invalid JSON body",
        code: "INVALID_JSON",
      },
      request,
    );
  }

  // 5. 验证请求
  if (!body.url) {
    return createJsonResponse(
      400,
      {
        error: "Missing required field: url",
        code: "MISSING_URL",
      },
      request,
    );
  }

  // 验证 URL 格式
  try {
    new URL(body.url);
  } catch {
    return createJsonResponse(
      400,
      {
        error: "Invalid URL format",
        code: "INVALID_URL",
      },
      request,
    );
  }

  // 验证 URL 安全性（防止 SSRF）
  const urlValidation = validateUrl(body.url);
  if (!urlValidation.valid) {
    if (SECURITY_CONFIG.enableVerboseLogging) {
      console.log(`[Main] URL 安全检查失败: ${urlValidation.error}`);
    }
    return createJsonResponse(
      403,
      {
        error: "URL not allowed for security reasons",
        code: "URL_NOT_ALLOWED",
        reason: urlValidation.error,
      },
      request,
    );
  }

  // 6. 检查缓存（如果启用）
  if (CONFIG.enableCache && body.useCache !== false) {
    const { getCachedResponse } = await import("./cache");
    const cachedResponse = getCachedResponse(body.url, body.method || "GET");
    if (cachedResponse) {
      if (SECURITY_CONFIG.enableVerboseLogging) {
        console.log(`[Main] 返回缓存结果`);
      }
      return createJsonResponse(
        200,
        {
          ...cachedResponse,
          cached: true,
          responseTime: Date.now() - startTime,
        },
        request,
      );
    }
  }

  // 7. 发送代理请求
  const { sendProxyRequest } = await import("./request-handler");
  if (SECURITY_CONFIG.enableVerboseLogging) {
    console.log(
      `[Main] 发送代理请求: ${body.method || "GET"} ${new URL(body.url).hostname}`,
    );
  }
  const result = await sendProxyRequest(
    {
      url: body.url,
      method: body.method || "GET",
      headers: body.headers || {},
      body: body.body,
    },
    {
      maxProxyAttempts: CONFIG.maxProxyAttempts,
      useFallback: CONFIG.useFallback,
    },
  );

  // 8. 缓存成功响应
  if (CONFIG.enableCache && body.useCache !== false && result.success) {
    const { cacheResponse } = await import("./cache");
    cacheResponse(body.url, body.method || "GET", result);
  }

  // 9. 返回结果
  const statusCode = result.success ? 200 : 502;

  return createJsonResponse(
    statusCode,
    {
      success: result.success,
      data: result.data,
      status: result.status,
      usedProxy: result.usedProxy,
      fallbackUsed: result.fallbackUsed,
      error: result.error,
      responseTime: Date.now() - startTime,
      rateLimit: {
        global: globalLimit,
        ip: ipLimit,
      },
    },
    request,
  );
}

/**
 * 获取客户端 IP（改进版，更可靠）
 */
function getClientIp(request: Request): string {
  // Vercel Edge 提供的可靠 IP
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const vercelIp = request.headers.get("x-vercel-forwarded-for");

  // 优先使用 Cloudflare 或 Vercel 提供的真实 IP
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  if (vercelIp) {
    return vercelIp;
  }

  // 备用方案：x-forwarded-for（但需要验证）
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for 可能包含多个 IP，格式为：client, proxy1, proxy2
    // 取第一个（客户端 IP）
    const clientIp = forwardedFor.split(",")[0].trim();

    // 验证是否为有效的公网 IP
    if (isValidPublicIp(clientIp)) {
      return clientIp;
    }
  }

  // 最后的备用方案
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
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-cache",
    },
  });
}
