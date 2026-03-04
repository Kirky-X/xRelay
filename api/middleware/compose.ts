/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, ComposedMiddleware, MiddlewareContext } from "./types.js";

/**
 * 组合多个中间件为单个处理函数
 * 
 * 中间件按顺序执行，每个中间件可以:
 * 1. 在 next() 之前执行预处理逻辑
 * 2. 调用 next() 将控制权传递给下一个中间件
 * 3. 在 next() 之后执行后处理逻辑
 * 
 * @example
 * const handler = compose(
 *   loggingMiddleware,
 *   authMiddleware,
 *   rateLimitMiddleware,
 *   finalHandler
 * );
 * await handler(context);
 */
export function compose(...middlewares: Middleware[]): ComposedMiddleware {
  return async (context: MiddlewareContext): Promise<void> => {
    let index = -1;

    async function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const middleware = middlewares[i];
      if (!middleware) {
        return;
      }

      await middleware(context, () => dispatch(i + 1));
    }

    await dispatch(0);
  };
}

/**
 * 创建一个返回响应的中间件
 * 用于在中间件链中设置响应
 */
export function respond(response: Response): Middleware {
  return async (context, next) => {
    context.response = response;
    // 不调用 next()，终止中间件链
  };
}

/**
 * 条件中间件 - 仅当条件满足时执行
 */
export function when(
  condition: (context: MiddlewareContext) => boolean | Promise<boolean>,
  middleware: Middleware
): Middleware {
  return async (context, next) => {
    const shouldExecute = await condition(context);
    if (shouldExecute) {
      await middleware(context, next);
    } else {
      await next();
    }
  };
}
