/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * API 入口层 - Vercel IO 适配器
 *
 * 职责：将 VercelRequest/VercelResponse 适配到共享核心处理器 dispatchRequest。
 * 业务逻辑统一位于 src/server/handlers.ts，本文件只做运行时 IO 适配。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  dispatchRequest,
  type RequestContext,
} from "../src/server/handlers.js";
import { getClientIp } from "../src/middleware/rate-limit.js";
import { generateRequestId } from "../src/utils/crypto.js";
import { logger } from "../src/logger.js";

/**
 * 从 VercelRequest 构造运行时中立的 RequestContext
 */
function buildContext(req: VercelRequest): RequestContext {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // 路径解析：去掉 query string
  const url = req.url ?? "";
  const path = url.split("?")[0] || "";

  // headers 统一转换为 Headers 对象（Vercel 的 headers 是普通对象）
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  // 客户端 IP（Vercel 提供 req.ip，回退到 x-forwarded-for / x-real-ip）
  const clientIp = getClientIp(req);

  return {
    method: req.method ?? "GET",
    path,
    headers,
    body: req.body,
    clientIp,
    requestId,
    startTime,
  };
}

/**
 * 将 ResponseSpec 应用到 VercelResponse
 */
function applyResponse(spec: Awaited<ReturnType<typeof dispatchRequest>>, res: VercelResponse): void {
  for (const [name, value] of Object.entries(spec.headers)) {
    res.setHeader(name, value);
  }
  res.status(spec.status);
  if (spec.body === null || spec.body === undefined) {
    res.end();
  } else {
    res.json(spec.body);
  }
}

/**
 * Vercel 入口处理函数
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    const ctx = buildContext(req);
    const spec = await dispatchRequest(ctx);
    applyResponse(spec, res);
  } catch (error) {
    // 兜底：dispatchRequest 内部应已捕获所有错误并返回 ResponseSpec
    // 此处仅处理未预期的 IO 适配错误
    logger.error(
      `Unhandled error in Vercel handler: ${error instanceof Error ? error.message : "Unknown error"}`,
      error instanceof Error ? error : undefined,
      { module: "VercelHandler" },
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
      });
    }
  }
}
