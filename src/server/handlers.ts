/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 共享核心请求处理器
 *
 * 抽取自 standalone.ts (Bun) 与 api/index.ts (Vercel) 的公共业务逻辑：
 * 路由分发、限流、API Key 验证、URL/DNS 验证、代理请求执行、网页捕获调用。
 *
 * 设计原则：
 * - 纯函数式接口：输入 RequestContext，输出 ResponseSpec，不做 IO 操作
 * - 跨运行时中立：不依赖 VercelRequest / Bun.Request 等运行时特定 API
 * - 入口层适配：调用方负责构造 RequestContext 与消费 ResponseSpec
 */

import { ProxyService } from "../core/proxy-service.js";
import { validateApiKeyFromHeaders } from "../middleware/auth.js";
import { checkRateLimit } from "../middleware/rate-limit.js";
import { validateUrl, validateDnsResolution } from "../security.js";
import { AppError, ErrorCode } from "../errors/index.js";
import {
  APP_VERSION,
  CORS_CONFIG,
  FEATURES,
  isProduction,
  validateProductionConfig,
} from "../config.js";
import { logger } from "../logger.js";
import type { ProxyRequest } from "../types/index.js";
import { captureWebpage } from "../webpage-capture/index.js";
import type {
  CaptureRequest,
  CaptureOptions,
} from "../webpage-capture/types.js";

/**
 * 请求上下文 - 跨运行时中立
 */
export interface RequestContext {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
  clientIp: string;
  requestId: string;
  startTime: number;
}

/**
 * 响应规格 - 跨运行时中立
 */
