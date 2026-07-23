/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limit 测试 - 验证内存限流的核心行为
 *
 * 测试目标：src/middleware/rate-limit.ts 的 checkRateLimit / getClientIpFromRequest
 *
 * 设计说明：
 * - rateLimitStore / captureRateLimitStore 为模块私有状态，
 *   每个用例使用唯一 IP（基于用例序号）以隔离相互影响
 * - 顶部 mock 默认开启限流；用例内 doMock + 动态 import 用于覆盖 enableRateLimit=false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 可变的 FEATURES 引用（用例内可翻转 enableRateLimit）
const { featuresRef } = vi.hoisted(() => ({
  featuresRef: { enableRateLimit: true },
}));

vi.mock("../../src/config.js", () => ({
  FEATURES: featuresRef,
  CORS_CONFIG: { allowedOrigins: [] },
  RATE_LIMIT_CONFIG: {
    global: { maxRequests: 100, windowMs: 60000 },
    ip: { maxRequests: 100, windowMs: 60000 },
  },
}));

import { checkRateLimit, getClientIpFromRequest } from "../../src/middleware/rate-limit.js";

// 唯一 IP 生成器：使用 203.0.113.0/24 与 198.51.100.0/24 两个 TEST-NET 网段循环
// （RFC 5737 文档示例网段，不会与真实公网冲突，且格式合法不会被降级）
let caseSeq = 0;
function uniqueIp(): string {
  caseSeq += 1;
  const n = caseSeq;
  if (n <= 250) return `203.0.113.${n}`;
  return `198.51.100.${n - 250}`;
}

describe("checkRateLimit - 内存限流", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次请求应放行并扣减剩余配额", () => {
    const r = checkRateLimit(uniqueIp());
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99);
    expect(r.resetAt).toBeGreaterThan(Date.now());
  });

  it("达到上限后应拒绝", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 100; i++) {
      const r = checkRateLimit(ip);
      expect(r.allowed).toBe(true);
    }
    const over = checkRateLimit(ip);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("capture 端点应使用更严格配额 (30)", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(ip, "capture").allowed).toBe(true);
    }
    expect(checkRateLimit(ip, "capture").allowed).toBe(false);
  });

  it("default 与 capture 端点的计数应相互独立", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 100; i++) checkRateLimit(ip); // default 满
    expect(checkRateLimit(ip).allowed).toBe(false);
    expect(checkRateLimit(ip, "capture").allowed).toBe(true); // capture 仍可用
  });

  it("无效 IP 应被降级为 1/10 配额", () => {
    const invalid = `invalid-${caseSeq++}`;
    const limit = Math.floor(100 / 10);
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit(invalid).allowed).toBe(true);
    }
    expect(checkRateLimit(invalid).allowed).toBe(false);
  });

  it("'unknown' IP 同样被降级", () => {
    // 'unknown' 是固定字符串，跨用例会累积；本用例只验证首次进入即被识别为降级路径
    // 之前的 IP 测试用了 unknown，这里用一个新的子串避免累积影响断言
    // 实际策略：unknown 是固定值，多个用例间会累积，但我们只断言 remaining 被降级
    const r = checkRateLimit("unknown");
    expect(r.allowed).toBe(true);
    // 降级配额 = floor(100/10) = 10；首次进入后剩余 9
    expect(r.remaining).toBeLessThanOrEqual(9);
  });

  it("不同 IP 的计数互不影响", () => {
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    for (let i = 0; i < 50; i++) checkRateLimit(ipA);
    expect(checkRateLimit(ipA).remaining).toBe(49);
    expect(checkRateLimit(ipB).remaining).toBe(99);
  });

  it("IPv6 地址应被识别为有效（满配额）", () => {
    const ip = `2001:db8::${caseSeq++}`;
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99); // 满配额（非降级）
  });

  it("FEATURES.enableRateLimit=false 时应直接放行不扣减", () => {
    const prev = featuresRef.enableRateLimit;
    featuresRef.enableRateLimit = false;
    try {
      const r = checkRateLimit(uniqueIp());
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(100); // 不扣减
    } finally {
      featuresRef.enableRateLimit = prev;
    }
  });
});

describe("getClientIpFromRequest", () => {
  it("应优先读取 x-forwarded-for 第一个 IP", () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(getClientIpFromRequest(req)).toBe("1.1.1.1");
  });

  it("无 x-forwarded-for 时回退到 x-real-ip", () => {
    const req = new Request("http://test", {
      headers: { "x-real-ip": "3.3.3.3" },
    });
    expect(getClientIpFromRequest(req)).toBe("3.3.3.3");
  });

  it("无任何 IP 头时应返回 'unknown'", () => {
    const req = new Request("http://test");
    expect(getClientIpFromRequest(req)).toBe("unknown");
  });

  it("应支持 Cloudflare cf-connecting-ip 头", () => {
    const req = new Request("http://test", {
      headers: { "cf-connecting-ip": "4.4.4.4" },
    });
    expect(getClientIpFromRequest(req)).toBe("4.4.4.4");
  });
});
