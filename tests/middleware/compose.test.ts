/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Compose Middleware Tests - 中间件组合测试
 * 测试中间件组合、执行顺序、提前终止等功能
 */

import { describe, it, expect, vi } from 'vitest';
import { compose, respond, when } from '../../src/middleware/compose.js';
import type { Middleware, MiddlewareContext } from '../../src/middleware/types.js';

/**
 * 创建模拟的中间件上下文
 */
function createMockContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    request: new Request('http://test.com'),
    clientIp: '127.0.0.1',
    startTime: Date.now(),
    state: {},
    ...overrides,
  };
}

describe('Compose Middleware', () => {
  describe('compose()', () => {
    it('应该按顺序执行中间件', async () => {
      const order: number[] = [];
      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        await next();
      };
      const middleware2: Middleware = async (ctx, next) => {
        order.push(2);
        await next();
      };
      const middleware3: Middleware = async (ctx, next) => {
        order.push(3);
        await next();
      };

      const handler = compose(middleware1, middleware2, middleware3);
      await handler(createMockContext());

      expect(order).toEqual([1, 2, 3]);
    });

    it('应该支持提前终止中间件链', async () => {
      const order: number[] = [];
      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        ctx.response = new Response('stopped');
        // 不调用 next()，终止中间件链
      };
      const middleware2 = vi.fn<Middleware>();

      const handler = compose(middleware1, middleware2);
      await handler(createMockContext());

      expect(order).toEqual([1]);
      expect(middleware2).not.toHaveBeenCalled();
    });

    it('应该支持在 next() 之后执行后处理逻辑', async () => {
      const order: string[] = [];
      const middleware1: Middleware = async (ctx, next) => {
        order.push('1-before');
        await next();
        order.push('1-after');
      };
      const middleware2: Middleware = async (ctx, next) => {
        order.push('2-before');
        await next();
        order.push('2-after');
      };

      const handler = compose(middleware1, middleware2);
      await handler(createMockContext());

      expect(order).toEqual(['1-before', '2-before', '2-after', '1-after']);
    });

    it('应该正确传递上下文对象', async () => {
      const testContext = createMockContext({
        request: new Request('http://example.com/test'),
        clientIp: '192.168.1.1',
      });

      let receivedContext: MiddlewareContext | null = null;
      const middleware: Middleware = async (ctx, next) => {
        receivedContext = ctx;
        await next();
      };

      await compose(middleware)(testContext);

      expect(receivedContext).toBe(testContext);
      expect(receivedContext?.request.url).toBe('http://example.com/test');
      expect(receivedContext?.clientIp).toBe('192.168.1.1');
    });

    it('应该支持空中间件列表', async () => {
      const handler = compose();
      const context = createMockContext();

      // 不应该抛出错误
      await expect(handler(context)).resolves.toBeUndefined();
    });

    it('应该支持单个中间件', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        await next();
      };

      await compose(middleware)(createMockContext());

      expect(executed).toBe(true);
    });

    it('应该在 next() 被多次调用时设置错误响应', async () => {
      const middleware: Middleware = async (ctx, next) => {
        await next();
        await next(); // 第二次调用应该抛出错误
      };

      const context = createMockContext();
      await compose(middleware)(context);

      expect(context.response?.status).toBe(500);
      const body = await context.response?.json();
      expect(body.code).toBe('MIDDLEWARE_ERROR');
      expect(body.message).toContain('next() called multiple times');
    });

    it('应该正确处理中间件中的异步操作', async () => {
      const order: number[] = [];
      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        await new Promise(resolve => setTimeout(resolve, 10));
        await next();
        order.push(4);
      };
      const middleware2: Middleware = async (ctx, next) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push(2);
        await next();
        order.push(3);
      };

      const handler = compose(middleware1, middleware2);
      await handler(createMockContext());

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('应该正确处理中间件抛出的错误', async () => {
      const error = new Error('middleware error');
      const middleware: Middleware = async () => {
        throw error;
      };

      const context = createMockContext();
      await compose(middleware)(context);

      expect(context.response?.status).toBe(500);
      const body = await context.response?.json();
      expect(body.code).toBe('MIDDLEWARE_ERROR');
      expect(body.message).toBe('middleware error');
    });

    it('应该允许后续中间件修改响应', async () => {
      const middleware1: Middleware = async (ctx, next) => {
        await next();
        // 后处理：修改响应
        if (ctx.response) {
          ctx.response = new Response('modified', {
            status: 200,
            headers: { 'X-Modified': 'true' },
          });
        }
      };
      const middleware2: Middleware = async (ctx, next) => {
        ctx.response = new Response('original');
        await next();
      };

      const context = createMockContext();
      await compose(middleware1, middleware2)(context);

      expect(context.response?.status).toBe(200);
      const body = await context.response?.text();
      expect(body).toBe('modified');
      expect(context.response?.headers.get('X-Modified')).toBe('true');
    });

    it('应该支持中间件链中的状态传递', async () => {
      const middleware1: Middleware = async (ctx, next) => {
        ctx.state.userId = 'user-123';
        await next();
      };
      const middleware2: Middleware = async (ctx, next) => {
        expect(ctx.state.userId).toBe('user-123');
        ctx.state.authenticated = true;
        await next();
      };
      const middleware3: Middleware = async (ctx, next) => {
        expect(ctx.state.authenticated).toBe(true);
        await next();
      };

      await compose(middleware1, middleware2, middleware3)(createMockContext());
    });
  });

  describe('respond()', () => {
    it('应该创建返回指定响应的中间件', async () => {
      const response = new Response('test response', { status: 201 });
      const middleware = respond(response);
      const context = createMockContext();

      await middleware(context, async () => {});

      expect(context.response).toBe(response);
      expect(context.response?.status).toBe(201);
    });

    it('应该终止中间件链', async () => {
      const nextMiddleware = vi.fn<Middleware>();
      const context = createMockContext();

      await compose(respond(new Response('stopped')), nextMiddleware)(context);

      expect(nextMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('when()', () => {
    it('应该在条件为 true 时执行中间件', async () => {
      let middlewareExecuted = false;
      const middleware: Middleware = async (ctx, next) => {
        middlewareExecuted = true;
        await next();
      };

      const conditionalMiddleware = when(
        () => true,
        middleware
      );

      await conditionalMiddleware(createMockContext(), async () => {});

      expect(middlewareExecuted).toBe(true);
    });

    it('应该在条件为 false 时跳过中间件', async () => {
      const middleware = vi.fn<Middleware>();

      const conditionalMiddleware = when(
        () => false,
        middleware
      );

      let nextCalled = false;
      await conditionalMiddleware(createMockContext(), async () => {
        nextCalled = true;
      });

      expect(middleware).not.toHaveBeenCalled();
      expect(nextCalled).toBe(true);
    });

    it('应该支持异步条件函数', async () => {
      let middlewareExecuted = false;
      const middleware: Middleware = async (ctx, next) => {
        middlewareExecuted = true;
        await next();
      };

      const conditionalMiddleware = when(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return true;
        },
        middleware
      );

      await conditionalMiddleware(createMockContext(), async () => {});

      expect(middlewareExecuted).toBe(true);
    });

    it('应该基于上下文进行条件判断', async () => {
      const context = createMockContext({
        request: new Request('http://test.com/admin'),
      });

      let middlewareExecuted = false;
      const middleware: Middleware = async (ctx, next) => {
        middlewareExecuted = true;
        await next();
      };

      const conditionalMiddleware = when(
        (ctx) => ctx.request.url.includes('/admin'),
        middleware
      );

      await conditionalMiddleware(context, async () => {});

      expect(middlewareExecuted).toBe(true);
    });

    it('应该在条件为 false 时仍然调用 next', async () => {
      let nextCalled = false;
      const middleware = vi.fn<Middleware>();

      const conditionalMiddleware = when(
        () => false,
        middleware
      );

      await conditionalMiddleware(createMockContext(), async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });
});
