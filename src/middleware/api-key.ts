/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { getHeaderValue } from "../utils/headers.js";
import { timingSafeEqualString } from "../utils/crypto.js";

/**
 * API Key 配置
 */
export interface ApiKeyConfig {
  enabled: boolean;
  headerName: string;
  keys: string[];
}

/**
 * 验证 API Key
 */
function validateApiKey(request: Request, config: ApiKeyConfig): boolean {
  if (!config.enabled) {
    return true;
  }

  if (config.keys.length === 0) {
    console.error('[API Key] API Key verification enabled but no keys configured');
    return false;
  }

  const apiKey = getHeaderValue(request.headers, config.headerName);
  if (!apiKey) {
    return false;
  }

  let matched = false;
  for (const key of config.keys) {
    if (timingSafeEqualString(apiKey, key)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * 创建 API Key 验证中间件
 */
export function apiKeyMiddleware(config: ApiKeyConfig): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    if (!validateApiKey(context.request, config)) {
      context.response = new Response(
        JSON.stringify({
          error: "Unauthorized",
          code: "INVALID_API_KEY",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
      return;
    }

    await next();
  };
}
