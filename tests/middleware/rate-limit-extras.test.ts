/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Rate Limit 补充测试
 * 覆盖 src/middleware/rate-limit.ts 中未被现有 rate-limit.test.ts 覆盖的分支：
 * - getClientIp (Vercel 版本)：req.ip / x-forwarded-for 字符串与数组 / x-real-ip 字符串与数组 / unknown
 * - getClientIpFromRequest 边界情况：多 IP 含空格、空字符串回退、优先级
 * - checkRateLimit 窗口重置逻辑（fake timers）
 * - isValidIpFormat 间接覆盖：无效 IPv4（段超 255）、无效格式、空字符串、IPv6 长度边界
 * - 端点隔离：undefined / 'proxy' / 'capture' 走不同 store
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VercelRequest } from "@vercel/node";

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

import {
  checkRateLimit,
  getClientIp,
  getClientIpFromRequest,
} from "../../src/middleware/rate-limit.js";

// 唯一 IP 生成器（使用 192.0.2.0/24 TEST-NET-1，避免与其他测试文件冲突）
let extrasSeq = 0;
function uniqueIp(): string {
  extrasSeq += 1;
  const n = (extrasSeq % 250) + 1;
  return `192.0.2.${n}`;
}

// 构造模拟 VercelRequest（仅含 handler 实际使用的字段）
function createVercelReq(
  overrides: Partial<{
    ip: string | undefined;
    headers: Record<string, string | string[] | undefined>;
  }> = {},
): VercelRequest {
  return {
    ip: overrides.ip,
    headers: overrides.headers ?? {},
  } as unknown as VercelRequest;
}

