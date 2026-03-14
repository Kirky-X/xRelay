/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 独立服务器入口 - 用于 Bun 编译成二进制
 * 不依赖 Vercel Edge Runtime，使用 Bun 原生 HTTP 服务器
 */

import { ProxyService } from "./core/proxy-service.js";
import { validateApiKeyFromRequest } from "./middleware/auth.js";
import { checkRateLimit, getClientIpFromRequest } from "./middleware/rate-limit.js";
import { validateUrl, validateDnsResolution } from "./security.js";
import { AppError, ErrorCode } from "./errors/index.js";
import { CORS_CONFIG, isProduction, validateProductionConfig, FEATURES } from "./config.js";
import { generateRequestId } from "./utils/crypto.js";
import { logger } from "./logger.js";
import type { ProxyRequest } from "./types/index.js";
import { captureWebpage } from "./webpage-capture/index.js";
import type { CaptureRequest } from "./webpage-capture/types.js";

const proxyService = new ProxyService();

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

if (isProduction()) {
  const configResult = validateProductionConfig();
  if (!configResult.valid) {
    logger.error("Configuration errors: " + configResult.errors.join(", "));
  }
}

function setSecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-XSS-Protection", "1; mode=block");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
}

function setCorsHeaders(headers: Headers, origin?: string): void {
  const allowedOrigins = CORS_CONFIG.allowedOrigins;

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else if (!isProduction()) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  headers.set("Access-Control-Max-Age", "86400");
}

function jsonError(error: AppError, requestId?: string): object {
  return error.toJSON(requestId);
}

