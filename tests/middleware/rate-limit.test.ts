/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limit Middleware Tests - 速率限制中间件测试
 * 测试全局限流、IP限流、配置选项等功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimitMiddleware } from '../../api/middleware/rate-limit.js';
import type { MiddlewareContext } from '../../api/middleware/types.js';

// Mock rate-limiter 模块
vi.mock('../../api/rate-limiter.js', () => ({
  checkGlobalRateLimit: vi.fn(),
  checkIpRateLimit: vi.fn(),
}));

import { checkGlobalRateLimit, checkIpRateLimit } from '../../api/rate-limiter.js';

const mockCheckGlobalRateLimit = vi.mocked(checkGlobalRateLimit);
const mockCheckIpRateLimit = vi.mocked(checkIpRateLimit);

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

describe('Rate Limit Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('基本功能', () => {
    it('应该在禁用时直接通过', async () => {
      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: false,
        enableGlobalLimit: true,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.response).toBeUndefined();
      expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled();
      expect(mockCheckIpRateLimit).not.toHaveBeenCalled();
    });

    it('应该在启用时检查限流', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetIn: 60000,
      });
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetIn: 60000,
      });

      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockCheckGlobalRateLimit).toHaveBeenCalled();
      expect(mockCheckIpRateLimit).toHaveBeenCalledWith('127.0.0.1');
    });
  });

  describe('全局限流', () => {
    it('应该在全局限流通过时继续', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 50,
        resetIn: 30000,
      });

      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(context.response).toBeUndefined();
    });

    it('应该在全局限流触发时拒绝请求', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 45000,
      });

      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(429);
    });

    it('应该返回正确的全局限流错误响应', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 45000,
      });

      const context = createMockContext();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(429);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Rate limit exceeded. Please try again later.',
        code: 'RATE_LIMIT_GLOBAL',
        retryAfter: 45, // Math.ceil(45000 / 1000)
      });
    });

    it('应该在全局限流禁用时不检查', async () => {
      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: false,
        enableIpLimit: false,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('IP 限流', () => {
    it('应该在 IP 限流通过时继续', async () => {
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 20,
        resetIn: 15000,
      });

      const context = createMockContext({ clientIp: '192.168.1.100' });

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: false,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockCheckIpRateLimit).toHaveBeenCalledWith('192.168.1.100');
    });

    it('应该在 IP 限流触发时拒绝请求', async () => {
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 30000,
      });

      const context = createMockContext({ clientIp: '192.168.1.100' });

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: false,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(429);
    });

    it('应该返回正确的 IP 限流错误响应', async () => {
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 30000,
      });

      const context = createMockContext();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: false,
        enableIpLimit: true,
      });

      await middleware(context, async () => {});

      expect(context.response?.status).toBe(429);
      expect(context.response?.headers.get('Content-Type')).toBe('application/json');

      const body = await context.response?.json();
      expect(body).toEqual({
        error: 'Rate limit exceeded for your IP.',
        code: 'RATE_LIMIT_IP',
        retryAfter: 30, // Math.ceil(30000 / 1000)
      });
    });

    it('应该正确处理不同的 IP 地址', async () => {
      const ips = ['192.168.1.1', '10.0.0.1', '172.16.0.1'];

      for (const ip of ips) {
        mockCheckIpRateLimit.mockResolvedValue({
          allowed: true,
          remaining: 10,
          resetIn: 10000,
        });

        const context = createMockContext({ clientIp: ip });

        let nextCalled = false;
        const middleware = rateLimitMiddleware({
          enabled: true,
          enableGlobalLimit: false,
          enableIpLimit: true,
        });

        await middleware(context, async () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
        expect(mockCheckIpRateLimit).toHaveBeenCalledWith(ip);
        vi.clearAllMocks();
      }
    });
  });

  describe('组合限流', () => {
    it('应该同时检查全局和 IP 限流', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 50,
        resetIn: 30000,
      });
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 10,
        resetIn: 15000,
      });

      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockCheckGlobalRateLimit).toHaveBeenCalled();
      expect(mockCheckIpRateLimit).toHaveBeenCalled();
    });

    it('应该在全局限流触发时跳过 IP 限流检查', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 30000,
      });

      const context = createMockContext();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: true,
      });

      await middleware(context, async () => {});

      expect(mockCheckGlobalRateLimit).toHaveBeenCalled();
      expect(mockCheckIpRateLimit).not.toHaveBeenCalled();
    });

    it('应该在全局通过但 IP 限流触发时拒绝请求', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 50,
        resetIn: 30000,
      });
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 15000,
      });

      const context = createMockContext();

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.response?.status).toBe(429);

      const body = await context.response?.json();
      expect(body.code).toBe('RATE_LIMIT_IP');
    });
  });

  describe('边界情况', () => {
    it('应该正确处理 resetIn 为 0 的情况', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 0,
      });

      const context = createMockContext();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {});

      const body = await context.response?.json();
      expect(body.retryAfter).toBe(0);
    });

    it('应该正确处理小数 resetIn', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 15500,
      });

      const context = createMockContext();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {});

      const body = await context.response?.json();
      expect(body.retryAfter).toBe(16); // Math.ceil(15500 / 1000)
    });

    it('应该正确处理 IPv6 地址', async () => {
      mockCheckIpRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 10,
        resetIn: 10000,
      });

      const context = createMockContext({
        clientIp: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      });

      let nextCalled = false;
      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: false,
        enableIpLimit: true,
      });

      await middleware(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockCheckIpRateLimit).toHaveBeenCalledWith('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });
  });

  describe('中间件链行为', () => {
    it('应该在限流通过时继续中间件链', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 50,
        resetIn: 30000,
      });

      const context = createMockContext();
      const nextMiddleware = vi.fn();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).toHaveBeenCalled();
    });

    it('应该在限流触发时终止中间件链', async () => {
      mockCheckGlobalRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetIn: 30000,
      });

      const context = createMockContext();
      const nextMiddleware = vi.fn();

      const middleware = rateLimitMiddleware({
        enabled: true,
        enableGlobalLimit: true,
        enableIpLimit: false,
      });

      await middleware(context, async () => {
        nextMiddleware();
      });

      expect(nextMiddleware).not.toHaveBeenCalled();
    });
  });
});