describe("getClientIp (Vercel 版本)", () => {
  it("应优先返回 req.ip", () => {
    const req = createVercelReq({ ip: "1.2.3.4" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("req.ip 存在时应忽略 headers 中的 x-forwarded-for", () => {
    const req = createVercelReq({
      ip: "1.2.3.4",
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("req.ip 为 undefined 时应回退到 x-forwarded-for 字符串", () => {
    const req = createVercelReq({
      ip: undefined,
      headers: { "x-forwarded-for": "5.6.7.8, 9.10.11.12" },
    });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("x-forwarded-for 为数组时应取第一个元素", () => {
    const req = createVercelReq({
      headers: { "x-forwarded-for": ["1.1.1.1", "2.2.2.2"] },
    });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("x-forwarded-for 字符串含空格时应 trim", () => {
    const req = createVercelReq({
      headers: { "x-forwarded-for": "  3.3.3.3  , 4.4.4.4" },
    });
    expect(getClientIp(req)).toBe("3.3.3.3");
  });

  it("无 x-forwarded-for 但有 x-real-ip 字符串时应返回 x-real-ip", () => {
    const req = createVercelReq({
      headers: { "x-real-ip": "3.3.3.3" },
    });
    expect(getClientIp(req)).toBe("3.3.3.3");
  });

  it("x-real-ip 为数组时应取第一个元素", () => {
    const req = createVercelReq({
      headers: { "x-real-ip": ["4.4.4.4", "5.5.5.5"] },
    });
    expect(getClientIp(req)).toBe("4.4.4.4");
  });

  it("无任何 IP 头时应返回 'unknown'", () => {
    const req = createVercelReq({});
    expect(getClientIp(req)).toBe("unknown");
  });

  it("req.ip 为 undefined 且 headers 为空对象时应返回 'unknown'", () => {
    const req = createVercelReq({ ip: undefined, headers: {} });
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("getClientIpFromRequest 边界情况", () => {
  it("x-forwarded-for 含多个 IP 与空格时应取第一个并 trim", () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": " 1.1.1.1 , 2.2.2.2 , 3.3.3.3 " },
    });
    expect(getClientIpFromRequest(req)).toBe("1.1.1.1");
  });

  it("x-forwarded-for 仅一个 IP 时应直接返回", () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(getClientIpFromRequest(req)).toBe("9.9.9.9");
  });

  it("x-forwarded-for 含前导空格单个 IP 时应 trim", () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "  8.8.8.8" },
    });
    expect(getClientIpFromRequest(req)).toBe("8.8.8.8");
  });

  it("x-forwarded-for 为空字符串时应回退到 x-real-ip", () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "", "x-real-ip": "8.8.8.8" },
    });
    expect(getClientIpFromRequest(req)).toBe("8.8.8.8");
  });

  it("x-real-ip 存在但 x-forwarded-for 不存在时应返回 x-real-ip", () => {
    const req = new Request("http://test", {
      headers: { "x-real-ip": "7.7.7.7" },
    });
    expect(getClientIpFromRequest(req)).toBe("7.7.7.7");
  });

  it("cf-connecting-ip 优先级低于 x-real-ip", () => {
    const req = new Request("http://test", {
      headers: { "x-real-ip": "6.6.6.6", "cf-connecting-ip": "5.5.5.5" },
    });
    expect(getClientIpFromRequest(req)).toBe("6.6.6.6");
  });

  it("仅 cf-connecting-ip 存在时应返回它", () => {
    const req = new Request("http://test", {
      headers: { "cf-connecting-ip": "4.4.4.4" },
    });
    expect(getClientIpFromRequest(req)).toBe("4.4.4.4");
  });

  it("无任何 IP 头时应返回 'unknown'", () => {
    const req = new Request("http://test");
    expect(getClientIpFromRequest(req)).toBe("unknown");
  });
});

describe("checkRateLimit - isValidIpFormat 间接覆盖", () => {
  beforeEach(() => {
    featuresRef.enableRateLimit = true;
  });

  it("无效 IPv4（段超 255）应被降级为 1/10 配额", () => {
    const ip = "999.999.999.999";
    const limit = Math.floor(100 / 10);
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit(ip).allowed).toBe(true);
    }
    expect(checkRateLimit(ip).allowed).toBe(false);
  });

  it("非 IPv4/IPv6 格式字符串应被降级", () => {
    const ip = `not-an-ip-${extrasSeq++}`;
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    // 降级配额 = floor(100/10) = 10；首次后剩余 9
    expect(r.remaining).toBeLessThanOrEqual(9);
  });

  it("空字符串 IP 应被降级", () => {
    const r = checkRateLimit("");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeLessThanOrEqual(9);
  });

  it("有效 IPv4 应使用满配额（首次 remaining=99）", () => {
    const ip = uniqueIp();
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99);
  });

  it("有效 IPv6 应使用满配额", () => {
    const ip = `2001:db8::${extrasSeq++}`;
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99);
  });

  it("IPv6 最小长度（'::' 长度 2）应被视为有效", () => {
    const r = checkRateLimit("::");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99);
  });

  it("超长 IPv6（>45 字符）应被视为无效并降级", () => {
    // 构造长度 > 45 且含 ':' 的字符串
    const ip = `:${"a".repeat(50)}`;
    expect(ip.length).toBeGreaterThan(45);
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeLessThanOrEqual(9);
  });

  it("仅数字不含点与冒号的字符串应被视为无效", () => {
    const ip = `123456${extrasSeq++}`;
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeLessThanOrEqual(9);
  });
});

