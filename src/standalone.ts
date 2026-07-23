/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 独立服务器入口 - Bun 二进制部署
 *
 * 职责：将 Bun.Request/Response 适配到共享核心处理器 dispatchRequest。
 * 业务逻辑统一位于 src/server/handlers.ts，本文件只做运行时 IO 适配。
 */

import {
  dispatchRequest,
  type RequestContext,
  type ResponseSpec,
} from "./server/handlers.js";
import { getClientIpFromRequest } from "./middleware/rate-limit.js";
import { generateRequestId } from "./utils/crypto.js";
import { logger } from "./logger.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

/**
 * 从标准 Request 构造运行时中立的 RequestContext
 */
async function buildContext(request: Request): Promise<RequestContext> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const url = new URL(request.url);
  const path = url.pathname;

  // body 解析：仅对 POST/PUT/PATCH 尝试 JSON 解析，其他方法保留 null
  let body: unknown = null;
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 解析失败：保留原始字符串，由 handler 决定是否拒绝
      // dispatchRequest 内部会按 body 字段类型处理
      body = null;
    }
  }

  return {
    method: request.method,
    path,
    headers: request.headers,
    body,
    clientIp: getClientIpFromRequest(request),
    requestId,
    startTime,
  };
}

/**
 * 将 ResponseSpec 转换为标准 Response（Bun 原生支持）
 */
function toResponse(spec: ResponseSpec): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(spec.headers)) {
    headers.set(name, value);
  }

  if (spec.body === null || spec.body === undefined) {
    return new Response(null, { status: spec.status, headers });
  }

  return new Response(JSON.stringify(spec.body), {
    status: spec.status,
    headers,
  });
}

logger.info(`Starting xRelay server on ${HOST}:${PORT}`);

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request: Request): Promise<Response> {
    try {
      const ctx = await buildContext(request);
      const spec = await dispatchRequest(ctx);
      return toResponse(spec);
    } catch (error) {
      // 兜底：dispatchRequest 内部应已捕获所有错误
      // 此处仅处理未预期的 IO 适配错误（如 body 解析异常）
      logger.error(
        `Unhandled error in Bun handler: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
        { module: "BunHandler" },
      );

      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          code: "INTERNAL_ERROR",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
  error(error: Error): Response {
    logger.error(`Server error: ${error.message}`);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
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
