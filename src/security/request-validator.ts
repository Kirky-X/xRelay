/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 请求验证器模块
 * 验证代理请求的安全性和有效性
 */

import { AppError, ErrorCode } from '../errors/index.js';
import type { ProxyRequest } from '../types/index.js';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_URL_LENGTH = 2048;

export function validateRequest(data: unknown): ProxyRequest {
  if (!data || typeof data !== 'object') {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Invalid request body', 400);
  }

  const request = data as Record<string, unknown>;

  // Validate URL
  const url = request.url;
  if (!url || typeof url !== 'string') {
    throw new AppError(ErrorCode.MISSING_URL, 'URL is required', 400);
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new AppError(ErrorCode.INVALID_URL, 'URL is too long', 400);
  }

  // Validate method
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  const method = (request.method as string) || 'GET';

  if (!validMethods.includes(method.toUpperCase())) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Invalid HTTP method', 400);
  }

  // Validate body size
  if (request.body && typeof request.body === 'string') {
    if (request.body.length > MAX_BODY_SIZE) {
      throw new AppError(ErrorCode.REQUEST_TOO_LARGE, 'Request body is too large', 413);
    }
  }

  // Validate headers
  const headers: Record<string, string> = {};
  if (request.headers && typeof request.headers === 'object') {
    for (const [key, value] of Object.entries(request.headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        // Check for header injection
        if (key.includes('\r') || key.includes('\n') || value.includes('\r') || value.includes('\n')) {
          continue; // Skip potentially malicious headers
        }
        headers[key] = value;
      }
    }
  }

  return {
    url,
    method: method.toUpperCase() as ProxyRequest['method'],
    headers,
    body: request.body as string | undefined,
    timeout: typeof request.timeout === 'number' ? request.timeout : undefined,
  };
}
