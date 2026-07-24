/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Memory Mode 直接测试 - 提升分支覆盖率
 *
 * 覆盖目标（未覆盖分支）：
 * 1. shouldRefreshPool：time-based refresh（line 70-72）+ return false（line 74）
 * 2. getAvailableProxyFromMemory：所有断路器打开（line 104-105）
 * 3. reportProxyFailedToMemory：filter 移除代理（line 142）
 * 4. refreshProxyPool：allProxies.length === 0 提前返回（line 30-33）
 * 5. getMultipleProxiesFromMemory：count > available 时刷新（line 116-118）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProxyInfo } from "../../../src/types/index.js";

const {
  loggerMock,
  fetcherMock,
  testerMock,
  circuitBreakerMock,
  configMock,
} = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  fetcherMock: {
    fetchAllProxies: vi.fn(),
  },
  testerMock: {
    quickTestProxies: vi.fn(),
    cleanupBlacklist: vi.fn(),
    getBlacklistStatus: vi.fn(() => ({ size: 0 })),
  },
  circuitBreakerMock: {
    isCircuitOpen: vi.fn(() => false),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  },
  configMock: {
    PROXY_CONFIG: {
      pool: {
        refreshInterval: 5 * 60 * 1000,
        minProxyCount: 3,
        maxProxyCount: 10,
        testTimeout: 2000,
        maxAttempts: 3,
      },
    },
  },
}));

vi.mock("../../../src/logger.js", () => ({ logger: loggerMock }));
vi.mock("../../../src/proxy-fetcher.js", () => fetcherMock);
vi.mock("../../../src/proxy-tester.js", () => testerMock);
vi.mock("../../../src/core/proxy/circuit-breaker.js", () => circuitBreakerMock);
vi.mock("../../../src/config.js", () => configMock);

const fakeProxy: ProxyInfo = {
  ip: "203.0.113.10",
  port: "8080",
  source: "test",
  timestamp: Date.now(),
  protocol: "http",
};

describe("memory-mode - shouldRefreshPool 分支覆盖", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("lastRefreshTime 超过 refreshInterval 时应返回 true（time-based refresh）", async () => {
    const { getProxyPoolState, shouldRefreshPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );
    // 先通过 refreshProxyPool 初始化池状态
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);

    // 触发一次刷新，使 lastRefreshTime 非 0
    const { refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );
    await refreshProxyPool();

    // 手动将 lastRefreshTime 设为很久以前
    const state = getProxyPoolState();
    state.lastRefreshTime = Date.now() - (10 * 60 * 1000); // 10 分钟前
    state.availableProxies = [fakeProxy, fakeProxy, fakeProxy, fakeProxy]; // >= minProxyCount

    // now - lastRefreshTime > refreshInterval → true
    expect(shouldRefreshPool()).toBe(true);
  });

  it("lastRefreshTime 未过期且代理数充足时应返回 false", async () => {
    const { getProxyPoolState, shouldRefreshPool, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);

    await refreshProxyPool();

    const state = getProxyPoolState();
    state.lastRefreshTime = Date.now(); // 刚刚刷新
    state.availableProxies = [fakeProxy, fakeProxy, fakeProxy, fakeProxy];

    expect(shouldRefreshPool()).toBe(false);
  });

  it("lastRefreshTime === 0 时应返回 true（从未刷新）", async () => {
    const { shouldRefreshPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );
    // 重置模块后 lastRefreshTime 默认为 0
    expect(shouldRefreshPool()).toBe(true);
  });

  it("availableProxies.length < minProxyCount 时应返回 true", async () => {
    const { getProxyPoolState, shouldRefreshPool, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);

    await refreshProxyPool();

    const state = getProxyPoolState();
    state.lastRefreshTime = Date.now(); // 未过期
    state.availableProxies = [fakeProxy]; // < minProxyCount(3)

    expect(shouldRefreshPool()).toBe(true);
  });
});

describe("memory-mode - getAvailableProxyFromMemory 断路器全开分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);
    testerMock.getBlacklistStatus.mockReturnValue({ size: 0 });
  });

  it("所有代理断路器都打开时应返回 null 并记录 warn", async () => {
    // 让 isCircuitOpen 对所有代理返回 true
    circuitBreakerMock.isCircuitOpen.mockReturnValue(true);

    const { getAvailableProxyFromMemory, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    // 先刷新池，填充 availableProxies
    await refreshProxyPool();

    // needsRefresh = false（刚刷新），但所有断路器都打开
    const proxy = await getAvailableProxyFromMemory();

    expect(proxy).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "所有代理的断路器都已打开",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("池为空时应返回 null 并记录 warn（没有可用代理）", async () => {
    fetcherMock.fetchAllProxies.mockResolvedValue([]);

    const { getAvailableProxyFromMemory } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    const proxy = await getAvailableProxyFromMemory();

    expect(proxy).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("没有获取到代理"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });
});

describe("memory-mode - reportProxyFailedToMemory 移除分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);
  });

  it("应调用 recordFailure 并从池中移除对应代理", async () => {
    const { reportProxyFailedToMemory, getProxyPoolState, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    await refreshProxyPool();

    const state = getProxyPoolState();
    state.availableProxies = [
      { ip: "1.1.1.1", port: "8080", source: "s", timestamp: 0 },
      { ip: "2.2.2.2", port: "9090", source: "s", timestamp: 0 },
    ];

    reportProxyFailedToMemory({ ip: "1.1.1.1", port: "8080", source: "s", timestamp: 0 });

    expect(circuitBreakerMock.recordFailure).toHaveBeenCalledWith("1.1.1.1:8080");
    expect(state.availableProxies).toHaveLength(1);
    expect(state.availableProxies[0].ip).toBe("2.2.2.2");
  });
});

