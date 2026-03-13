/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import { timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';
import type { Middleware, MiddlewareContext } from "./types.js";
import { getHeaderValue } from "../utils/headers.js";

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
  // 如果未启用 API Key 验证，直接通过
  if (!config.enabled) {
    return true;
  }

  // 如果启用了但没有配置任何 API Key，拒绝所有请求
  if (config.keys.length === 0) {
    console.error('[API Key] API Key verification enabled but no keys configured');
    return false;
  }

  const apiKey = getHeaderValue(request.headers, config.headerName);
  if (!apiKey) {
    return false;
  }

  // 始终检查所有密钥，不使用 some() 提前返回
  let matched = false;
  for (const key of config.keys) {
    if (timingSafeEqual(apiKey, key)) {
      matched = true;
      // 不 break，继续比较以保持恒定时间
    }
  }
  return matched;
}

/**
 * 常量时间字符串比较（防止时序攻击）
 * 优先使用 Node.js 内置的 timingSafeEqual，失败时降级到自定义实现
 */
function timingSafeEqual(a: string, b: string): boolean {
  try {
    return cryptoTimingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    // 降级方案：使用填充确保无论长度如何都执行相同时间
    const maxLen = 64;
    const paddedA = a.padEnd(maxLen, '\0').slice(0, maxLen);
    const paddedB = b.padEnd(maxLen, '\0').slice(0, maxLen);
    
    let result = 0;
    for (let i = 0; i < maxLen; i++) {
      result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
    }
    return result === 0 && a.length === b.length;
  }
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
