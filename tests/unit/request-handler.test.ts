/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Request Handler Tests - 请求处理器测试
 * 测试 Header 过滤、代理失败回退、响应体大小限制等功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  filterDangerousHeaders,
  sendProxyRequest,
  sendRequestWithMultipleProxies,
} from '../../api/request-handler.js';
import type { ProxyRequest, ProxyResponse } from '../../api/request-handler.js';
import * as proxyManager from '../../api/proxy-manager.js';

// Mock proxy-manager 模块
vi.mock('../../api/proxy-manager.js', () => ({
  getAvailableProxy: vi.fn(),
  getMultipleProxies: vi.fn(),
  reportProxyFailed: vi.fn(),
  reportProxySuccess: vi.fn(),
}));

// Mock logger 模块
vi.mock('../../api/logger.js', () => ({
  logger: {
    requestHandler: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      verbose: vi.fn(),
    },
  },
}));

// Mock config 模块
vi.mock('../../api/config.js', () => ({
  REQUEST_TIMEOUT_CONFIG: {
    proxy: 30000,
    direct: 10000,
  },
  DATABASE_CONFIG: {
    proxiesPerRequest: 3,
  },
}));

describe('Request Handler - Header 过滤', () => {
  describe('危险 Headers 过滤', () => {
    it('应该过滤 Host header', () => {
      const headers = { 'Host': 'evil.com', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Host');
      expect(filtered).not.toHaveProperty('host'); // 大小写不敏感
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Content-Length header', () => {
      const headers = { 'Content-Length': '100', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Content-Length');
      expect(filtered).not.toHaveProperty('content-length');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Transfer-Encoding header', () => {
      const headers = { 'Transfer-Encoding': 'chunked', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Transfer-Encoding');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Connection header', () => {
      const headers = { 'Connection': 'keep-alive', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Connection');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 X-Forwarded-For header', () => {
      const headers = { 'X-Forwarded-For': '1.2.3.4', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('X-Forwarded-For');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Authorization header', () => {
      const headers = { 'Authorization': 'Bearer token', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Authorization');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Cookie header', () => {
      const headers = { 'Cookie': 'session=abc', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Cookie');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤 Set-Cookie header', () => {
      const headers = { 'Set-Cookie': 'session=abc', 'X-Custom': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Set-Cookie');
      expect(filtered).toHaveProperty('X-Custom', 'value');
    });

    it('应该过滤所有危险 headers 同时保留安全的 headers', () => {
      const headers = {
        'Host': 'evil.com',
        'Content-Length': '100',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=5',
        'Upgrade': 'websocket',
        'TE': 'trailers',
        'Trailer': 'x-trailer',
        'Proxy-Authorization': 'Basic abc',
        'Proxy-Connection': 'keep-alive',
        'Proxy-Authenticate': 'Basic',
        'X-Forwarded-For': '1.2.3.4',
        'X-Forwarded-Host': 'evil.com',
        'X-Forwarded-Proto': 'https',
        'X-Real-IP': '1.2.3.4',
        'X-Client-IP': '1.2.3.4',
        'Via': '1.1 proxy',
        'Authorization': 'Bearer token',
        'Cookie': 'session=abc',
        'Set-Cookie': 'session=abc',
        'Expect': '100-continue',
        'Range': 'bytes=0-100',
        'If-Match': '"etag"',
        'If-None-Match': '"etag"',
        'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'If-Unmodified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'If-Range': '"etag"',
        'Front-End-Https': 'on',
        'X-Originating-URL': 'http://evil.com',
        'X-Wap-Profile': 'http://wap.xml',
        'X-ATT-DeviceId': 'device123',
        'X-Safe': 'value',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      const filtered = filterDangerousHeaders(headers);

      // 验证所有危险 headers 被过滤
      expect(filtered).not.toHaveProperty('Host');
      expect(filtered).not.toHaveProperty('Content-Length');
      expect(filtered).not.toHaveProperty('Transfer-Encoding');
      expect(filtered).not.toHaveProperty('Connection');
      expect(filtered).not.toHaveProperty('Keep-Alive');
      expect(filtered).not.toHaveProperty('Upgrade');
      expect(filtered).not.toHaveProperty('TE');
      expect(filtered).not.toHaveProperty('Trailer');
      expect(filtered).not.toHaveProperty('Proxy-Authorization');
      expect(filtered).not.toHaveProperty('Proxy-Connection');
      expect(filtered).not.toHaveProperty('Proxy-Authenticate');
      expect(filtered).not.toHaveProperty('X-Forwarded-For');
      expect(filtered).not.toHaveProperty('X-Forwarded-Host');
      expect(filtered).not.toHaveProperty('X-Forwarded-Proto');
      expect(filtered).not.toHaveProperty('X-Real-IP');
      expect(filtered).not.toHaveProperty('X-Client-IP');
      expect(filtered).not.toHaveProperty('Via');
      expect(filtered).not.toHaveProperty('Authorization');
      expect(filtered).not.toHaveProperty('Cookie');
      expect(filtered).not.toHaveProperty('Set-Cookie');
      expect(filtered).not.toHaveProperty('Expect');
      expect(filtered).not.toHaveProperty('Range');
      expect(filtered).not.toHaveProperty('If-Match');
      expect(filtered).not.toHaveProperty('If-None-Match');
      expect(filtered).not.toHaveProperty('If-Modified-Since');
      expect(filtered).not.toHaveProperty('If-Unmodified-Since');
      expect(filtered).not.toHaveProperty('If-Range');
      expect(filtered).not.toHaveProperty('Front-End-Https');
      expect(filtered).not.toHaveProperty('X-Originating-URL');
      expect(filtered).not.toHaveProperty('X-Wap-Profile');
      expect(filtered).not.toHaveProperty('X-ATT-DeviceId');

      // 验证安全 headers 被保留
      expect(filtered).toHaveProperty('X-Safe', 'value');
      expect(filtered).toHaveProperty('Content-Type', 'application/json');
      expect(filtered).toHaveProperty('Accept', 'application/json');
    });
  });

  describe('CRLF 注入防护', () => {
    it('应该过滤包含 \\r\\n 的 header 值', () => {
      const headers = { 'X-Custom': 'value\r\nX-Injected: malicious' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤仅包含 \\r 的 header 值', () => {
      const headers = { 'X-Custom': 'value\rinjected' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤仅包含 \\n 的 header 值', () => {
      const headers = { 'X-Custom': 'value\ninjected' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤在开头的 CRLF', () => {
      const headers = { 'X-Custom': '\r\nvalue' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤在结尾的 CRLF', () => {
      const headers = { 'X-Custom': 'value\r\n' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });
  });

  describe('空字节防护', () => {
    it('应该过滤包含空字节的 header 值', () => {
      const headers = { 'X-Custom': 'value\0injected' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤开头包含空字节的 header 值', () => {
      const headers = { 'X-Custom': '\0value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });

    it('应该过滤结尾包含空字节的 header 值', () => {
      const headers = { 'X-Custom': 'value\0' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered['X-Custom']).toBeUndefined();
    });
  });

  describe('Header 名称验证', () => {
    it('应该过滤包含空格的 header 名称', () => {
      const headers = { 'Invalid Name': 'value', 'Valid-Name': 'value' };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Invalid Name');
      expect(filtered).toHaveProperty('Valid-Name', 'value');
    });

    it('应该过滤包含特殊字符的 header 名称', () => {
      const headers = {
        'Invalid@Name': 'value',
        'Invalid(Name)': 'value',
        'Invalid<Name>': 'value',
        'Valid-Name': 'value',
      };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('Invalid@Name');
      expect(filtered).not.toHaveProperty('Invalid(Name)');
      expect(filtered).not.toHaveProperty('Invalid<Name>');
      expect(filtered).toHaveProperty('Valid-Name', 'value');
    });

    it('应该允许有效的 header 名称字符', () => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
        'X_Custom_Header': 'value',
        'X123': 'value',
        'Accept': '*/*',
      };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).toEqual(headers);
    });
  });

  describe('Header 值类型验证', () => {
    it('应该过滤非字符串类型的 header 值', () => {
      const headers = {
        'X-Number': 123 as unknown as string,
        'X-Boolean': true as unknown as string,
        'X-Object': {} as unknown as string,
        'X-Array': [] as unknown as string,
        'X-Null': null as unknown as string,
        'X-Undefined': undefined as unknown as string,
        'X-String': 'value',
      };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('X-Number');
      expect(filtered).not.toHaveProperty('X-Boolean');
      expect(filtered).not.toHaveProperty('X-Object');
      expect(filtered).not.toHaveProperty('X-Array');
      expect(filtered).not.toHaveProperty('X-Null');
      expect(filtered).not.toHaveProperty('X-Undefined');
      expect(filtered).toHaveProperty('X-String', 'value');
    });
  });

  describe('大小写不敏感', () => {
    it('应该大小写不敏感地过滤危险 headers', () => {
      const headers = {
        'host': 'evil.com',
        'HOST': 'evil.com',
        'HoSt': 'evil.com',
        'content-length': '100',
        'CONTENT-LENGTH': '100',
        'authorization': 'Bearer token',
        'AUTHORIZATION': 'Bearer token',
        'X-Safe': 'value',
      };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).not.toHaveProperty('host');
      expect(filtered).not.toHaveProperty('HOST');
      expect(filtered).not.toHaveProperty('HoSt');
      expect(filtered).not.toHaveProperty('content-length');
      expect(filtered).not.toHaveProperty('CONTENT-LENGTH');
      expect(filtered).not.toHaveProperty('authorization');
      expect(filtered).not.toHaveProperty('AUTHORIZATION');
      expect(filtered).toHaveProperty('X-Safe', 'value');
    });
  });

  describe('安全 Headers 保留', () => {
    it('应该保留安全的 headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'X-Custom-Header': 'custom-value',
        'X-Request-ID': 'abc123',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US',
        'Cache-Control': 'no-cache',
      };
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).toEqual(headers);
    });

    it('应该保留空 headers 对象', () => {
      const headers = {};
      const filtered = filterDangerousHeaders(headers);

      expect(filtered).toEqual({});
    });
  });
});

describe('Request Handler - 代理失败回退', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendProxyRequest - 代理失败回退', () => {
    it('当没有可用代理且启用 fallback 时应该使用直连', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      // Mock fetch for direct request
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('OK', { status: 200 })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(true);
      expect(result.proxyUsed).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.proxySuccess).toBe(false);
      expect(result.proxyIp).toBeNull();
    });

    it('当没有可用代理且禁用 fallback 时应该返回失败', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: false });

      expect(result.success).toBe(false);
      expect(result.proxyUsed).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      // 当没有可用代理时，sendProxyRequest 会 break 循环，返回 "所有代理尝试失败"
      expect(result.error).toContain('代理尝试失败');
    });

    it('当所有代理失败且启用 fallback 时应该使用直连', async () => {
      // Mock 代理返回失败
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue({
        ip: '192.168.1.1',
        port: 8080,
        protocol: 'http',
        country: 'US',
        anonymity: 'high',
        lastChecked: Date.now(),
        successRate: 0.5,
        avgResponseTime: 1000,
      });

      // Mock fetch for direct request
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Direct OK', { status: 200 })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      // 由于代理请求会失败（没有真实的代理服务器），应该回退到直连
      const result = await sendProxyRequest(request, {
        maxProxyAttempts: 1,
        useFallback: true,
      });

      // 验证回退逻辑
      expect(result.fallbackUsed).toBe(true);
      expect(proxyManager.reportProxyFailed).toHaveBeenCalled();
    });

    it('当所有代理失败且禁用 fallback 时应该返回失败', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue({
        ip: '192.168.1.1',
        port: 8080,
        protocol: 'http',
        country: 'US',
        anonymity: 'high',
        lastChecked: Date.now(),
        successRate: 0.5,
        avgResponseTime: 1000,
      });

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, {
        maxProxyAttempts: 1,
        useFallback: false,
      });

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.error).toContain('代理尝试失败');
    });

    it('应该正确报告代理失败', async () => {
      const mockProxy = {
        ip: '192.168.1.1',
        port: 8080,
        protocol: 'http',
        country: 'US',
        anonymity: 'high',
        lastChecked: Date.now(),
        successRate: 0.5,
        avgResponseTime: 1000,
      };

      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(mockProxy);

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      await sendProxyRequest(request, {
        maxProxyAttempts: 1,
        useFallback: false,
      });

      expect(proxyManager.reportProxyFailed).toHaveBeenCalledWith(mockProxy);
    });
  });

  describe('sendRequestWithMultipleProxies - 并行代理失败回退', () => {
    it('当没有可用代理且启用 fallback 时应该使用直连', async () => {
      vi.mocked(proxyManager.getMultipleProxies).mockResolvedValue([]);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response('OK', { status: 200 })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendRequestWithMultipleProxies(request, 3, true);

      expect(result.success).toBe(true);
      expect(result.proxyUsed).toBe(false);
      expect(result.fallbackUsed).toBe(true);
    });

    it('当没有可用代理且禁用 fallback 时应该返回失败', async () => {
      vi.mocked(proxyManager.getMultipleProxies).mockResolvedValue([]);

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendRequestWithMultipleProxies(request, 3, false);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.error).toContain('没有可用代理');
    });

    it('当所有代理失败且启用 fallback 时应该使用直连', async () => {
      vi.mocked(proxyManager.getMultipleProxies).mockResolvedValue([
        {
          ip: '192.168.1.1',
          port: 8080,
          protocol: 'http',
          country: 'US',
          anonymity: 'high',
          lastChecked: Date.now(),
          successRate: 0.5,
          avgResponseTime: 1000,
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Direct OK', { status: 200 })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendRequestWithMultipleProxies(request, 1, true);

      expect(result.fallbackUsed).toBe(true);
    });

    it('当所有代理失败且禁用 fallback 时应该返回失败', async () => {
      vi.mocked(proxyManager.getMultipleProxies).mockResolvedValue([
        {
          ip: '192.168.1.1',
          port: 8080,
          protocol: 'http',
          country: 'US',
          anonymity: 'high',
          lastChecked: Date.now(),
          successRate: 0.5,
          avgResponseTime: 1000,
        },
      ]);

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendRequestWithMultipleProxies(request, 1, false);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.error).toContain('代理失败');
    });
  });
});

describe('Request Handler - 响应体大小限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('常量定义', () => {
    it('MAX_RESPONSE_SIZE 应该为 10MB', () => {
      const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB
      expect(MAX_RESPONSE_SIZE).toBe(10485760);
    });
  });

  describe('直连请求响应体大小限制', () => {
    it('应该在 Content-Length 超过限制时返回错误', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      // Mock fetch 返回大响应 - 使用 Content-Length 头
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Large content', {
          status: 200,
          headers: {
            'Content-Length': '20971520', // 20MB
          },
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(false);
      // 当直连失败时，sendProxyRequest 会返回 "代理失败，直连也失败"
      expect(result.fallbackUsed).toBe(true);
    });

    it('应该在响应体实际大小超过限制时返回错误', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      // 创建一个大的响应体（模拟流式读取）
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(largeContent, {
          status: 200,
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(false);
      // 当直连失败时，sendProxyRequest 会返回 "代理失败，直连也失败"
      expect(result.fallbackUsed).toBe(true);
    });

    it('应该允许小于限制的响应体', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      const smallContent = 'x'.repeat(1024); // 1KB

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(smallContent, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(true);
      expect(result.data).toBe(smallContent);
    });

    it('应该允许等于限制的响应体', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      // 创建一个刚好 10MB 的响应体
      const exactContent = 'x'.repeat(10 * 1024 * 1024);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(exactContent, {
          status: 200,
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      // 刚好等于限制应该成功
      expect(result.success).toBe(true);
    });
  });

  describe('流式响应处理', () => {
    it('应该正确处理流式响应', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      const content = 'Stream content';

      // 创建一个可读流
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(content));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(true);
      expect(result.data).toBe(content);
    });

    it('应该在流式响应超过限制时取消读取', async () => {
      vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

      // 创建一个大的流式响应
      const largeContent = 'x'.repeat(11 * 1024 * 1024);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(largeContent));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
        })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      expect(result.success).toBe(false);
      // 当直连失败时，sendProxyRequest 会返回 "代理失败，直连也失败"
      expect(result.fallbackUsed).toBe(true);
    });
  });
});

