/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * 断路器测试 - 验证 circuit-breaker.ts 的核心行为
 *
 * 测试目标：src/core/proxy/circuit-breaker.ts 的
 *   isCircuitOpen / recordFailure / recordSuccess /
 *   cleanupCircuitBreakers / getCircuitBreakerStatus
 *
 * 设计说明：
 * - 断路器状态存储于模块级 Map，每个用例前调用 vi.resetModules() + 动态 import
 *   以获得全新的模块实例，避免用例间状态泄漏
 * - 时间相关用例使用 vi.useFakeTimers + vi.setSystemTime 控制 Date.now()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ 问题
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/logger.js", () => ({
  logger: loggerMock,
}));

// 动态加载的被测模块（每个用例前重置）
let cb: typeof import("../../../src/core/proxy/circuit-breaker.js");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  cb = await import("../../../src/core/proxy/circuit-breaker.js");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isCircuitOpen", () => {
  it("无状态时返回 false", () => {
    expect(cb.isCircuitOpen("no-such-key")).toBe(false);
  });

  it("isOpen=true 且未超时返回 true", () => {
    // 触发 5 次失败让断路器打开
    for (let i = 0; i < 5; i++) cb.recordFailure("k1");
    expect(cb.isCircuitOpen("k1")).toBe(true);
  });

  it("isOpen=true 且超时后转为半开（返回 false），并记录 info 日志", () => {
    // 先打开断路器
    for (let i = 0; i < 5; i++) cb.recordFailure("k2");
    expect(cb.isCircuitOpen("k2")).toBe(true);

    // 推进时间超过 resetTimeout (60000ms)
    const baseNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseNow + 61000);

    const result = cb.isCircuitOpen("k2");
    expect(result).toBe(false);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("断路器进入半开状态"),
      expect.objectContaining({ module: "CircuitBreaker" }),
    );

    // 状态应已转为 isOpen=false
    const state = cb.getCircuitBreakerStatus().get("k2");
    expect(state?.isOpen).toBe(false);
  });

  it("半开状态下再次失败会重新累积 failures（覆盖 isOpen=false 分支）", () => {
    for (let i = 0; i < 5; i++) cb.recordFailure("k2b");
    // 推进时间触发半开
    const baseNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseNow + 61000);
    expect(cb.isCircuitOpen("k2b")).toBe(false);
    // 半开后再失败 5 次，断路器应重新打开
    vi.setSystemTime(baseNow + 62000);
    for (let i = 0; i < 5; i++) cb.recordFailure("k2b");
    expect(cb.isCircuitOpen("k2b")).toBe(true);
  });
});

describe("recordFailure", () => {
  it("累加 failures，达到阈值 5 时设置 isOpen=true 并记录 warn 日志", () => {
    for (let i = 0; i < 4; i++) cb.recordFailure("k3");
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(cb.isCircuitOpen("k3")).toBe(false);

    cb.recordFailure("k3"); // 第 5 次，触发打开
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("断路器打开"),
      expect.objectContaining({ module: "CircuitBreaker" }),
    );
    expect(cb.isCircuitOpen("k3")).toBe(true);

    const state = cb.getCircuitBreakerStatus().get("k3");
    expect(state?.failures).toBe(5);
    expect(state?.isOpen).toBe(true);
  });

  it("已 isOpen 时不重复记录 warn 日志", () => {
    for (let i = 0; i < 5; i++) cb.recordFailure("k4");
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);

    cb.recordFailure("k4"); // 第 6 次，已 isOpen
    cb.recordFailure("k4"); // 第 7 次
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);

    const state = cb.getCircuitBreakerStatus().get("k4");
    expect(state?.failures).toBe(7);
    expect(state?.isOpen).toBe(true);
  });

  it("首次失败创建初始状态条目", () => {
    cb.recordFailure("k4b");
    const state = cb.getCircuitBreakerStatus().get("k4b");
    expect(state).toBeDefined();
    expect(state?.failures).toBe(1);
    expect(state?.isOpen).toBe(false);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});