export interface ResponseSpec {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * 单例 ProxyService（首次 import 时实例化）
 *
 * 注意：模块级单例在测试中可通过 vi.mock("../core/proxy-service.js") 替换
 */
const proxyService = new ProxyService();

/**
 * 生产环境启动时验证配置（仅一次性副作用）
 */
if (isProduction()) {
  const configResult = validateProductionConfig();
  if (!configResult.valid) {
    logger.error(
      "Configuration errors: " + configResult.errors.join(", "),
      undefined,
      { module: "Server" },
    );
  }
}

/**
 * 设置安全响应头
 *
 * 注意：CSP 使用 default-src 'none' 严格策略，因为本服务仅返回 JSON API，
 * 不加载任何外部资源。frame-ancestors 'none' 防止点击劫持。
 * Cache-Control: no-store 防止敏感响应（含代理数据）被中间层缓存。
 */
export function setSecurityHeaders(headers: Record<string, string>): void {
  headers["X-Content-Type-Options"] = "nosniff";
  headers["X-Frame-Options"] = "DENY";
  headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  headers["X-XSS-Protection"] = "1; mode=block";
  headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";
  // 严格 CSP：JSON API 不需要加载任何外部资源
  headers["Content-Security-Policy"] =
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
  // 防止响应被缓存（代理响应可能含敏感数据）
  headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
  headers["Pragma"] = "no-cache";
  headers["Expires"] = "0";
}

/**
 * 设置 CORS 响应头（动态白名单）
 *
 * 安全策略：使用显式白名单，不使用通配符 "*"。
 * 即使在开发模式下，也仅允许配置的本地开发端口，
 * 避免任意源在共享开发环境中调用受 API Key 保护的端点。
 */
export function setCorsHeaders(
  headers: Record<string, string>,
  origin?: string,
): void {
  if (origin && CORS_CONFIG.allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  // 不匹配白名单时不设置 Access-Control-Allow-Origin

  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, x-api-key";
  headers["Access-Control-Max-Age"] = "86400";
}

/**
 * 健康检查端点
 */
function handleHealthCheck(
  headers: Record<string, string>,
  ctx: RequestContext,
): ResponseSpec {
  headers["Content-Type"] = "application/json";
  return {
    status: 200,
    headers,
    body: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      uptime: Math.floor(process.uptime?.() ?? 0),
      requestId: ctx.requestId,
    },
  };
}

/**
 * 处理网页捕获请求
 *
 * 业务流程：限流 → API Key → URL 验证 → DNS 验证 → captureWebpage
 */
async function handleCapture(
  ctx: RequestContext,
  headers: Record<string, string>,
): Promise<ResponseSpec> {
  try {
    const rateLimit = checkRateLimit(ctx.clientIp, "capture");

    headers["X-RateLimit-Limit"] = "30";
    headers["X-RateLimit-Remaining"] = rateLimit.remaining.toString();
    headers["X-RateLimit-Reset"] = rateLimit.resetAt.toString();

    if (!rateLimit.allowed) {
      headers["Content-Type"] = "application/json";
      return {
        status: 429,
        headers,
        body: new AppError(
          ErrorCode.RATE_LIMITED,
          "Rate limit exceeded for capture endpoint",
          429,
        ).toJSON(ctx.requestId),
      };
    }

    if (FEATURES.enableApiKey) {
      validateApiKeyFromHeaders(ctx.headers);
    }

    const body = ctx.body as Partial<CaptureRequest> | null | undefined;
    const { url, options } = body ?? {};

    if (!url) {
      headers["Content-Type"] = "application/json";
      return {
        status: 400,
        headers,
        body: new AppError(
          ErrorCode.INVALID_URL,
          "URL is required",
          400,
        ).toJSON(ctx.requestId),
      };
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      headers["Content-Type"] = "application/json";
      return {
        status: 400,
        headers,
        body: new AppError(
          ErrorCode.INVALID_URL,
          urlValidation.error || "Invalid URL",
          400,
        ).toJSON(ctx.requestId),
      };
    }

    let captureOptions: CaptureOptions | undefined = options;

    try {
      const parsedUrl = new URL(url);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        // DNS 验证失败：fail-closed，拒绝请求
        headers["Content-Type"] = "application/json";
        return {
          status: 400,
          headers,
          body: new AppError(
            ErrorCode.INVALID_URL,
            dnsResult.error || "DNS validation failed",
            400,
          ).toJSON(ctx.requestId),
        };
      }

      // SSRF TOCTOU 防护：将已验证的 IP 传入 capture 层，
      // 避免 capture 时第二次 DNS 解析返回内网地址
      if (dnsResult.ips && dnsResult.ips.length > 0) {
        captureOptions = { ...options, resolvedIp: dnsResult.ips[0] };
      }
    } catch (dnsError) {
      // DNS 验证异常：fail-closed，防止攻击者通过触发 DNS 错误绕过 SSRF 防护
      logger.error(
        `DNS validation error for ${typeof url === "string" ? url : "invalid-url"}`,
        dnsError instanceof Error ? dnsError : undefined,
        { module: "Capture" },
      );
      headers["Content-Type"] = "application/json";
      return {
        status: 400,
        headers,
        body: new AppError(
          ErrorCode.INVALID_URL,
          "DNS validation failed",
          400,
        ).toJSON(ctx.requestId),
      };
    }

    const result = await captureWebpage(url, captureOptions);

    headers["X-Request-Id"] = ctx.requestId;
    headers["Content-Type"] = "application/json";

    if (result.success) {
      return {
        status: 200,
        headers,
        body: {
          success: true,
          data: {
            html: result.html,
            title: result.title,
            url: result.url,
            mode: result.mode,
            degraded: result.degraded,
            resources: result.resources,
            article: result.article,
            capturedAt: result.capturedAt,
            duration: result.duration,
          },
          requestId: ctx.requestId,
          duration: Date.now() - ctx.startTime,
        },
      };
    }
    return {
      status: 500,
      headers,
      body: new AppError(
        ErrorCode.INTERNAL_ERROR,
        result.error || "Capture failed",
        500,
      ).toJSON(ctx.requestId),
    };
  } catch (error) {
    headers["Content-Type"] = "application/json";

    if (error instanceof AppError) {
      return {
        status: error.statusCode,
        headers,
        body: error.toJSON(ctx.requestId),
      };
    }

    const errorMessage = isProduction()
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : "Unknown error";

    return {
      status: 500,
      headers,
      body: new AppError(ErrorCode.INTERNAL_ERROR, errorMessage, 500).toJSON(
        ctx.requestId,
      ),
    };
  }
}

/**
 * 处理代理请求
 *
 * 业务流程：限流 → API Key → URL 验证 → DNS 验证 → ProxyService.execute
 */
