/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * CORS Middleware Tests - 跨域资源共享中间件测试
 * 测试 CORS 头设置、预检请求处理、origin 验证等功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { corsMiddleware, optionsMiddleware, DEFAULT_CORS_CONFIG } from '../../api/middleware/cors.js';
import type { MiddlewareContext } from '../../api/middleware/types.js';

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

describe('CORS Middleware', () => {
  describe('OPTIONS 预检请求', () => {
    it('应该正确处理 OPTIONS 预检请求', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      let nextCalled = false;
      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST', 'PUT'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(204);
      expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(context.response?.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT');
      expect(context.response?.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
      expect(context.response?.headers.get('Access-Control-Max-Age')).toBe('3600');
    });

    it('应该拒绝不在白名单中的 origin', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://malicious.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {});

      expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('');
    });

    it('应该处理没有 Origin 头的请求', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(204);
      expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('');
    });
  });

  describe('普通请求 CORS 头', () => {
    it('应该为允许的 origin 添加 CORS 头', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      // 模拟后续中间件设置响应
      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        context.response = new Response('OK', { status: 200 });
      });

      expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(context.response?.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
      expect(context.response?.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('应该不为不允许的 origin 添加 CORS 头', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://malicious.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        context.response = new Response('OK', { status: 200 });
      });

      // corsOrigin 为空字符串时，Access-Control-Allow-Origin 头为空字符串
      const allowOrigin = context.response?.headers.get('Access-Control-Allow-Origin');
      expect(allowOrigin === '' || allowOrigin === null).toBe(true);
    });

    it('应该保留原始响应的其他头部', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        context.response = new Response('OK', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
          },
        });
      });

      expect(context.response?.headers.get('Content-Type')).toBe('application/json');
      expect(context.response?.headers.get('X-Custom-Header')).toBe('custom-value');
      expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });
  });

  describe('配置选项', () => {
    it('应该使用默认配置', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware();

      await middleware(context, async () => {
        context.response = new Response('OK');
      });

      // 验证中间件不会抛出错误
      expect(context.response).toBeDefined();
    });

    it('应该支持多个允许的 origins', async () => {
      const allowedOrigins = [
        'https://example.com',
        'https://app.example.com',
        'https://admin.example.com',
      ];

      for (const origin of allowedOrigins) {
        const context = createMockContext({
          request: new Request('http://test.com', {
            method: 'GET',
            headers: { 'Origin': origin },
          }),
        });

        const middleware = corsMiddleware({
          allowedOrigins,
          allowedMethods: ['GET'],
          allowedHeaders: ['Content-Type'],
          maxAge: 3600,
        });

        await middleware(context, async () => {
          context.response = new Response('OK');
        });

        expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      }
    });

    it('应该支持多个允许的方法', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {});

      expect(context.response?.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, PATCH'
      );
    });

    it('应该支持多个允许的头部', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
        maxAge: 3600,
      });

      await middleware(context, async () => {});

      expect(context.response?.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization, X-API-Key, X-Request-ID'
      );
    });

    it('应该正确设置 Max-Age', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 86400, // 24 hours
      });

      await middleware(context, async () => {});

      expect(context.response?.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  describe('中间件链行为', () => {
    it('应该在 OPTIONS 请求时终止中间件链', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'OPTIONS',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const nextMiddleware = vi.fn();

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).not.toHaveBeenCalled();
    });

    it('应该在非 OPTIONS 请求时继续中间件链', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const nextMiddleware = vi.fn();

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        nextMiddleware();
        context.response = new Response('OK');
      });

      expect(nextMiddleware).toHaveBeenCalled();
    });
  });

  describe('响应处理', () => {
    it('应该正确处理没有响应的情况', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      // 不设置响应
      await middleware(context, async () => {});

      // 当没有响应时，不会添加 CORS 头
      expect(context.response).toBeUndefined();
    });

    it('应该保留响应状态码和状态文本', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        context.response = new Response('Not Found', {
          status: 404,
          statusText: 'Not Found',
        });
      });

      expect(context.response?.status).toBe(404);
      expect(context.response?.statusText).toBe('Not Found');
    });

    it('应该保留响应体', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          method: 'GET',
          headers: { 'Origin': 'https://example.com' },
        }),
      });

      const middleware = corsMiddleware({
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET'],
        allowedHeaders: ['Content-Type'],
        maxAge: 3600,
      });

      await middleware(context, async () => {
        context.response = new Response(JSON.stringify({ data: 'test' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const body = await context.response?.text();
      expect(body).toBe(JSON.stringify({ data: 'test' }));
    });
  });
});

describe('Options Middleware', () => {
  it('应该仅处理 OPTIONS 请求', async () => {
    const context = createMockContext({
      request: new Request('http://test.com', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://example.com' },
      }),
    });

    let nextCalled = false;
    const middleware = optionsMiddleware({
      allowedOrigins: ['https://example.com'],
      allowedMethods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
      maxAge: 3600,
    });

    await middleware(context, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(context.response?.status).toBe(204);
    expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });

  it('应该在非 OPTIONS 请求时继续中间件链', async () => {
    const context = createMockContext({
      request: new Request('http://test.com', {
        method: 'GET',
        headers: { 'Origin': 'https://example.com' },
      }),
    });

    let nextCalled = false;
    const middleware = optionsMiddleware({
      allowedOrigins: ['https://example.com'],
      allowedMethods: ['GET'],
      allowedHeaders: ['Content-Type'],
      maxAge: 3600,
    });

    await middleware(context, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(context.response).toBeUndefined();
  });

  it('应该使用默认配置', async () => {
    const context = createMockContext({
      request: new Request('http://test.com', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://example.com' },
      }),
    });

    const middleware = optionsMiddleware();

    await middleware(context, async () => {});

    // 验证中间件不会抛出错误
    expect(context.response).toBeDefined();
    expect(context.response?.status).toBe(204);
  });
});

describe('DEFAULT_CORS_CONFIG', () => {
  it('应该包含必要的配置字段', () => {
    expect(DEFAULT_CORS_CONFIG).toHaveProperty('allowedOrigins');
    expect(DEFAULT_CORS_CONFIG).toHaveProperty('allowedMethods');
    expect(DEFAULT_CORS_CONFIG).toHaveProperty('allowedHeaders');
    expect(DEFAULT_CORS_CONFIG).toHaveProperty('maxAge');
  });

  it('allowedOrigins 应该是数组', () => {
    expect(Array.isArray(DEFAULT_CORS_CONFIG.allowedOrigins)).toBe(true);
  });

  it('allowedMethods 应该是数组', () => {
    expect(Array.isArray(DEFAULT_CORS_CONFIG.allowedMethods)).toBe(true);
  });

  it('allowedHeaders 应该是数组', () => {
    expect(Array.isArray(DEFAULT_CORS_CONFIG.allowedHeaders)).toBe(true);
  });

  it('maxAge 应该是数字', () => {
    expect(typeof DEFAULT_CORS_CONFIG.maxAge).toBe('number');
  });
});
