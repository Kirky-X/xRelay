/**
 * 单元测试 - 不依赖网络
 */

import { describe, it, expect } from "vitest";

// ============ 测试配置模块 ============
describe("Config", () => {
  it("应该导出正确的配置", async () => {
    const { PROXY_CONFIG, RATE_LIMIT_CONFIG, CACHE_CONFIG, FEATURES } =
      await import("../config");

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
describe("RateLimiter", () => {
  it("应该正确检查全局限流", async () => {
    const { checkGlobalRateLimit } = await import("../rate-limiter");

    const result = checkGlobalRateLimit();
    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("remaining");
    expect(result).toHaveProperty("resetIn");
    expect(typeof result.allowed).toBe("boolean");
    expect(typeof result.remaining).toBe("number");
  });

  it("应该正确检查IP限流", async () => {
    const { checkIpRateLimit } = await import("../rate-limiter");

    const result = checkIpRateLimit("192.168.1.1");
    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("remaining");
    expect(result).toHaveProperty("resetIn");
  });

  it("不同的IP应该有不同的计数", async () => {
    const { checkIpRateLimit } = await import("../rate-limiter");

    const result1 = checkIpRateLimit("10.0.0.1");
    const result2 = checkIpRateLimit("10.0.0.2");

    expect(result1.remaining).toBeLessThanOrEqual(5);
    expect(result2.remaining).toBeLessThanOrEqual(5);
  });

  it("应该获取限流状态", async () => {
    const { getRateLimitStatus } = await import("../rate-limiter");

    const status = getRateLimitStatus();
    expect(status.global).toHaveProperty("limit");
    expect(status.global).toHaveProperty("windowMs");
    expect(status.ip).toHaveProperty("limit");
  });
});

// ============ 测试缓存模块 ============
describe("Cache", () => {
  it("应该正确缓存和获取响应", async () => {
    const { getCachedResponse, cacheResponse, getCacheStatus } =
      await import("../cache");

    const testUrl = "https://example.com/test";
    const testMethod = "GET";
    const testResponse = { success: true, data: "test data" };

    // 初始状态
    const status1 = getCacheStatus();
    expect(status1.size).toBe(0);

    // 缓存响应
    cacheResponse(testUrl, testMethod, testResponse);

    // 检查缓存命中
    const cached = getCachedResponse(testUrl, testMethod);
    expect(cached).not.toBeNull();
    expect(cached?.success).toBe(true);
    expect(cached?.data).toBe("test data");

    // 状态更新
    const status2 = getCacheStatus();
    expect(status2.size).toBeGreaterThan(0);
  });

  it("应该返回null对于不存在的缓存", async () => {
    const { getCachedResponse } = await import("../cache");

    const cached = getCachedResponse("https://notexist.com", "GET");
    expect(cached).toBeNull();
  });

  it("应该获取缓存状态", async () => {
    const { getCacheStatus } = await import("../cache");

    const status = getCacheStatus();
    expect(status).toHaveProperty("size");
    expect(status).toHaveProperty("maxSize");
    expect(status).toHaveProperty("ttlMs");
  });

  it("应该能够清除缓存", async () => {
    const { cacheResponse, clearCache, getCacheStatus } =
      await import("../cache");

    // 写入缓存
    cacheResponse("https://example.com/1", "GET", { success: true });
    cacheResponse("https://example.com/2", "GET", { success: true });

    // 清除
    clearCache();

    // 验证清除
    const status = getCacheStatus();
    expect(status.size).toBe(0);
  });
});

// ============ 测试代理信息类型 ============
describe("ProxyInfo", () => {
  it("应该正确创建代理信息对象", async () => {
    const { PROXY_SOURCES } = await import("../proxy-fetcher");

    expect(PROXY_SOURCES).toBeInstanceOf(Array);
    expect(PROXY_SOURCES.length).toBeGreaterThan(0);

    PROXY_SOURCES.forEach((source) => {
      expect(source).toHaveProperty("name");
      expect(source).toHaveProperty("url");
      expect(source).toHaveProperty("parse");
      expect(typeof source.name).toBe("string");
      expect(typeof source.url).toBe("string");
      expect(typeof source.parse).toBe("function");
    });
  });
});

// ============ 测试代理解析器 ============
describe("Proxy Parser", () => {
  it("应该正确解析代理列表", async () => {
    const { PROXY_SOURCES } = await import("../proxy-fetcher");

    const testProxyList = `
192.168.1.1:8080
192.168.1.2:8080
192.168.1.3:8080
    `.trim();

    const source = PROXY_SOURCES[0];
    const result = source.parse(testProxyList);

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBe("192.168.1.1:8080");
  });

  it("应该过滤无效行", async () => {
    const { PROXY_SOURCES } = await import("../proxy-fetcher");

    const testProxyList = `
192.168.1.1:8080
invalid-line
192.168.1.2:8080
    `.trim();

    const source = PROXY_SOURCES[0];
    const result = source.parse(testProxyList);

    expect(result.length).toBe(2);
    expect(result[0]).toBe("192.168.1.1:8080");
  });
});

// ============ 测试安全配置 ============
describe("Security Config", () => {
  it("应该导出安全配置", async () => {
    const { SECURITY_CONFIG } = await import("../config");

    expect(SECURITY_CONFIG).toBeDefined();
    expect(SECURITY_CONFIG.allowedDomains).toBeInstanceOf(Array);
    expect(SECURITY_CONFIG.allowedProtocols).toBeInstanceOf(Array);
    expect(SECURITY_CONFIG.blockedIpRanges).toBeInstanceOf(Array);
    expect(SECURITY_CONFIG.maxRequestSize).toBeGreaterThan(0);
    expect(typeof SECURITY_CONFIG.enableVerboseLogging).toBe("boolean");
  });

  it("应该包含内网地址黑名单", async () => {
    const { SECURITY_CONFIG } = await import("../config");

    expect(SECURITY_CONFIG.blockedIpRanges).toContain("127.0.0.0/8");
    expect(SECURITY_CONFIG.blockedIpRanges).toContain("10.0.0.0/8");
    expect(SECURITY_CONFIG.blockedIpRanges).toContain("172.16.0.0/12");
    expect(SECURITY_CONFIG.blockedIpRanges).toContain("192.168.0.0/16");
  });

  it("应该允许 HTTP 和 HTTPS 协议", async () => {
    const { SECURITY_CONFIG } = await import("../config");

    expect(SECURITY_CONFIG.allowedProtocols).toContain("http:");
    expect(SECURITY_CONFIG.allowedProtocols).toContain("https:");
  });
});

// ============ 测试 URL 验证（SSRF 防护） ============
describe("URL Validation", () => {
  it("应该允许有效的公网 URL", async () => {
    const { validateUrl } = await import("../security");

    const result1 = validateUrl("https://example.com");
    const result2 = validateUrl("http://api.example.com/path");
    const result3 = validateUrl("https://8.8.8.8");

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
    expect(result3.valid).toBe(true);
  });

  it("应该阻止 localhost", async () => {
    const { validateUrl } = await import("../security");

    const result1 = validateUrl("http://localhost");
    const result2 = validateUrl("http://localhost:8080");
    const result3 = validateUrl("http://test.localhost");

    expect(result1.valid).toBe(false);
    expect(result2.valid).toBe(false);
    expect(result3.valid).toBe(false);
  });

  it("应该阻止内网 IPv4 地址", async () => {
    const { validateUrl } = await import("../security");

    // Loopback
    expect(validateUrl("http://127.0.0.1").valid).toBe(false);
    expect(validateUrl("http://127.0.0.1:8080").valid).toBe(false);

    // Private Class A (10.0.0.0/8)
    expect(validateUrl("http://10.0.0.1").valid).toBe(false);
    expect(validateUrl("http://10.255.255.255").valid).toBe(false);

    // Private Class B (172.16.0.0/12)
    expect(validateUrl("http://172.16.0.1").valid).toBe(false);
    expect(validateUrl("http://172.31.255.255").valid).toBe(false);

    // Private Class C (192.168.0.0/16)
    expect(validateUrl("http://192.168.0.1").valid).toBe(false);
    expect(validateUrl("http://192.168.255.255").valid).toBe(false);

    // Link-local (169.254.0.0/16)
    expect(validateUrl("http://169.254.0.1").valid).toBe(false);
  });

  it("应该阻止内网 IPv6 地址", async () => {
    const { validateUrl } = await import("../security");

    // IPv6 Loopback
    expect(validateUrl("http://[::1]").valid).toBe(false);

    // IPv6 Private (fc00::/7)
    expect(validateUrl("http://[fc00::1]").valid).toBe(false);
    expect(validateUrl("http://[fd00::1]").valid).toBe(false);

    // IPv6 Link-local (fe80::/10)
    expect(validateUrl("http://[fe80::1]").valid).toBe(false);
  });

  it("应该阻止不允许的协议", async () => {
    const { validateUrl } = await import("../security");

    expect(validateUrl("ftp://example.com").valid).toBe(false);
    expect(validateUrl("file:///etc/passwd").valid).toBe(false);
  });

  it("应该拒绝无效的 URL 格式", async () => {
    const { validateUrl } = await import("../security");

    const result = validateUrl("not-a-valid-url");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============ 测试 IP 验证 ============
describe("IP Validation", () => {
  it("应该验证公网 IPv4 地址", async () => {
    const { isValidPublicIp } = await import("../security");

    expect(isValidPublicIp("8.8.8.8")).toBe(true);
    expect(isValidPublicIp("1.1.1.1")).toBe(true);
    expect(isValidPublicIp("114.114.114.114")).toBe(true);
  });

  it("应该拒绝内网 IPv4 地址", async () => {
    const { isValidPublicIp } = await import("../security");

    expect(isValidPublicIp("127.0.0.1")).toBe(false);
    expect(isValidPublicIp("10.0.0.1")).toBe(false);
    expect(isValidPublicIp("172.16.0.1")).toBe(false);
    expect(isValidPublicIp("192.168.1.1")).toBe(false);
  });

  it("应该拒绝无效的 IPv4 地址", async () => {
    const { isValidPublicIp } = await import("../security");

    expect(isValidPublicIp("256.0.0.1")).toBe(false);
    expect(isValidPublicIp("invalid")).toBe(false);
    expect(isValidPublicIp("")).toBe(false);
  });
});

// ============ 测试限流清理 ============
describe("Rate Limiter Cleanup", () => {
  it("应该清理过期的限流记录", async () => {
    const { cleanupRateLimits, checkIpRateLimit } =
      await import("../rate-limiter");

    // 创建一些限流记录
    checkIpRateLimit("192.168.1.1");
    checkIpRateLimit("192.168.1.2");
    checkIpRateLimit("192.168.1.3");

    // 清理应该不会报错
    expect(() => cleanupRateLimits()).not.toThrow();
  });

  it("应该获取限流状态", async () => {
    const { getRateLimitStatus } = await import("../rate-limiter");

    const status = getRateLimitStatus();
    expect(status).toHaveProperty("global");
    expect(status).toHaveProperty("ip");
    expect(status.global.limit).toBeGreaterThan(0);
    expect(status.ip.limit).toBeGreaterThan(0);
  });
});

// ============ 测试代理测试配置 ============
describe("Proxy Test Config", () => {
  it("应该导出代理测试配置", async () => {
    const { PROXY_TEST_CONFIG } = await import("../config");

    expect(PROXY_TEST_CONFIG).toBeDefined();
    expect(PROXY_TEST_CONFIG.testTimeout).toBeGreaterThan(0);
    expect(PROXY_TEST_CONFIG.testUrl).toBeDefined();
    expect(PROXY_TEST_CONFIG.blacklistDuration).toBeGreaterThan(0);
    expect(PROXY_TEST_CONFIG.quickTestTimeout).toBeGreaterThan(0);
  });

  it("应该导出请求超时配置", async () => {
    const { REQUEST_TIMEOUT_CONFIG } = await import("../config");

    expect(REQUEST_TIMEOUT_CONFIG).toBeDefined();
    expect(REQUEST_TIMEOUT_CONFIG.proxy).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_CONFIG.direct).toBeGreaterThan(0);
  });
});