describe("recordSuccess", () => {
  it("有状态时重置 failures=0, isOpen=false 并记录 debug 日志", () => {
    for (let i = 0; i < 5; i++) cb.recordFailure("k5");
    expect(cb.isCircuitOpen("k5")).toBe(true);

    cb.recordSuccess("k5");

    const state = cb.getCircuitBreakerStatus().get("k5");
    expect(state?.failures).toBe(0);
    expect(state?.isOpen).toBe(false);
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining("断路器重置"),
      expect.objectContaining({ module: "CircuitBreaker" }),
    );
  });

  it("无状态时不创建新条目", () => {
    cb.recordSuccess("no-such-key");
    expect(cb.getCircuitBreakerStatus().has("no-such-key")).toBe(false);
    expect(loggerMock.debug).not.toHaveBeenCalled();
  });
});

describe("cleanupCircuitBreakers", () => {
  it("删除超过 maxAge（24h）的条目", () => {
    cb.recordFailure("old-key");
    // 推进时间超过 24h
    const baseNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseNow + 25 * 60 * 60 * 1000);

    cb.cleanupCircuitBreakers();
    expect(cb.getCircuitBreakerStatus().has("old-key")).toBe(false);
  });

  it("size > maxSize（1000）时按 lastFailureTime 排序删除最旧的", () => {
    // 用 fake timers 让每个条目的 lastFailureTime 严格递增
    vi.useFakeTimers();
    const base = 1_000_000;
    for (let i = 0; i < 1001; i++) {
      vi.setSystemTime(base + i * 1000);
      cb.recordFailure(`p-${i}`);
    }

    cb.cleanupCircuitBreakers();

    const status = cb.getCircuitBreakerStatus();
    expect(status.size).toBe(1000);
    // 最旧的 p-0 应该被删除
    expect(status.has("p-0")).toBe(false);
    // 最新的 p-1000 应该保留
    expect(status.has("p-1000")).toBe(true);
    // 验证清理日志被调用
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining("清理了"),
      expect.objectContaining({ module: "CircuitBreaker" }),
    );
  });

  it("size ≤ maxSize 且无过期时不删除", () => {
    cb.recordFailure("k6");
    cb.recordFailure("k7");
    cb.cleanupCircuitBreakers();
    const status = cb.getCircuitBreakerStatus();
    expect(status.size).toBe(2);
    expect(status.has("k6")).toBe(true);
    expect(status.has("k7")).toBe(true);
  });

  it("同时存在过期与未过期条目时，仅删除过期条目", () => {
    cb.recordFailure("expired");
    // 推进时间 25h 让 expired 过期
    const baseNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseNow + 25 * 60 * 60 * 1000);
    // 添加新条目（不会过期）
    cb.recordFailure("fresh");

    cb.cleanupCircuitBreakers();
    const status = cb.getCircuitBreakerStatus();
    expect(status.has("expired")).toBe(false);
    expect(status.has("fresh")).toBe(true);
  });
});

describe("getCircuitBreakerStatus", () => {
  it("返回 Map 副本（修改返回值不影响内部状态）", () => {
    cb.recordFailure("k8");
    const status1 = cb.getCircuitBreakerStatus();
    expect(status1.has("k8")).toBe(true);

    // 修改返回的 Map
    status1.set("injected", {
      failures: 999,
      lastFailureTime: 0,
      isOpen: false,
    });
    status1.delete("k8");

    // 再次获取，应不受影响
    const status2 = cb.getCircuitBreakerStatus();
    expect(status2.has("injected")).toBe(false);
    expect(status2.has("k8")).toBe(true);
  });

  it("无任何条目时返回空 Map", () => {
    const status = cb.getCircuitBreakerStatus();
    expect(status.size).toBe(0);
  });
});
