/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { validateUrl } from "../security.js";

/**
 * 创建 URL 验证中间件
 */
export function urlValidationMiddleware(): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    if (!context.body?.url) {
      context.response = new Response(
        JSON.stringify({
          error: "URL is required",
          code: "MISSING_URL",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    const urlValidation = validateUrl(context.body.url);
    if (!urlValidation.valid) {
      context.response = new Response(
        JSON.stringify({
          error: "Invalid URL",
          code: "INVALID_URL",
          reason: urlValidation.error,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    // 将验证后的 URL 存储到 state
    context.state.validatedUrl = context.body.url;

    await next();
  };
}
