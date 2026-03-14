/**
 * API 响应格式
 * 统一的 API 响应结构
 */

import type { AppError } from "../errors/index.js";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ResponseMeta;
}

export interface ResponseMeta {
  requestId: string;
  duration: number;
  timestamp: string;
}

export function successResponse<T>(
  data: T,
  requestId: string,
  startTime: number
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      requestId,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    },
  };
}

export function errorResponse(
  error: AppError,
  requestId: string,
  startTime: number
): ApiResponse {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    meta: {
      requestId,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    },
  };
}
