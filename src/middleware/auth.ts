/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 认证中间件模块
 * 提供 API Key 验证功能
 */

import type { VercelRequest } from "@vercel/node";
import { API_KEY_CONFIG } from "../config.js";
import { createInvalidApiKeyError } from "../errors/index.js";
import { timingSafeEqualString } from "../utils/crypto.js";
import { logger } from "../logger.js";

/**
 * 验证 API Key
 * @param req Vercel 请求对象
 * @throws AppError 如果 API Key 无效
 */
export function validateApiKey(req: VercelRequest): void {
  if (!API_KEY_CONFIG.enabled) {
    return;
  }

  if (API_KEY_CONFIG.keys.length === 0) {
    logger.error('API Key 验证已启用但未配置密钥', undefined, { module: 'Auth' });
    throw createInvalidApiKeyError();
  }

  const providedKey = req.headers[API_KEY_CONFIG.headerName.toLowerCase()] as string | undefined;

  if (!providedKey) {
    throw createInvalidApiKeyError();
  }

  let matched = false;
  for (const key of API_KEY_CONFIG.keys) {
    if (timingSafeEqualString(providedKey, key)) {
      matched = true;
    }
  }

  if (!matched) {
    throw createInvalidApiKeyError();
  }
}

/**
 * 验证 API Key（标准 Request 版本，用于 Bun 等运行时）
 * @param request 标准 Request 对象
 * @throws AppError 如果 API Key 无效
 */
export function validateApiKeyFromRequest(request: Request): void {
  if (!API_KEY_CONFIG.enabled) {
    return;
  }

  if (API_KEY_CONFIG.keys.length === 0) {
    logger.error('API Key 验证已启用但未配置密钥', undefined, { module: 'Auth' });
    throw createInvalidApiKeyError();
  }

  const providedKey = request.headers.get(API_KEY_CONFIG.headerName);

  if (!providedKey) {
    throw createInvalidApiKeyError();
  }

  let matched = false;
  for (const key of API_KEY_CONFIG.keys) {
    if (timingSafeEqualString(providedKey, key)) {
      matched = true;
    }
  }

  if (!matched) {
    throw createInvalidApiKeyError();
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