async function handleProxy(
  ctx: RequestContext,
  headers: Record<string, string>,
): Promise<ResponseSpec> {
  try {
    const rateLimit = checkRateLimit(ctx.clientIp);

    headers["X-RateLimit-Limit"] = "100";
    headers["X-RateLimit-Remaining"] = rateLimit.remaining.toString();
    headers["X-RateLimit-Reset"] = rateLimit.resetAt.toString();

    if (!rateLimit.allowed) {
      headers["Content-Type"] = "application/json";
      return {
        status: 429,
        headers,
        body: new AppError(
          ErrorCode.RATE_LIMITED,
          "Rate limit exceeded",
          429,
        ).toJSON(ctx.requestId),
      };
    }

    if (FEATURES.enableApiKey) {
      validateApiKeyFromHeaders(ctx.headers);
    }

    const body = ctx.body as Partial<ProxyRequest> | null | undefined;
    const {
      url: targetUrl,
      method = "GET",
      headers: reqHeaders = {},
      body: reqBody,
      timeout,
    }: ProxyRequest = {
      url: body?.url ?? "",
      method: body?.method,
      headers: body?.headers,
      body: body?.body,
      timeout: body?.timeout,
    };

    // 由 validateDnsResolution 填充（SSRF TOCTOU 防护：pinned DNS）
    let resolvedIp: string | undefined;

    const urlValidation = validateUrl(targetUrl);
    if (!urlValidation.valid) {
      headers["Content-Type"] = "application/json";
      return {
        status: 400,
        headers,
        body: new AppError(
          ErrorCode.INVALID_URL,
          urlValidation.error || "Invalid URL",
          400,
        ).toJSON(ctx.requestId),
      };
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        // DNS 验证失败：fail-closed，拒绝请求
        headers["Content-Type"] = "application/json";
        return {
          status: 400,
          headers,
          body: new AppError(
            ErrorCode.INVALID_URL,
            dnsResult.error || "DNS validation failed",
            400,
          ).toJSON(ctx.requestId),
        };
      }

      // SSRF TOCTOU 防护：将已验证的 IP 传入 request 对象，
      // 直连 fallback 路径会通过 pinned DNS 固定到该 IP
      resolvedIp =
        dnsResult.ips && dnsResult.ips.length > 0
          ? dnsResult.ips[0]
          : undefined;
    } catch (dnsError) {
      // DNS 验证异常：fail-closed，防止攻击者通过触发 DNS 错误绕过 SSRF 防护
      logger.error(
        `DNS validation error for ${typeof targetUrl === "string" ? targetUrl : "invalid-url"}`,
        dnsError instanceof Error ? dnsError : undefined,
        { module: "Proxy" },
      );
      headers["Content-Type"] = "application/json";
      return {
        status: 400,
        headers,
        body: new AppError(
          ErrorCode.INVALID_URL,
          "DNS validation failed",
          400,
        ).toJSON(ctx.requestId),
      };
    }

    const response = await proxyService.execute({
      url: targetUrl,
      method,
      headers: reqHeaders,
      body: reqBody,
      timeout,
      resolvedIp,
    });

    headers["X-Request-Id"] = ctx.requestId;
    headers["Content-Type"] = "application/json";

    return {
      status: 200,
      headers,
      body: {
        ...response,
        requestId: ctx.requestId,
        duration: Date.now() - ctx.startTime,
      },
    };
  } catch (error) {
    headers["Content-Type"] = "application/json";

    if (error instanceof AppError) {
      return {
        status: error.statusCode,
        headers,
        body: error.toJSON(ctx.requestId),
      };
    }

    const errorMessage = isProduction()
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : "Unknown error";

    return {
      status: 500,
      headers,
      body: new AppError(ErrorCode.INTERNAL_ERROR, errorMessage, 500).toJSON(
        ctx.requestId,
      ),
    };
  }
}

/**
 * 统一请求分发器
 *
 * 路由规则：
 * - OPTIONS * → 204 No Content（CORS 预检）
 * - GET /api, /api/health, /api/ready → 200 healthy
 * - POST /api/capture → handleCapture
 * - POST /api → handleProxy
 * - 其他 → 405 Method Not Allowed
 *
 * @param ctx 请求上下文（运行时中立）
 * @returns 响应规格（运行时中立）
 */
export async function dispatchRequest(
  ctx: RequestContext,
): Promise<ResponseSpec> {
  const headers: Record<string, string> = {};
  setSecurityHeaders(headers);
  setCorsHeaders(headers, ctx.headers.get("origin") || undefined);

  if (ctx.method === "OPTIONS") {
    return { status: 204, headers, body: null };
  }

  if (
    ctx.method === "GET" &&
    (ctx.path === "/api/health" ||
      ctx.path === "/api/ready" ||
      ctx.path === "/api")
  ) {
    return handleHealthCheck(headers, ctx);
  }

  if (ctx.method === "POST" && ctx.path === "/api/capture") {
    return handleCapture(ctx, headers);
  }

  if (ctx.method !== "POST" || ctx.path !== "/api") {
    headers["Content-Type"] = "application/json";
    return {
      status: 405,
      headers,
      body: new AppError(
        ErrorCode.METHOD_NOT_ALLOWED,
        "Method not allowed",
        405,
      ).toJSON(ctx.requestId),
    };
  }

  return handleProxy(ctx, headers);
}
