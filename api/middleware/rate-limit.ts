/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { checkGlobalRateLimit, checkIpRateLimit } from "../rate-limiter.js";

/**
 * 限流配置
 */
export interface RateLimitConfig {
  enabled: boolean;
  enableGlobalLimit: boolean;
  enableIpLimit: boolean;
}

/**
 * 创建限流中间件
 * 
 * 支持全局和 IP 级别的限流检查
 */
export function rateLimitMiddleware(config: RateLimitConfig): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    if (!config.enabled) {
      await next();
      return;
    }

    // 全局限流检查
    if (config.enableGlobalLimit) {
      const globalLimit = await checkGlobalRateLimit();
      if (!globalLimit.allowed) {
        context.response = new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again later.",
            code: "RATE_LIMIT_GLOBAL",
            retryAfter: Math.ceil(globalLimit.resetIn / 1000),
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
        return;
      }
    }

    // IP 级限流检查
    if (config.enableIpLimit) {
      const ipLimit = await checkIpRateLimit(context.clientIp);
      if (!ipLimit.allowed) {
        context.response = new Response(
          JSON.stringify({
            error: "Rate limit exceeded for your IP.",
            code: "RATE_LIMIT_IP",
            retryAfter: Math.ceil(ipLimit.resetIn / 1000),
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
        return;
      }
    }

    await next();
  };
}