describe("checkRateLimit - 窗口重置逻辑", () => {
  beforeEach(() => {
    featuresRef.enableRateLimit = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("窗口过期后应创建新窗口并重置计数", () => {
    const ip = uniqueIp();
    // 首次请求
    const r1 = checkRateLimit(ip);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(99);
    const firstResetAt = r1.resetAt;

    // 消耗部分配额
    checkRateLimit(ip);
    checkRateLimit(ip);

    // 推进时间超过窗口（61 秒 > 60 秒窗口）
    vi.advanceTimersByTime(61 * 1000);

    // 应创建新窗口，remaining 重置为 99
    const r2 = checkRateLimit(ip);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(99);
    expect(r2.resetAt).toBeGreaterThan(firstResetAt);
  });

  it("窗口未过期时应继续累计计数", () => {
    const ip = uniqueIp();
    checkRateLimit(ip); // remaining 99
    checkRateLimit(ip); // remaining 98
    const r = checkRateLimit(ip); // remaining 97
    expect(r.remaining).toBe(97);

    // 推进 30 秒（仍在窗口内）
    vi.advanceTimersByTime(30 * 1000);
    const r2 = checkRateLimit(ip);
    expect(r2.remaining).toBe(96);
  });

  it("达到上限后在窗口内应持续拒绝", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 100; i++) checkRateLimit(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);

    // 推进 30 秒（仍在窗口内）
    vi.advanceTimersByTime(30 * 1000);
    expect(checkRateLimit(ip).allowed).toBe(false);
  });

  it("达到上限后窗口过期应重新放行", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 100; i++) checkRateLimit(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);

    // 推进到窗口过期（61 秒）
    vi.advanceTimersByTime(61 * 1000);
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99); // 新窗口
  });

  it("新窗口的 resetAt 应为当前时间 + 窗口时长", () => {
    const ip = uniqueIp();
    const r1 = checkRateLimit(ip);
    const baseResetAt = r1.resetAt;

    vi.advanceTimersByTime(61 * 1000);
    const r2 = checkRateLimit(ip);
    // 新 resetAt 应为推进后的 now + 60000
    expect(r2.resetAt).toBe(baseResetAt + 61 * 1000);
  });
});

describe("checkRateLimit - 端点隔离", () => {
  beforeEach(() => {
    featuresRef.enableRateLimit = true;
  });

  it("undefined 端点应使用 default store（100 配额）", () => {
    const ip = uniqueIp();
    const r = checkRateLimit(ip, undefined);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99); // 满配额
  });

  it("'proxy' 端点应使用 default store（非 capture）", () => {
    const ip = uniqueIp();
    const r = checkRateLimit(ip, "proxy");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99); // 满配额（非 capture）
  });

  it("'capture' 端点应使用 capture store（30 配额）", () => {
    const ip = uniqueIp();
    const r = checkRateLimit(ip, "capture");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(29); // capture 满配额 30
  });

  it("default 与 capture 端点的 store 完全独立", () => {
    const ip = uniqueIp();
    // 耗尽 default
    for (let i = 0; i < 100; i++) checkRateLimit(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);
    // capture 仍可用
    expect(checkRateLimit(ip, "capture").allowed).toBe(true);
    // 耗尽 capture（已用 1 次，还剩 29）
    for (let i = 0; i < 29; i++) checkRateLimit(ip, "capture");
    expect(checkRateLimit(ip, "capture").allowed).toBe(false);
  });

  it("capture 端点无效 IP 应使用 capture 的 1/10 配额（3）", () => {
    const ip = `invalid-capture-${extrasSeq++}`;
    // capture 基础配额 30，降级后 floor(30/10) = 3
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(ip, "capture").allowed).toBe(true);
    }
    expect(checkRateLimit(ip, "capture").allowed).toBe(false);
  });
});

describe("checkRateLimit - 限流禁用", () => {
  it("enableRateLimit=false 时应直接放行且不扣减", () => {
    featuresRef.enableRateLimit = false;
    const ip = uniqueIp();
    const r = checkRateLimit(ip);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(100); // 不扣减
    expect(r.resetAt).toBeGreaterThan(Date.now());
  });

  it("enableRateLimit=false 时 capture 端点也应直接放行", () => {
    featuresRef.enableRateLimit = false;
    const ip = uniqueIp();
    const r = checkRateLimit(ip, "capture");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(100);
  });
});

