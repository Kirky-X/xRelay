/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 请求 ID 中间件
 * 为每个请求生成唯一 ID，便于日志关联和调试
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { randomUUID } from "crypto";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * 生成请求 ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/**
 * 创建请求 ID 中间件
 */
export function requestIdMiddleware(): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    // 尝试从请求头获取现有 ID，否则生成新 ID
    const existingId = context.request.headers.get(REQUEST_ID_HEADER);
    const requestId = existingId || generateRequestId();

    // 存储到 context
    context.requestId = requestId;

    // 执行后续中间件
    await next();

    // 在响应头中添加请求 ID
    if (context.response) {
      context.response.headers.set(REQUEST_ID_HEADER, requestId);
    }
  };
}

export { REQUEST_ID_HEADER };
