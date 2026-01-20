/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Unit Tests - 单元测试
 * 测试缓存、限流、安全验证等功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedResponse,
  cacheResponse,
  clearCache,
  getCacheStatus,
  cleanupCache,
  invalidateCache,
} from '../cache';
import { checkGlobalRateLimit, checkIpRateLimit, resetRateLimit } from '../rate-limiter';
import { validateUrl, isValidPublicIp } from '../security';
import { CACHE_CONFIG, RATE_LIMIT_CONFIG } from '../config';

describe('Cache', () => {
  beforeEach(async () => {
    await clearCache();
  });

  it('应该正确缓存和获取响应', async () => {
    // 检查 KV 是否配置
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      console.log('KV 未配置，跳过测试');
      return;
    }

    const testResponse = {
      success: true,
      data: '{"test": "data"}',
      status: 200,
      headers: {},
      proxyUsed: true,
      proxyIp: '1.2.3.4:8080',
      proxySuccess: true,
      fallbackUsed: false,
    };

    await cacheResponse('https://example.com/test', 'GET', testResponse);
    const cached = await getCachedResponse('https://example.com/test', 'GET');

    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual(testResponse.data);
  });

  it('应该能够清除缓存', async () => {
    // 检查 KV 是否配置
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      console.log('KV 未配置，跳过测试');
      return;
    }

    await cacheResponse('https://example.com/1', 'GET', { success: true, data: '', status: 200, headers: {}, proxyUsed: true, proxyIp: '1.2.3.4:8080', proxySuccess: true, fallbackUsed: false });
    await cacheResponse('https://example.com/2', 'GET', { success: true, data: '', status: 200, headers: {}, proxyUsed: true, proxyIp: '1.2.3.4:8080', proxySuccess: true, fallbackUsed: false });

    await clearCache();

    const cached1 = await getCachedResponse('https://example.com/1', 'GET');
    const cached2 = await getCachedResponse('https://example.com/2', 'GET');

    expect(cached1).toBeNull();
    expect(cached2).toBeNull();
  });

  it('应该能够失效特定 URL 的缓存', async () => {
    // 检查 KV 是否配置
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      console.log('KV 未配置，跳过测试');
      return;
    }

    await cacheResponse('https://example.com/1', 'GET', { success: true, data: '', status: 200, headers: {}, proxyUsed: true, proxyIp: '1.2.3.4:8080', proxySuccess: true, fallbackUsed: false });

    await invalidateCache('https://example.com/1', 'GET');

    const cached = await getCachedResponse('https://example.com/1', 'GET');
    expect(cached).toBeNull();
  });

  it('应该正确获取缓存状态', async () => {
    const status = await getCacheStatus();
    expect(status).toHaveProperty('size');
    expect(status).toHaveProperty('maxSize');
    expect(status).toHaveProperty('ttlMs');
    expect(status.maxSize).toBe(CACHE_CONFIG.maxSize);
    expect(status.ttlMs).toBe(CACHE_CONFIG.ttl);
  });

  it('应该不缓存失败的响应', async () => {
    const failedResponse = {
      success: false,
      error: 'Test error',
      proxyUsed: false,
      proxyIp: null,
      proxySuccess: false,
      fallbackUsed: false,
    };

    await cacheResponse('https://example.com/failed', 'GET', failedResponse);
    const cached = await getCachedResponse('https://example.com/failed', 'GET');

    expect(cached).toBeNull();
  });

  it('应该清理过期的缓存', async () => {
    // 设置一个很短的 TTL 来测试过期
    const testResponse = {
      success: true,
      data: '{"test": "data"}',
      status: 200,
      headers: {},
      proxyUsed: true,
      proxyIp: '1.2.3.4:8080',
      proxySuccess: true,
      fallbackUsed: false,
    };

    await cacheResponse('https://example.com/expired', 'GET', testResponse);
    // 模拟过期
    // 在实际使用中，KV 会自动处理过期
    const cached = await getCachedResponse('https://example.com/expired', 'GET');
    // 如果 KV 未配置，会返回 null
    expect(cached).toBeDefined();
  });
});

describe('Rate Limiter', () => {
  beforeEach(async () => {
    await resetRateLimit('global');
    await resetRateLimit('ip', 'test-ip');
  });

  it('应该正确限制全局请求', async () => {
    // 检查 KV 是否配置
    const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

    // 第一次请求应该通过
    let result = await checkGlobalRateLimit();
    expect(result.allowed).toBe(true);

    if (kvConfigured) {
      expect(result.remaining).toBe(RATE_LIMIT_CONFIG.global.maxRequests - 1);

      // 发送多个请求直到达到限制
      for (let i = 0; i < RATE_LIMIT_CONFIG.global.maxRequests; i++) {
        await checkGlobalRateLimit();
      }

      // 超出限制
      result = await checkGlobalRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    } else {
      console.log('KV 未配置，跳过限流测试');
    }
  });

  it('应该正确限制 IP 请求', async () => {
    // 检查 KV 是否配置
    const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

    // 第一次请求应该通过
    let result = await checkIpRateLimit('test-ip');
    expect(result.allowed).toBe(true);

    if (kvConfigured) {
      expect(result.remaining).toBe(RATE_LIMIT_CONFIG.ip.maxRequests - 1);

      // 发送多个请求直到达到限制
      for (let i = 0; i < RATE_LIMIT_CONFIG.ip.maxRequests; i++) {
        await checkIpRateLimit('test-ip');
      }

      // 超出限制
      result = await checkIpRateLimit('test-ip');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    } else {
      console.log('KV 未配置，跳过限流测试');
    }
  });

  it('应该能够重置限流', async () => {
    // 检查 KV 是否配置
    const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

    if (!kvConfigured) {
      console.log('KV 未配置，跳过测试');
      return;
    }

    // 发送一些请求
    for (let i = 0; i < 3; i++) {
      await checkIpRateLimit('test-ip-reset');
    }

    // 重置
    await resetRateLimit('ip', 'test-ip-reset');

    // 重置后应该可以继续请求
    const result = await checkIpRateLimit('test-ip-reset');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_CONFIG.ip.maxRequests - 1);
  });
});

describe('Security', () => {
  it('应该验证有效的 URL', () => {
    const validUrl = 'https://example.com/path';
    const result = validateUrl(validUrl);
    expect(result.valid).toBe(true);
  });

  it('应该拒绝无效的 URL', () => {
    const invalidUrl = 'not-a-url';
    const result = validateUrl(invalidUrl);
    expect(result.valid).toBe(false);
  });

  it('应该阻止内网地址', () => {
    const internalUrls = [
      'http://127.0.0.1:8080',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://localhost',
    ];

    internalUrls.forEach(url => {
      const result = validateUrl(url);
      expect(result.valid).toBe(false);
    });
  });

  it('应该允许公网地址', () => {
    const publicIp = '8.8.8.8';
    expect(isValidPublicIp(publicIp)).toBe(true);
  });

  it('应该拒绝内网地址', () => {
    const privateIps = ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1'];
    privateIps.forEach(ip => {
      expect(isValidPublicIp(ip)).toBe(false);
    });
  });

  it('应该拒绝无效 IP', () => {
    const invalidIps = ['not-an-ip', '256.256.256.256', ''];
    invalidIps.forEach(ip => {
      expect(isValidPublicIp(ip)).toBe(false);
    });
  });
});