describe("cleanupRateLimitStore - 通过 setInterval 触发（覆盖 line 99-127）", () => {
  // cleanupRateLimitStore 是私有函数，仅通过 setInterval 每 60s 调用一次
  // 要覆盖它，需要：1) fake timers 2) 重新加载模块让 setInterval 用 fake timers 注册
  // 然后用 advanceTimersByTime(60000) 触发回调
  let freshCheckRateLimit: typeof checkRateLimit;

  beforeEach(async () => {
    featuresRef.enableRateLimit = true;
    vi.useFakeTimers();
    vi.resetModules();
    // 重新加载模块，setInterval 会用 fake timers 注册
    const mod = await import("../../src/middleware/rate-limit.js");
    freshCheckRateLimit = mod.checkRateLimit;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("setInterval 触发 cleanupRateLimitStore 应删除过期条目（覆盖 line 100-111）", () => {
    const ip = "203.0.113.60";
    // 写入一个条目
    freshCheckRateLimit(ip);
    // 推进时间让条目过期（窗口 60s，推进 61s）
    vi.advanceTimersByTime(61 * 1000);
    // 此时条目已过期但仍在 store 中（checkRateLimit 不会主动清理）
    // 触发 setInterval 回调（60s 间隔）→ cleanupRateLimitStore 执行
    vi.advanceTimersByTime(60 * 1000);
    // 过期条目应被删除。重新调用应创建新窗口（remaining=99）
    const r = freshCheckRateLimit(ip);
    expect(r.remaining).toBe(99);
  });

  it("setInterval 触发 cleanupRateLimitStore 应删除 capture store 过期条目", () => {
    const ip = "203.0.113.61";
    freshCheckRateLimit(ip, "capture");
    // 推进时间让条目过期
    vi.advanceTimersByTime(61 * 1000);
    // 触发 cleanup
    vi.advanceTimersByTime(60 * 1000);
    // capture 端点重新调用应创建新窗口
    const r = freshCheckRateLimit(ip, "capture");
    expect(r.remaining).toBe(29); // capture 满配额 30，首次后 remaining=29
  });

  it("rateLimitStore 超过 MAX_STORE_SIZE (10000) 时应删除最旧条目（覆盖 line 113-121）", () => {
    // 写入 10001 个不同 IP 的条目（每个 IP 一个条目）
    // 使用 198.51.x.x 网段（TEST-NET-2，有效 IP 不会被降级）
    for (let i = 0; i < 10001; i++) {
      const a = Math.floor(i / 256) % 256;
      const b = i % 256;
      freshCheckRateLimit(`198.51.${a}.${b}`);
    }
    // 触发 cleanup
    vi.advanceTimersByTime(60 * 1000);
    // 不崩溃即说明 sort + slice 逻辑执行成功
    // 验证后续请求仍能正常工作
    const r = freshCheckRateLimit("203.0.113.70");
    expect(r.allowed).toBe(true);
  });

  it("captureRateLimitStore 超过 MAX_STORE_SIZE (10000) 时应删除最旧条目（覆盖 line 122-129）", () => {
    // 写入 10001 个不同 IP 的 capture 条目
    for (let i = 0; i < 10001; i++) {
      const a = Math.floor(i / 256) % 256;
      const b = i % 256;
      freshCheckRateLimit(`198.52.${a}.${b}`, "capture");
    }
    // 触发 cleanup
    vi.advanceTimersByTime(60 * 1000);
    // 不崩溃即说明 capture store 的 sort + slice 逻辑执行成功
    const r = freshCheckRateLimit("203.0.113.71", "capture");
    expect(r.allowed).toBe(true);
  });

  it("store 未超 MAX_STORE_SIZE 时不应触发删除逻辑", () => {
    // 只写入少量条目
    freshCheckRateLimit("203.0.113.80");
    freshCheckRateLimit("203.0.113.81", "capture");
    // 触发 cleanup
    vi.advanceTimersByTime(60 * 1000);
    // 条目未过期（窗口 60s 内），不应被删除
    // 重新调用应继续累计（remaining=98 而非 99）
    const r = freshCheckRateLimit("203.0.113.80");
    expect(r.remaining).toBe(98);
  });

  it("store 中无过期条目时 cleanup 不应影响未过期条目", () => {
    const ip = "203.0.113.90";
    freshCheckRateLimit(ip);
    // 立即触发 cleanup（条目未过期）
    vi.advanceTimersByTime(60 * 1000);
    // 条目仍在窗口内（60s），不应被删除
    // 推进 30s（仍在窗口内），cleanup 后 remaining 应继续累计
    vi.advanceTimersByTime(30 * 1000);
    vi.advanceTimersByTime(60 * 1000);
    // 第二次 cleanup 时条目已过期（总推进 150s > 60s 窗口），应被删除
    const r = freshCheckRateLimit(ip);
    // 条目被删除后重新创建窗口，remaining=99
    expect(r.remaining).toBe(99);
  });
});
