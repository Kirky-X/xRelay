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
import { validateUrl } from "../src/security/url-validator.js";
import { AppError, ErrorCode } from "../src/errors/index.js";
import type { ProxyRequest } from "../src/types/index.js";

// 创建代理服务实例（单例）
const proxyService = new ProxyService();

/**
 * 发送错误响应
 */
function sendError(res: VercelResponse, error: AppError, requestId?: string): void {
  res.status(error.statusCode).json(error.toJSON(requestId));
}

/**
 * 设置安全响应头
 */
function setSecurityHeaders(res: VercelResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

/**
 * 设置 CORS 响应头
 */
function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

/**
 * 生成请求 ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  setCorsHeaders(res);

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
      version: "1.0.0",
      uptime: Math.floor(process.uptime()),
      requestId,
    });
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

    // URL 验证
    validateUrl(url);

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
      const appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : "Unknown error",
        500
      );
      sendError(res, appError, requestId);
    }
  }
}
