/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext, RequestBody } from "./types.js";

/**
 * Body Parser 配置
 */
export interface BodyParserConfig {
  maxSize: number;
  allowedMethods: string[];
}

/**
 * 创建请求体解析中间件
 * 
 * 解析 JSON 请求体并验证大小限制
 */
export function bodyParserMiddleware(config: BodyParserConfig): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    // 只处理允许的方法
    if (!config.allowedMethods.includes(context.request.method)) {
      context.response = new Response(
        JSON.stringify({
          error: "Method not allowed",
          code: "METHOD_NOT_ALLOWED",
          allowedMethods: config.allowedMethods,
        }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    // 解析请求体
    try {
      const body = await context.request.json();

      // 检查请求体大小
      const bodySize = JSON.stringify(body).length;
      if (bodySize > config.maxSize) {
        context.response = new Response(
          JSON.stringify({
            error: "Request body too large",
            code: "REQUEST_TOO_LARGE",
            maxSize: config.maxSize,
          }),
          {
            status: 413,
            headers: { "Content-Type": "application/json" },
          }
        );
        return;
      }

      context.body = body as RequestBody;
    } catch (error) {
      context.response = new Response(
        JSON.stringify({
          error: "Invalid JSON body",
          code: "INVALID_JSON",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    await next();
  };
}
