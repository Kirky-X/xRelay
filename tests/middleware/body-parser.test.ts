/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Body Parser Middleware Tests - 请求体解析中间件测试
 * 测试 JSON 解析、大小限制、方法过滤等功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bodyParserMiddleware } from '../../api/middleware/body-parser.js';
import type { MiddlewareContext, RequestBody } from '../../api/middleware/types.js';

/**
 * 创建模拟的中间件上下文
 */
function createMockContext(
  body: unknown = null,
  overrides: Partial<MiddlewareContext> = {}
): MiddlewareContext {
  const request = new Request('http://test.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    request,
    clientIp: '127.0.0.1',
    startTime: Date.now(),
    state: {},
    ...overrides,
  };
}

describe('Body Parser Middleware', () => {
  describe('基本功能', () => {
    it('应该正确解析有效的 JSON 请求体', async () => {
      const requestBody = {
        url: 'https://example.com/api',
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      };

      const context = createMockContext(requestBody);

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024, // 1MB
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.body).toEqual(requestBody);
    });

    it('应该正确解析包含 body 字段的请求', async () => {
      const requestBody = {
        url: 'https://example.com/api',
        method: 'POST',
        body: '{"key": "value"}',
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });

    it('应该正确解析包含 useCache 字段的请求', async () => {
      const requestBody = {
        url: 'https://example.com/api',
        useCache: true,
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body?.useCache).toBe(true);
    });
  });

  describe('方法过滤', () => {
    it('应该拒绝不允许的方法', async () => {
      const context = createMockContext(
        { url: 'https://example.com' },
        {
          request: new Request('http://test.com', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com' }),
          }),
        }
      );

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST', 'PUT'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(405);
    });

    it('应该返回正确的方法不允许错误响应', async () => {
      const context = createMockContext(
        { url: 'https://example.com' },
        {
          request: new Request('http://test.com', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
          }),
        }
      );

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST', 'PUT'],
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(405);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
        allowedMethods: ['POST', 'PUT'],
      });
    });

    it('应该允许配置的多个方法', async () => {
      const methods = ['POST', 'PUT', 'PATCH'];

      for (const method of methods) {
        const context = createMockContext(
          { url: 'https://example.com' },
          {
            request: new Request('http://test.com', {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: 'https://example.com' }),
            }),
          }
        );

        let nextCalled = false;
        const middleware = bodyParserMiddleware({
          maxSize: 1024 * 1024,
          allowedMethods: methods,
        });

        await middleware(context, async () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
      }
    });
  });

  describe('大小限制', () => {
    it('应该拒绝超过大小限制的请求体', async () => {
      // 创建一个超过 100 字节的请求体
      const largeBody = {
        url: 'https://example.com',
        data: 'x'.repeat(200),
      };

      const context = createMockContext(largeBody);

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 100, // 100 字节限制
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(413);
    });

    it('应该返回正确的请求体过大错误响应', async () => {
      const largeBody = {
        url: 'https://example.com',
        data: 'x'.repeat(200),
      };

      const context = createMockContext(largeBody);

      const middleware = bodyParserMiddleware({
        maxSize: 100,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(413);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Request body too large',
        code: 'REQUEST_TOO_LARGE',
        maxSize: 100,
      });
    });

    it('应该允许刚好在限制内的请求体', async () => {
      // 创建一个刚好在限制内的请求体
      const smallBody = {
        url: 'https://example.com',
      };

      const context = createMockContext(smallBody);

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1000,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.body).toEqual(smallBody);
    });
  });

  describe('JSON 解析错误', () => {
    it('应该拒绝无效的 JSON', async () => {
      const request = new Request('http://test.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const context: MiddlewareContext = {
        request,
        clientIp: '127.0.0.1',
        startTime: Date.now(),
        state: {},
      };

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(400);
    });

    it('应该返回正确的 JSON 解析错误响应', async () => {
      const request = new Request('http://test.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      const context: MiddlewareContext = {
        request,
        clientIp: '127.0.0.1',
        startTime: Date.now(),
        state: {},
      };

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(400);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Invalid JSON body',
        code: 'INVALID_JSON',
      });
    });

    it('应该正确处理空请求体', async () => {
      const request = new Request('http://test.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      const context: MiddlewareContext = {
        request,
        clientIp: '127.0.0.1',
        startTime: Date.now(),
        state: {},
      };

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      // 空字符串不是有效的 JSON
      expect(context.response?.status).toBe(400);
    });

    it('应该正确处理 null 请求体', async () => {
      const request = new Request('http://test.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });

      const context: MiddlewareContext = {
        request,
        clientIp: '127.0.0.1',
        startTime: Date.now(),
        state: {},
      };

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      // null 是有效的 JSON
      expect(nextCalled).toBe(true);
      expect(context.body).toBeNull();
    });
  });

  describe('请求体字段验证', () => {
    it('应该正确解析所有可选字段', async () => {
      const requestBody: RequestBody = {
        url: 'https://example.com/api',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: '{"data": "value"}',
        useCache: true,
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });

    it('应该正确解析最小请求体', async () => {
      const requestBody = {
        url: 'https://example.com',
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });

    it('应该正确处理空对象', async () => {
      const context = createMockContext({});

      let nextCalled = false;
      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.body).toEqual({});
    });
  });

  describe('中间件链行为', () => {
    it('应该在解析成功时继续中间件链', async () => {
      const context = createMockContext({ url: 'https://example.com' });
      const nextMiddleware = vi.fn();

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).toHaveBeenCalled();
    });

    it('应该在解析失败时终止中间件链', async () => {
      const request = new Request('http://test.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const context: MiddlewareContext = {
        request,
        clientIp: '127.0.0.1',
        startTime: Date.now(),
        state: {},
      };

      const nextMiddleware = vi.fn();

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).not.toHaveBeenCalled();
    });

    it('应该在方法不允许时终止中间件链', async () => {
      const context = createMockContext(
        { url: 'https://example.com' },
        {
          request: new Request('http://test.com', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }),
        }
      );

      const nextMiddleware = vi.fn();

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('应该正确处理嵌套的 JSON 对象', async () => {
      const requestBody = {
        url: 'https://example.com',
        headers: {
          nested: {
            deep: {
              value: 'test',
            },
          },
        },
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });

    it('应该正确处理数组类型的请求体', async () => {
      const requestBody = {
        url: 'https://example.com',
        items: [1, 2, 3, 'a', 'b', 'c'],
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });

    it('应该正确处理 Unicode 字符', async () => {
      const requestBody = {
        url: 'https://example.com',
        message: '你好世界 🌍',
      };

      const context = createMockContext(requestBody);

      const middleware = bodyParserMiddleware({
        maxSize: 1024 * 1024,
        allowedMethods: ['POST'],
      });

      await middleware(context, async () => {});

      expect(context.body).toEqual(requestBody);
    });
  });
});
