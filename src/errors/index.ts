/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 客户端错误 (4xx)
  INVALID_URL = "INVALID_URL",
  MISSING_URL = "MISSING_URL",
  INVALID_API_KEY = "INVALID_API_KEY",
  RATE_LIMITED = "RATE_LIMITED",
  INVALID_REQUEST = "INVALID_REQUEST",
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE",

  // 服务端错误 (5xx)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  PROXY_ERROR = "PROXY_ERROR",
  UPSTREAM_ERROR = "UPSTREAM_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
}

/**
 * 应用错误类
 * 提供统一的错误处理接口
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * 转换为 JSON 格式（用于 API 响应）
   */
  toJSON(requestId?: string): Record<string, unknown> {
    const result: Record<string, unknown> = {
      error: this.message,
      code: this.code,
    };

    if (this.details) {
      result.details = this.details;
    }

    if (requestId) {
      result.requestId = requestId;
    }

    return result;
  }
}

/**
 * 创建 URL 验证错误
 */
export function createInvalidUrlError(reason?: string): AppError {
  return new AppError(
    ErrorCode.INVALID_URL,
    reason || "Invalid or blocked URL",
    400
  );
}

/**
 * 创建缺少 URL 错误
 */
export function createMissingUrlError(): AppError {
  return new AppError(ErrorCode.MISSING_URL, "URL is required", 400);
}

/**
 * 创建 API Key 无效错误
 */
export function createInvalidApiKeyError(): AppError {
  return new AppError(ErrorCode.INVALID_API_KEY, "Unauthorized", 401);
}

/**
 * 创建限流错误
 */
export function createRateLimitError(retryAfter?: number): AppError {
  return new AppError(
    ErrorCode.RATE_LIMITED,
    "Rate limit exceeded",
    429,
    retryAfter ? { retryAfter } : undefined
  );
}

/**
 * 创建方法不允许错误
 */
export function createMethodNotAllowedError(): AppError {
  return new AppError(
    ErrorCode.METHOD_NOT_ALLOWED,
    "Method not allowed",
    405
  );
}

/**
 * 创建代理错误
 */
export function createProxyError(message: string): AppError {
  return new AppError(ErrorCode.PROXY_ERROR, message, 502);
}

/**
 * 创建上游服务错误
 */
export function createUpstreamError(message: string): AppError {
  return new AppError(ErrorCode.UPSTREAM_ERROR, message, 502);
}

/**
 * 创建超时错误
 */
export function createTimeoutError(operation: string): AppError {
  return new AppError(
    ErrorCode.TIMEOUT_ERROR,
    `${operation} timed out`,
    504
  );
}

/**
 * 创建内部错误
 */
export function createInternalError(message?: string): AppError {
  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    message || "Internal server error",
    500
  );
}

/**
 * 判断是否为 AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 将未知错误转换为 AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createInternalError(error.message);
  }

  return createInternalError("Unknown error");
}