async function handleCapture(
  request: Request,
  requestId: string,
  startTime: number,
  headers: Headers
): Promise<Response> {
  try {
    const clientIp = getClientIpFromRequest(request);
    const rateLimit = checkRateLimit(clientIp, "capture");

    headers.set("X-RateLimit-Limit", "30");
    headers.set("X-RateLimit-Remaining", rateLimit.remaining.toString());
    headers.set("X-RateLimit-Reset", rateLimit.resetAt.toString());

    if (!rateLimit.allowed) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.RATE_LIMITED, "Rate limit exceeded for capture endpoint", 429),
          requestId
        )),
        { status: 429, headers }
      );
    }

    if (FEATURES.enableApiKey) {
      validateApiKeyFromRequest(request);
    }

    let body: CaptureRequest;
    try {
      body = await request.json();
    } catch {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INVALID_REQUEST, "Invalid JSON body", 400),
          requestId
        )),
        { status: 400, headers }
      );
    }

    const { url, options }: CaptureRequest = body;

    if (!url) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INVALID_URL, "URL is required", 400),
          requestId
        )),
        { status: 400, headers }
      );
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INVALID_URL, urlValidation.error || "Invalid URL", 400),
          requestId
        )),
        { status: 400, headers }
      );
    }

    try {
      const parsedUrl = new URL(url);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        logger.warn(`DNS validation failed for ${url}: ${dnsResult.error}`);
      }
    } catch (dnsError) {
      logger.warn(`DNS validation error for ${url}: ${dnsError}`);
    }

    const result = await captureWebpage(url, options);

    headers.set("X-Request-Id", requestId);
    headers.set("Content-Type", "application/json");

    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            html: result.html,
            title: result.title,
            url: result.url,
            mode: result.mode,
            resources: result.resources,
            article: result.article,
            capturedAt: result.capturedAt,
            duration: result.duration,
          },
          requestId,
          duration: Date.now() - startTime,
        }),
        { status: 200, headers }
      );
    } else {
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INTERNAL_ERROR, result.error || "Capture failed", 500),
          requestId
        )),
        { status: 500, headers }
      );
    }
  } catch (error) {
    headers.set("Content-Type", "application/json");

    if (error instanceof AppError) {
      return new Response(
        JSON.stringify(jsonError(error, requestId)),
        { status: error.statusCode, headers }
      );
    }

    const errorMessage = isProduction()
      ? "Internal server error"
      : (error instanceof Error ? error.message : "Unknown error");

    const appError = new AppError(ErrorCode.INTERNAL_ERROR, errorMessage, 500);
    return new Response(
      JSON.stringify(jsonError(appError, requestId)),
      { status: 500, headers }
    );
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(request.url);
  const path = url.pathname;

  const headers = new Headers();
  setSecurityHeaders(headers);
  const origin = request.headers.get("origin") || undefined;
  setCorsHeaders(headers, origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" && (path === "/api/health" || path === "/api/ready" || path === "/api")) {
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        uptime: Math.floor(process.uptime?.() ?? 0),
        requestId,
      }),
      { status: 200, headers }
    );
  }

  if (request.method === "POST" && path === "/api/capture") {
    return handleCapture(request, requestId, startTime, headers);
  }

  if (request.method !== "POST" || path !== "/api") {
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify(jsonError(
        new AppError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed", 405),
        requestId
      )),
      { status: 405, headers }
    );
  }

  try {
    const clientIp = getClientIpFromRequest(request);
    const rateLimit = checkRateLimit(clientIp);

    headers.set("X-RateLimit-Limit", "100");
    headers.set("X-RateLimit-Remaining", rateLimit.remaining.toString());
    headers.set("X-RateLimit-Reset", rateLimit.resetAt.toString());

    if (!rateLimit.allowed) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.RATE_LIMITED, "Rate limit exceeded", 429),
          requestId
        )),
        { status: 429, headers }
      );
    }

    if (FEATURES.enableApiKey) {
      validateApiKeyFromRequest(request);
    }

    let body: ProxyRequest;
    try {
      body = await request.json();
    } catch {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INVALID_REQUEST, "Invalid JSON body", 400),
          requestId
        )),
        { status: 400, headers }
      );
    }

    const { url: targetUrl, method = "GET", headers: reqHeaders = {}, body: reqBody, timeout }: ProxyRequest = body;

    const urlValidation = validateUrl(targetUrl);
    if (!urlValidation.valid) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify(jsonError(
          new AppError(ErrorCode.INVALID_URL, urlValidation.error || "Invalid URL", 400),
          requestId
        )),
        { status: 400, headers }
      );
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        logger.warn(`DNS validation failed for ${targetUrl}: ${dnsResult.error}`);
      }
    } catch (dnsError) {
      logger.warn(`DNS validation error for ${targetUrl}: ${dnsError}`);
    }

    const response = await proxyService.execute({
      url: targetUrl,
      method,
      headers: reqHeaders,
      body: reqBody,
      timeout,
    });

    headers.set("X-Request-Id", requestId);
    headers.set("Content-Type", "application/json");

    return new Response(
      JSON.stringify({
        ...response,
        requestId,
        duration: Date.now() - startTime,
      }),
      { status: 200, headers }
    );
  } catch (error) {
    headers.set("Content-Type", "application/json");

    if (error instanceof AppError) {
      return new Response(
        JSON.stringify(jsonError(error, requestId)),
        { status: error.statusCode, headers }
      );
    }

    const errorMessage = isProduction()
      ? "Internal server error"
      : (error instanceof Error ? error.message : "Unknown error");

    const appError = new AppError(ErrorCode.INTERNAL_ERROR, errorMessage, 500);
    return new Response(
      JSON.stringify(jsonError(appError, requestId)),
      { status: 500, headers }
    );
  }
}

logger.info(`Starting xRelay server on ${HOST}:${PORT}`);

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    return handleRequest(request);
  },
  error(error) {
    logger.error(`Server error: ${error.message}`);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  },
});

logger.info(`🚀 xRelay server running at http://${HOST}:${PORT}`);
logger.info(`📡 API endpoint: http://${HOST}:${PORT}/api`);
logger.info(`💚 Health check: http://${HOST}:${PORT}/api/health`);

console.log(`\n测试命令:`);
console.log(`curl -X POST http://localhost:${PORT}/api \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -H "x-api-key: YOUR_API_KEY" \\`);
console.log(`  -d '{"url": "https://httpbin.org/ip", "method": "GET"}'\n`);

process.on("SIGINT", () => {
  logger.info("Shutting down server...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Shutting down server...");
  server.stop();
  process.exit(0);
});
