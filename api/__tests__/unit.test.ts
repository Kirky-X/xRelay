/**
 * 单元测试 - 不依赖网络
 */

import { describe, it, expect } from 'vitest';

// ============ 测试配置模块 ============
describe('Config', () => {
  it('应该导出正确的配置', async () => {
    const { PROXY_CONFIG, RATE_LIMIT_CONFIG, CACHE_CONFIG, FEATURES } = await import('../config');

    expect(PROXY_CONFIG).toBeDefined();
    expect(PROXY_CONFIG.sources).toBeInstanceOf(Array);
    expect(PROXY_CONFIG.sources.length).toBeGreaterThan(0);

    expect(RATE_LIMIT_CONFIG.global.maxRequests).toBe(10);
    expect(RATE_LIMIT_CONFIG.ip.maxRequests).toBe(5);

    expect(CACHE_CONFIG.ttl).toBe(5 * 60 * 1000);
    expect(FEATURES.enableFallback).toBe(true);
  });
});

// ============ 测试限流模块 ============
describe('RateLimiter', () => {
  it('应该正确检查全局限流', async () => {
    const { checkGlobalRateLimit } = await import('../rate-limiter');

    const result = checkGlobalRateLimit();
    expect(result).toHaveProperty('allowed');
    expect(result).toHaveProperty('remaining');
    expect(result).toHaveProperty('resetIn');
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.remaining).toBe('number');
  });

  it('应该正确检查IP限流', async () => {
    const { checkIpRateLimit } = await import('../rate-limiter');

    const result = checkIpRateLimit('192.168.1.1');
    expect(result).toHaveProperty('allowed');
    expect(result).toHaveProperty('remaining');
    expect(result).toHaveProperty('resetIn');
  });

  it('不同的IP应该有不同的计数', async () => {
    const { checkIpRateLimit } = await import('../rate-limiter');

    const result1 = checkIpRateLimit('10.0.0.1');
    const result2 = checkIpRateLimit('10.0.0.2');

    expect(result1.remaining).toBeLessThanOrEqual(5);
    expect(result2.remaining).toBeLessThanOrEqual(5);
  });

  it('应该获取限流状态', async () => {
    const { getRateLimitStatus } = await import('../rate-limiter');

    const status = getRateLimitStatus();
    expect(status.global).toHaveProperty('limit');
    expect(status.global).toHaveProperty('windowMs');
    expect(status.ip).toHaveProperty('limit');
  });
});

// ============ 测试缓存模块 ============
describe('Cache', () => {
  it('应该正确缓存和获取响应', async () => {
    const { getCachedResponse, cacheResponse, getCacheStatus } = await import('../cache');

    const testUrl = 'https://example.com/test';
    const testMethod = 'GET';
    const testResponse = { success: true, data: 'test data' };

    // 初始状态
    const status1 = getCacheStatus();
    expect(status1.size).toBe(0);

    // 缓存响应
    cacheResponse(testUrl, testMethod, testResponse);

    // 检查缓存命中
    const cached = getCachedResponse(testUrl, testMethod);
    expect(cached).not.toBeNull();
    expect(cached?.success).toBe(true);
    expect(cached?.data).toBe('test data');

    // 状态更新
    const status2 = getCacheStatus();
    expect(status2.size).toBeGreaterThan(0);
  });

  it('应该返回null对于不存在的缓存', async () => {
    const { getCachedResponse } = await import('../cache');

    const cached = getCachedResponse('https://notexist.com', 'GET');
    expect(cached).toBeNull();
  });

  it('应该获取缓存状态', async () => {
    const { getCacheStatus } = await import('../cache');

    const status = getCacheStatus();
    expect(status).toHaveProperty('size');
    expect(status).toHaveProperty('maxSize');
    expect(status).toHaveProperty('ttlMs');
  });

  it('应该能够清除缓存', async () => {
    const { cacheResponse, clearCache, getCacheStatus } = await import('../cache');

    // 写入缓存
    cacheResponse('https://example.com/1', 'GET', { success: true });
    cacheResponse('https://example.com/2', 'GET', { success: true });

    // 清除
    clearCache();

    // 验证清除
    const status = getCacheStatus();
    expect(status.size).toBe(0);
  });
});

// ============ 测试代理信息类型 ============
describe('ProxyInfo', () => {
  it('应该正确创建代理信息对象', async () => {
    const { PROXY_SOURCES } = await import('../proxy-fetcher');

    expect(PROXY_SOURCES).toBeInstanceOf(Array);
    expect(PROXY_SOURCES.length).toBeGreaterThan(0);

    PROXY_SOURCES.forEach(source => {
      expect(source).toHaveProperty('name');
      expect(source).toHaveProperty('url');
      expect(source).toHaveProperty('parse');
      expect(typeof source.name).toBe('string');
      expect(typeof source.url).toBe('string');
      expect(typeof source.parse).toBe('function');
    });
  });
});

// ============ 测试代理解析器 ============
describe('Proxy Parser', () => {
  it('应该正确解析代理列表', async () => {
    const { PROXY_SOURCES } = await import('../proxy-fetcher');

    const testProxyList = `
192.168.1.1:8080
192.168.1.2:8080
192.168.1.3:8080
    `.trim();

    const source = PROXY_SOURCES[0];
    const result = source.parse(testProxyList);

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBe('192.168.1.1:8080');
  });

  it('应该过滤无效行', async () => {
    const { PROXY_SOURCES } = await import('../proxy-fetcher');

    const testProxyList = `
192.168.1.1:8080
invalid-line
192.168.1.2:8080
    `.trim();

    const source = PROXY_SOURCES[0];
    const result = source.parse(testProxyList);

    expect(result.length).toBe(2);
    expect(result[0]).toBe('192.168.1.1:8080');
  });
});
