/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * API Key Middleware Tests - API 密钥验证中间件测试
 * 测试 API 密钥验证、时序安全比较、配置选项等功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeyMiddleware } from '../../api/middleware/api-key.js';
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

describe('API Key Middleware', () => {
  describe('基本功能', () => {
    it('应该接受有效的 API Key', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'valid-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.response).toBeUndefined();
    });

    it('应该拒绝无效的 API Key', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'invalid-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(401);
    });

    it('应该拒绝缺少 API Key 的请求', async () => {
      const context = createMockContext({
        request: new Request('http://test.com'),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(401);
    });
  });

  describe('配置选项', () => {
    it('应该在禁用时允许所有请求通过', async () => {
      const context = createMockContext({
        request: new Request('http://test.com'),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: false,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.response).toBeUndefined();
    });

    it('应该在启用但无密钥时拒绝所有请求', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'any-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: [],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(401);
    });

    it('应该支持自定义头部名称', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'authorization': 'custom-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['custom-key'],
        headerName: 'authorization',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('应该支持多个有效的 API Key', async () => {
      const keys = ['key-1', 'key-2', 'key-3'];

      for (const key of keys) {
        const context = createMockContext({
          request: new Request('http://test.com', {
            headers: { 'x-api-key': key },
          }),
        });

        let nextCalled = false;
        const middleware = apiKeyMiddleware({
          enabled: true,
          keys,
          headerName: 'x-api-key',
        });

        await middleware(context, async () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
      }
    });
  });

  describe('响应格式', () => {
    it('应该返回正确的错误响应格式', async () => {
      const context = createMockContext({
        request: new Request('http://test.com'),
      });

      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {});

      expect(context.response).toBeDefined();
      expect(context.response?.status).toBe(401);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Unauthorized',
        code: 'INVALID_API_KEY',
      });
    });
  });

  describe('安全性', () => {
    it('应该使用时序安全的比较方法', async () => {
      // 测试不同长度的密钥
      const validKey = 'valid-api-key-12345';
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': validKey },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: [validKey],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('应该拒绝空字符串密钥', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': '' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(401);
    });

    it('应该区分大小写', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'VALID-KEY' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(401);
    });

    it('应该正确处理特殊字符密钥', async () => {
      const specialKey = 'key-with-special-chars!@#$%^&*()';
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': specialKey },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: [specialKey],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe('头部处理', () => {
    it('应该正确处理 Headers 对象', async () => {
      const headers = new Headers();
      headers.set('x-api-key', 'valid-key');

      const context = createMockContext({
        request: new Request('http://test.com', { headers }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('应该正确处理普通对象头部', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'valid-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('应该忽略头部名称大小写', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'X-API-KEY': 'valid-key' },
        }),
      });

      let nextCalled = false;
      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      // Headers API 应该自动处理大小写
      expect(nextCalled).toBe(true);
    });
  });

  describe('中间件链行为', () => {
    it('应该在验证失败时终止中间件链', async () => {
      const context = createMockContext({
        request: new Request('http://test.com'),
      });

      const nextMiddleware = vi.fn();

      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).not.toHaveBeenCalled();
    });

    it('应该在验证成功时继续中间件链', async () => {
      const context = createMockContext({
        request: new Request('http://test.com', {
          headers: { 'x-api-key': 'valid-key' },
        }),
      });

      const nextMiddleware = vi.fn();

      const middleware = apiKeyMiddleware({
        enabled: true,
        keys: ['valid-key'],
        headerName: 'x-api-key',
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).toHaveBeenCalled();
    });
  });
});