describe("memory-mode - refreshProxyPool 空源分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("fetchAllProxies 返回空数组时应提前返回并记录 warn", async () => {
    fetcherMock.fetchAllProxies.mockResolvedValue([]);

    const { refreshProxyPool, getProxyPoolState } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    await refreshProxyPool();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "没有获取到代理",
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(testerMock.quickTestProxies).not.toHaveBeenCalled();
    // 池未被更新
    expect(getProxyPoolState().availableProxies).toHaveLength(0);
  });

  it("fetchAllProxies 抛错时应记录 error 不更新池", async () => {
    fetcherMock.fetchAllProxies.mockRejectedValue(new Error("fetch failed"));

    const { refreshProxyPool, getProxyPoolState } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    await refreshProxyPool();

    expect(loggerMock.error).toHaveBeenCalledWith(
      "刷新代理池失败",
      expect.any(Error),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(getProxyPoolState().availableProxies).toHaveLength(0);
  });
});

describe("memory-mode - getMultipleProxiesFromMemory 刷新分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);
  });

  it("availableProxies.length < count 时应触发刷新", async () => {
    const { getMultipleProxiesFromMemory, getProxyPoolState, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    // 先初始化池（只有 1 个代理）
    await refreshProxyPool();

    const state = getProxyPoolState();
    expect(state.availableProxies).toHaveLength(1);

    // 请求 5 个，但池中只有 1 个 → 应触发刷新
    fetcherMock.fetchAllProxies.mockResolvedValue([
      fakeProxy,
      { ...fakeProxy, ip: "203.0.113.11" },
      { ...fakeProxy, ip: "203.0.113.12" },
    ]);
    testerMock.quickTestProxies.mockResolvedValue([
      fakeProxy,
      { ...fakeProxy, ip: "203.0.113.11" },
      { ...fakeProxy, ip: "203.0.113.12" },
    ]);

    const proxies = await getMultipleProxiesFromMemory(5);

    // 应触发刷新（fetchAllProxies 被再次调用）
    expect(fetcherMock.fetchAllProxies).toHaveBeenCalledTimes(2);
    expect(proxies.length).toBeLessThanOrEqual(5);
  });

  it("断路器过滤后应只返回可用代理", async () => {
    const { getMultipleProxiesFromMemory, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    const p1 = { ip: "1.1.1.1", port: "8080", source: "s", timestamp: 0 };
    const p2 = { ip: "2.2.2.2", port: "9090", source: "s", timestamp: 0 };

    fetcherMock.fetchAllProxies.mockResolvedValue([p1, p2]);
    testerMock.quickTestProxies.mockResolvedValue([p1, p2]);

    await refreshProxyPool();

    // p1 的断路器打开
    circuitBreakerMock.isCircuitOpen.mockImplementation((key: string) => key === "1.1.1.1:8080");

    const proxies = await getMultipleProxiesFromMemory(2);

    // 应只返回 p2
    expect(proxies).toHaveLength(1);
    expect(proxies[0].ip).toBe("2.2.2.2");
  });
});

describe("memory-mode - reportProxySuccessToMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("应调用 recordSuccess", async () => {
    const { reportProxySuccessToMemory } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    reportProxySuccessToMemory({ ip: "1.1.1.1", port: "8080", source: "s", timestamp: 0 });

    expect(circuitBreakerMock.recordSuccess).toHaveBeenCalledWith("1.1.1.1:8080");
  });
});

describe("memory-mode - getMemoryStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fetcherMock.fetchAllProxies.mockResolvedValue([fakeProxy]);
    testerMock.quickTestProxies.mockResolvedValue([fakeProxy]);
    testerMock.getBlacklistStatus.mockReturnValue({ size: 5 });
  });

  it("应返回正确的状态对象，mode 为 memory", async () => {
    const { getMemoryStatus, refreshProxyPool } = await import(
      "../../../src/core/proxy/memory-mode.js"
    );

    await refreshProxyPool();

    const status = getMemoryStatus();

    expect(status.mode).toBe("memory");
    expect(status.availableCount).toBeGreaterThan(0);
    expect(status.blacklistSize).toBe(5);
    expect(status.refreshCount).toBeGreaterThanOrEqual(1);
  });
});
