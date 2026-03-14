/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 认证中间件模块
 * 提供 API Key 验证功能
 */

import type { VercelRequest } from "@vercel/node";
import { timingSafeEqual } from "crypto";
import { API_KEY_CONFIG } from "../config.js";
import { createInvalidApiKeyError } from "../errors/index.js";

/**
 * 验证 API Key
 * @param req Vercel 请求对象
 * @throws AppError 如果 API Key 无效
 */
export function validateApiKey(req: VercelRequest): void {
  // 如果未启用 API Key 验证，直接通过
  if (!API_KEY_CONFIG.enabled) {
    return;
  }

  // 如果启用了但没有配置任何 API Key，拒绝所有请求
  if (API_KEY_CONFIG.keys.length === 0) {
    console.error("[Auth] API Key verification enabled but no keys configured");
    throw createInvalidApiKeyError();
  }

  const providedKey = req.headers[API_KEY_CONFIG.headerName.toLowerCase()] as string | undefined;

  if (!providedKey) {
    throw createInvalidApiKeyError();
  }

  // 使用常量时间比较，防止时序攻击
  let matched = false;
  for (const key of API_KEY_CONFIG.keys) {
    if (timingSafeEqualString(providedKey, key)) {
      matched = true;
      // 不 break，继续比较以保持恒定时间
    }
  }

  if (!matched) {
    throw createInvalidApiKeyError();
  }
}

/**
 * 常量时间字符串比较（防止时序攻击）
 * 优先使用 Node.js 内置的 timingSafeEqual
 */
function timingSafeEqualString(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    // 降级方案：使用填充确保无论长度如何都执行相同时间
    const maxLen = 64;
    const paddedA = a.padEnd(maxLen, "\0").slice(0, maxLen);
    const paddedB = b.padEnd(maxLen, "\0").slice(0, maxLen);

    let result = 0;
    for (let i = 0; i < maxLen; i++) {
      result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
    }
    return result === 0 && a.length === b.length;
  }
}

/**
 * 从请求中提取 API Key
 * @param req Vercel 请求对象
 * @returns API Key 或 undefined
 */
export function extractApiKey(req: VercelRequest): string | undefined {
  return req.headers[API_KEY_CONFIG.headerName.toLowerCase()] as string | undefined;
}

/**
 * 检查 API Key 验证是否启用
 * @returns 是否启用
 */
export function isApiKeyEnabled(): boolean {
  return API_KEY_CONFIG.enabled;
}
