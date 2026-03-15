/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * API 入口层 - 薄入口层设计
 * 仅负责请求解析、响应格式化和错误处理
 * 业务逻辑委托给核心模块处理
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ProxyService } from "../src/core/proxy-service.js";
import { validateApiKey } from "../src/middleware/auth.js";
import { checkRateLimit, getClientIp } from "../src/middleware/rate-limit.js";
import { validateUrl, validateDnsResolution } from "../src/security.js";
import { AppError, ErrorCode } from "../src/errors/index.js";
import { CORS_CONFIG, isProduction, validateProductionConfig } from "../src/config.js";
import { generateRequestId } from "../src/utils/crypto.js";
import type { ProxyRequest } from "../src/types/index.js";
import { captureWebpage } from "../src/webpage-capture/index.js";
import type { CaptureRequest } from "../src/webpage-capture/types.js";

// 创建代理服务实例（单例）
const proxyService = new ProxyService();

// 生产环境启动时验证配置
if (isProduction()) {
  const configResult = validateProductionConfig();
  if (!configResult.valid) {
    console.error("[Security] Configuration errors:", configResult.errors);
    // 在 Vercel 环境中记录警告，但不阻止启动
    // 实际生产中应该通过 CI/CD 检查
  }
}

/**
 * 发送错误响应
 */
function sendError(res: VercelResponse, error: AppError, requestId?: string): void {
  res.status(error.statusCode).json(error.toJSON(requestId));
}

/**
 * 网页捕获处理函数
 */
async function handleCapture(
  req: VercelRequest,
  res: VercelResponse,
  requestId: string,
  startTime: number
): Promise<void> {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(clientIp, "capture");

    res.setHeader("X-RateLimit-Limit", "30");
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString());
    res.setHeader("X-RateLimit-Reset", rateLimit.resetAt.toString());

    if (!rateLimit.allowed) {
      sendError(
        res,
        new AppError(ErrorCode.RATE_LIMITED, "Rate limit exceeded for capture endpoint", 429),
        requestId
      );
      return;
    }

    validateApiKey(req);

    const { url, options }: CaptureRequest = req.body || {};

    if (!url) {
      sendError(
        res,
        new AppError(ErrorCode.INVALID_URL, "URL is required", 400),
        requestId
      );
      return;
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      sendError(
        res,
        new AppError(ErrorCode.INVALID_URL, urlValidation.error || "Invalid URL", 400),
        requestId
      );
      return;
    }

    try {
      const parsedUrl = new URL(url);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        sendError(
          res,
          new AppError(ErrorCode.INVALID_URL, dnsResult.error || "DNS validation failed", 400),
          requestId
        );
        return;
      }
    } catch (dnsError) {
      console.warn(`[Security] DNS validation failed for ${url}:`, dnsError);
    }

    const result = await captureWebpage(url, options);

    res.setHeader("X-Request-Id", requestId);

    if (result.success) {
      res.status(200).json({
        success: true,
        data: {
          html: result.html,
          title: result.title,
          url: result.url,
          mode: result.mode,
          resources: result.resources,
          capturedAt: result.capturedAt,
          duration: result.duration,
        },
        requestId,
        duration: Date.now() - startTime,
      });
    } else {
      sendError(
        res,
        new AppError(ErrorCode.INTERNAL_ERROR, result.error || "Capture failed", 500),
        requestId
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      sendError(res, error, requestId);
    } else {
      const errorMessage = isProduction()
        ? "Internal server error"
        : (error instanceof Error ? error.message : "Unknown error");

      const appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        errorMessage,
        500
      );
      sendError(res, appError, requestId);
    }
  }
}

/**
 * 设置安全响应头
 */
function setSecurityHeaders(res: VercelResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
}

/**
 * 设置 CORS 响应头（动态白名单）
 */
function setCorsHeaders(res: VercelResponse, origin?: string): void {
  const allowedOrigins = CORS_CONFIG.allowedOrigins;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!isProduction()) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * 主处理函数
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // 设置响应头
  setSecurityHeaders(res);
  const origin = req.headers.origin as string | undefined;
  setCorsHeaders(res, origin);

  // 处理 OPTIONS 预检请求
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const path = req.url?.split("?")[0] || "";

  // 健康检查端点
  if (req.method === "GET" && (path === "/api/health" || path === "/api/ready" || path === "/api")) {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "0.1.2",
      uptime: Math.floor(process.uptime?.() ?? 0),
      requestId,
    });
    return;
  }

  // 网页捕获端点
  if (req.method === "POST" && path === "/api/capture") {
    await handleCapture(req, res, requestId, startTime);
    return;
  }

  // 仅允许 POST /api 用于代理请求
  if (req.method !== "POST" || path !== "/api") {
    sendError(
      res,
      new AppError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed", 405),
      requestId
    );
    return;
  }

  try {
    // 限流检查
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(clientIp);

    // 设置限流响应头
    res.setHeader("X-RateLimit-Limit", "100");
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString());
    res.setHeader("X-RateLimit-Reset", rateLimit.resetAt.toString());

    if (!rateLimit.allowed) {
      sendError(
        res,
        new AppError(ErrorCode.RATE_LIMITED, "Rate limit exceeded", 429),
        requestId
      );
      return;
    }

    // API Key 验证
    validateApiKey(req);

    // 解析请求体
    const { url, method = "GET", headers = {}, body, timeout }: ProxyRequest =
      req.body || {};

    // URL 验证（静态检查）
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      sendError(
        res,
        new AppError(ErrorCode.INVALID_URL, urlValidation.error || "Invalid URL", 400),
        requestId
      );
      return;
    }

    // DNS 重绑定防护（动态检查）
    try {
      const parsedUrl = new URL(url);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        sendError(
          res,
          new AppError(ErrorCode.INVALID_URL, dnsResult.error || "DNS validation failed", 400),
          requestId
        );
        return;
      }
    } catch (dnsError) {
      // DNS 解析失败，记录日志但不阻止请求（降级处理）
      console.warn(`[Security] DNS validation failed for ${url}:`, dnsError);
    }

    // 执行代理请求
    const response = await proxyService.execute({
      url,
      method,
      headers,
      body,
      timeout,
    });

    // 设置请求 ID 响应头
    res.setHeader("X-Request-Id", requestId);

    // 发送成功响应
    res.status(200).json({
      ...response,
      requestId,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    if (error instanceof AppError) {
      sendError(res, error, requestId);
    } else {
      const errorMessage = isProduction()
        ? "Internal server error"
        : (error instanceof Error ? error.message : "Unknown error");

      const appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        errorMessage,
        500
      );
      sendError(res, appError, requestId);
    }
  }
}
