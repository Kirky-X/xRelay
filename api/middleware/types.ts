/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 中间件类型定义
 */

/**
 * 请求上下文 - 在中间件之间共享的状态
 */
export interface MiddlewareContext {
  request: Request;
  response?: Response;
  clientIp: string;
  startTime: number;
  body?: RequestBody;
  state: Record<string, unknown>;
}

/**
 * 请求体结构
 */
export interface RequestBody {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  useCache?: boolean;
}

/**
 * 中间件函数类型
 */
export type Middleware = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void>;

/**
 * 中间件组合器
 */
export type ComposedMiddleware = (context: MiddlewareContext) => Promise<void>;
