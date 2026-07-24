/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 独立服务器入口 - 跨运行时部署（Bun 二进制 / Node.js 容器）
 *
 * 职责：将 HTTP 请求适配到共享核心处理器 dispatchRequest。
 * 业务逻辑统一位于 src/server/handlers.ts，本文件只做运行时 IO 适配。
 *
 * 运行时检测：Bun 环境用 Bun.serve（性能更优），Node 环境用 node:http。
 * 两条路径共享同一套 buildContext/toResponse 适配逻辑。
 */

import {
  dispatchRequest,
  type RequestContext,
  type ResponseSpec,
} from "./server/handlers.js";
import { getClientIpFromRequest } from "./middleware/rate-limit.js";
import { generateRequestId } from "./utils/crypto.js";
import { closeAllProxyAgents, closeAllPinnedAgents } from "./request-handler.js";
import { enforceProductionConfigOrExit, SECURITY_CONFIG } from "./config.js";
import { logger } from "./logger.js";

// 独立部署启动时强制验证生产配置（fail-closed）
// 配置错误（如未设置 API_KEYS/CRON_SECRET/CORS_ORIGINS）时进程退出
enforceProductionConfigOrExit();

// 全局错误兜底：防止未捕获的异常/rejection 导致进程静默退出
// 仅 Node.js 环境需要（Bun 有自己的全局错误处理）
// uncaughtException 后应用可能处于不一致状态，按 Node.js 官方建议应退出进程
// 由进程管理器（systemd/pm2/k8s）重启以恢复一致状态
process.on("uncaughtException", (err) => {
  logger.error(
    `Uncaught exception: ${err.message}`,
    err,
    { module: "Server" },
  );
  // 不立即 exit，先尝试优雅关闭（与 SIGINT/SIGTERM 共用 handler）
  // 通过 setImmediate 让事件循环再跑一轮，确保日志写出
  setImmediate(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  logger.error(
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason : undefined,
    { module: "Server" },
  );
});

const PORT = parseInt(process.env.PORT || "3000", 10);
// 默认绑定到回环地址：避免容器外或主机网络上的未授权访问
// 如需对外暴露，应通过反向代理（nginx/Caddy）并显式设置 HOST=0.0.0.0
const HOST = process.env.HOST || "127.0.0.1";

/**
 * 运行时检测：是否为 Bun 环境
 * Bun 全局有 Bun 对象且 typeof Bun.serve === 'function'
 */
function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: { serve?: unknown } }).Bun === "object"
    && typeof (globalThis as { Bun?: { serve?: unknown } }).Bun?.serve === "function";
}

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
 * 将 ResponseSpec 转换为标准 Response（Bun/Node 均原生支持）
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

/**
 * 创建优雅关闭处理器（SIGINT/SIGTERM 通用）
 *
 * 统一 Bun/Node 两条路径的关闭逻辑，避免重复代码。
 * 关闭顺序：
 * 1. 停止接收新请求（server.stop / server.close）
 * 2. 等待所有 ProxyAgent / pinned Agent 的 close() 完成（释放 TCP 连接）
 * 3. 短延迟确保 in-flight 响应写出
 * 4. process.exit
 *
 * 资源清理使用 await（架构 M3 + 性能 M2），避免 process.exit
 * 提前中断事件循环导致 TCP 连接被 RST 而非正常 FIN。
 *
 * @param stopServer 停止 server 的函数（Bun 用 server.stop，Node 用 server.close）
 */
function createShutdownHandler(stopServer: () => void): () => Promise<void> {
  return async () => {
    logger.info("Shutting down server...");
    try {
      stopServer();
    } catch (error) {
      logger.error(
        `Error stopping server: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
        { module: "Server" },
      );
    }
    // 等待 Agent 池真正释放（避免 TCP 连接被 RST）
    await Promise.all([
      closeAllProxyAgents(),
      closeAllPinnedAgents(),
    ]).catch((err: unknown) => {
      logger.error(
        `Error closing agent pools: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
        { module: "Server" },
      );
    });
    // 短延迟确保 in-flight 响应写出（最多 500ms，不阻塞太久）
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(0);
  };
}

/**
 * 统一的请求处理（Bun.serve 和 node:http 共用）
 */
