/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Unit Tests - 单元测试
 * 测试安全验证功能
 *
 * 说明：
 * - KV 分布式限流（src/rate-limiter.ts）已移除，
 *   统一为 src/middleware/rate-limit.ts 的内存限流，
 *   相关测试位于 tests/middleware/rate-limit.test.ts
 * - Cache 模块的测试已随 src/cache.ts 全局缓存层一同移除
 *   （业务代码统一使用 ProxyService 内部的 AdvancedCache）
 */

import { describe, it, expect } from "vitest";
import { validateUrl, isValidPublicIp } from "../security";

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