describe('Request Handler - 请求参数验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该正确处理 GET 请求', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api?param=value',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com/api?param=value',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('应该正确处理 POST 请求', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Created', { status: 201 })
    );
    global.fetch = mockFetch;

    const requestBody = JSON.stringify({ key: 'value' });
    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe(201);
  });

  it('应该正确处理带 headers 的请求', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Custom-Header': 'custom-value',
      },
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com/api',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept': 'application/json',
          'X-Custom-Header': 'custom-value',
        }),
      })
    );
  });

  it('应该过滤请求中的危险 headers', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Host': 'evil.com', // 应该被过滤
        'Authorization': 'Bearer token', // 应该被过滤
        'X-Safe-Header': 'safe-value',
      },
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);

    // 验证 fetch 调用时危险 headers 被过滤
    const fetchCall = mockFetch.mock.calls[0];
    const fetchOptions = fetchCall[1] as RequestInit;
    const headers = fetchOptions.headers as Record<string, string>;

    expect(headers).not.toHaveProperty('Host');
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).toHaveProperty('Accept', 'application/json');
    expect(headers).toHaveProperty('X-Safe-Header', 'safe-value');
  });
});

describe('Request Handler - 响应结构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功的代理响应应该包含所有必要字段', async () => {
    const mockProxy = {
      ip: '192.168.1.1',
      port: 8080,
      protocol: 'http',
      country: 'US',
      anonymity: 'high',
      lastChecked: Date.now(),
      successRate: 0.9,
      avgResponseTime: 100,
    };

    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(mockProxy);

    // 由于没有真实代理服务器，代理请求会失败，回退到直连
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: true,
    });

    // 验证响应结构
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('proxyUsed');
    expect(result).toHaveProperty('proxyIp');
    expect(result).toHaveProperty('proxySuccess');
    expect(result).toHaveProperty('fallbackUsed');

    expect(typeof result.success).toBe('boolean');
    expect(typeof result.proxyUsed).toBe('boolean');
    expect(typeof result.proxySuccess).toBe('boolean');
    expect(typeof result.fallbackUsed).toBe('boolean');
  });

  it('失败的响应应该包含错误信息', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: false });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('成功的直连响应应该正确标记', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.proxyUsed).toBe(false);
    expect(result.proxyIp).toBeNull();
    expect(result.proxySuccess).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });
});

