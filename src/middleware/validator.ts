/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { validateUrl, validateDnsResolution } from "../security.js";

/**
 * 创建 URL 验证中间件
 * 包含 DNS 重绑定防护
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

    // 静态 URL 验证
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

    // DNS 重绑定防护：验证 DNS 解析结果
    const parsedUrl = new URL(context.body.url);
    const dnsValidation = await validateDnsResolution(parsedUrl.hostname);
    if (!dnsValidation.valid) {
      context.response = new Response(
        JSON.stringify({
          error: "DNS resolution blocked",
          code: "DNS_BLOCKED",
          reason: dnsValidation.error,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    // 将验证后的 URL 和 IP 列表存储到 state
    context.state.validatedUrl = context.body.url;
    context.state.validatedIps = dnsValidation.ips;

    await next();
  };
}