async function handleRequest(request: Request): Promise<Response> {
  try {
    const ctx = await buildContext(request);
    const spec = await dispatchRequest(ctx);
    return toResponse(spec);
  } catch (error) {
    // 兜底：dispatchRequest 内部应已捕获所有错误
    // 此处仅处理未预期的 IO 适配错误（如 body 解析异常）
    logger.error(
      `Unhandled error in handler: ${error instanceof Error ? error.message : "Unknown error"}`,
      error instanceof Error ? error : undefined,
      { module: "StandaloneHandler" },
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
}

logger.info(`Starting xRelay server on ${HOST}:${PORT}`, {
  module: "Server",
  runtime: isBunRuntime() ? "bun" : "node",
});

if (isBunRuntime()) {
  // Bun 运行时：使用 Bun.serve（性能更优）
  const BunNS = (globalThis as { Bun: { serve: typeof import("bun").serve } }).Bun;
  const server = BunNS.serve({
    port: PORT,
    hostname: HOST,
    async fetch(request: Request): Promise<Response> {
      return handleRequest(request);
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

  process.on("SIGINT", createShutdownHandler(() => server.stop()));
  process.on("SIGTERM", createShutdownHandler(() => server.stop()));
} else {
    // Node.js 运行时：使用 node:http（兼容 Docker/标准 Node 部署）
    // 使用 top-level await 避免动态 import 的 promise 链导致事件循环提前退出
    const { createServer } = await import("node:http");
    const server = createServer(async (req, res) => {
      try {
        // 将 Node IncomingMessage 转换为标准 Request
        // 构造完整 URL（含 host，避免 new URL 报错）
        // 不信任客户端 host/x-forwarded-proto header（防欺骗）：
        // - host 用配置的 HOST:PORT（容器内通信固定值）
        // - protocol 固定为 http（容器内不加密，对外由反向代理处理 TLS）
        const host = `${HOST}:${PORT}`;
        const protocol = "http";
        const fullUrl = `${protocol}://${host}${req.url || "/"}`;

        const headers = new Headers();
        // Node headers 是对象（小写 key），遍历复制
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
          } else {
            headers.set(key, value);
          }
        }

        const method = req.method || "GET";
        // GET/HEAD 不应有 body，避免无意义的 stream 读取
        const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

        // 读取 Node.js IncomingMessage body
        // 使用事件监听而非 for-await：更兼容 Node.js IncomingMessage 流
        // 直接传给 new Request() 会因 Node 流与 Web ReadableStream 不兼容而失败
        let bodyInit: BodyInit | null = null;
        if (hasBody) {
          bodyInit = await new Promise<string | null>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let totalSize = 0;
            const maxBodySize = SECURITY_CONFIG.maxRequestSize;
            req.on("data", (chunk: Buffer) => {
              totalSize += chunk.length;
              // 请求体大小限制（防 OOM）：超过 maxRequestSize 立即终止请求
              if (totalSize > maxBodySize) {
                req.destroy();
                reject(new Error(`Request body exceeds ${maxBodySize} bytes`));
                return;
              }
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            req.on("end", () => {
              resolve(chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : null);
            });
            req.on("error", reject);
          });
        }

        const request = new Request(fullUrl, {
          method,
          headers,
          body: bodyInit,
        });

        const response = await handleRequest(request);

        // 写状态码和响应头
        const respHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          respHeaders[key] = value;
        });
        res.writeHead(response.status, respHeaders);

        // 写响应体
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
      } catch (error) {
        logger.error(
          `Unhandled error in Node handler: ${error instanceof Error ? error.message : "Unknown error"}`,
          error instanceof Error ? error : undefined,
          { module: "NodeHandler" },
        );

        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: "Internal Server Error", code: "INTERNAL_ERROR" }));
      }
    });

    server.listen(PORT, HOST, () => {
      logger.info(`🚀 xRelay server running at http://${HOST}:${PORT}`);
      logger.info(`📡 API endpoint: http://${HOST}:${PORT}/api`);
      logger.info(`💚 Health check: http://${HOST}:${PORT}/api/health`);
    });

    process.on("SIGINT", createShutdownHandler(() => server.close()));
    process.on("SIGTERM", createShutdownHandler(() => server.close()));
  }

// 开发环境输出测试命令提示（生产环境静默，避免日志噪声与 gitleaks 误报）
if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
  console.log(`\n测试命令:`);
  console.log(`curl -X POST http://localhost:${PORT}/api \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "x-api-key: YOUR_API_KEY" \\`);
  console.log(`  -d '{"url": "https://httpbin.org/ip", "method": "GET"}'\n`);
}
