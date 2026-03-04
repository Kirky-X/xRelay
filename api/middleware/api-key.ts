/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";

/**
 * API Key 配置
 */
export interface ApiKeyConfig {
  enabled: boolean;
  headerName: string;
  keys: string[];
}

/**
 * 获取请求头值（兼容 Headers 对象和普通对象）
 */
function getHeaderValue(
  headers: Headers | Record<string, string>,
  name: string
): string | null {
  if (headers && typeof headers.get === "function") {
    return headers.get(name);
  } else if (headers && (headers as Record<string, string>)[name]) {
    return (headers as Record<string, string>)[name];
  }
  return null;
}

/**
 * 验证 API Key
 */
function validateApiKey(request: Request, config: ApiKeyConfig): boolean {
  // 如果未启用 API Key 验证，直接通过
  if (!config.enabled) {
    return true;
  }

  // 如果没有配置任何 API Key，直接通过（避免误拦截）
  if (config.keys.length === 0) {
    return true;
  }

  // 获取请求中的 API Key
  const apiKey = getHeaderValue(request.headers, config.headerName);

  if (!apiKey) {
    return false;
  }

  // 使用 constant-time 比较防止时序攻击
  return config.keys.some((key) => timingSafeEqual(apiKey, key));
}

/**
 * 常量时间字符串比较（防止时序攻击）
 * 使用填充确保无论长度如何都执行相同时间
 */
function timingSafeEqual(a: string, b: string): boolean {
  // 使用最大长度进行填充，确保恒定时间
  const maxLen = Math.max(a.length, b.length, 64); // 至少比较 64 字节
  
  // 填充两个字符串到相同长度
  const paddedA = a.padEnd(maxLen, '\0');
  const paddedB = b.padEnd(maxLen, '\0');
  
  // 恒定时间比较
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  
  // 额外检查长度是否相同（但不影响主比较的时间）
  // 长度检查放在最后，不会泄露长度差异的时间信息
  result |= (a.length ^ b.length);
  
  return result === 0;
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
      return; // 不调用 next()，终止中间件链
    }

    await next();
  };
}