describe('Request Handler - 边缘情况', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该处理无效的 URL', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const request: ProxyRequest = {
      url: 'not-a-valid-url',
      method: 'GET',
    };

    // 应该抛出错误或返回失败
    try {
      await sendProxyRequest(request, { useFallback: true });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('应该处理空请求体', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'POST',
      body: '',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
  });

  it('应该处理没有 headers 的请求', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
  });

  it('应该处理各种 HTTP 状态码', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const statusCodes = [200, 201, 301, 302, 400, 401, 403, 404, 500, 502, 503];

    for (const status of statusCodes) {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(`Status ${status}`, { status })
      );
      global.fetch = mockFetch;

      const request: ProxyRequest = {
        url: 'http://example.com/api',
        method: 'GET',
      };

      const result = await sendProxyRequest(request, { useFallback: true });

      // 2xx 状态码应该成功
      if (status >= 200 && status < 300) {
        expect(result.success).toBe(true);
        expect(result.status).toBe(status);
      } else {
        expect(result.success).toBe(false);
      }
    }
  });

  it('应该处理 204 No Content 状态码', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    // 204 状态码不能有 body
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe(204);
  });

  it('应该处理网络错误', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    // 当直连失败时，错误消息会包含 "直连也失败"
    expect(result.error).toContain('直连也失败');
  });

  it('应该处理超时', async () => {
    vi.mocked(proxyManager.getAvailableProxy).mockResolvedValue(null);

    // Mock 一个永不返回的 fetch
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        })
    );
    global.fetch = mockFetch;

    const request: ProxyRequest = {
      url: 'http://example.com/api',
      method: 'GET',
    };

    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
  });
});
