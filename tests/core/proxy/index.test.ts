/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Proxy Manager (core/proxy/index.ts) 单元测试
 *
 * 测试目标：src/core/proxy/index.ts 的所有导出函数
 *
 * 覆盖关键分支：
 * 1. initProxyManager - isInitialized 命中 / initPromise 并发复用 / 数据库模式 / 内存模式 / catch 降级
 * 2. getAvailableProxy / getMultipleProxies - isDatabaseMode true/false 分支
 * 3. reportProxyFailed / reportProxySuccess - isDatabaseMode true/false 分支
 * 4. getPoolStatus / manualRefresh / getProxyStats - isDatabaseMode true/false 分支
 * 5. isUsingDatabase / getCircuitBreakerStatus - 返回值断言
 *
 * 设计说明：
 * - 模块级状态（isInitialized / initPromise / isDatabaseMode）需通过 vi.resetModules 重置
 * - 通过 mock initDatabase 返回值切换数据库/内存模式
 * - 使用 vi.hoisted 提升可变 mock 引用，便于在用例中动态调整
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  loggerMock,
  connectionMock,
  databaseModeMock,
  memoryModeMock,
  circuitBreakerMock,
} = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  // initDatabase 返回值在用例中动态调整
  connectionMock: {
    initDatabase: vi.fn(),
  },
  databaseModeMock: {
    loadProxiesFromDatabase: vi.fn(async () => {}),
    loadProxiesFromPool: vi.fn(async () => {}),
    getAvailableProxyFromDatabase: vi.fn(async () => null),
    getMultipleProxiesFromDatabase: vi.fn(async () => []),
    reportProxyFailedToDatabase: vi.fn(async () => {}),
    reportProxySuccessToDatabase: vi.fn(async () => {}),
    getDatabaseStatus: vi.fn(async () => ({
      availableCount: 0,
      lastRefreshTime: 0,
      refreshCount: 0,
      blacklistSize: 0,
      mode: "database" as const,
    })),
  },
  memoryModeMock: {
    refreshProxyPool: vi.fn(async () => {}),
    getAvailableProxyFromMemory: vi.fn(async () => null),
    getMultipleProxiesFromMemory: vi.fn(async () => []),
    reportProxyFailedToMemory: vi.fn(),
    reportProxySuccessToMemory: vi.fn(),
    getMemoryStatus: vi.fn(() => ({
      availableCount: 0,
      lastRefreshTime: 0,
      refreshCount: 0,
      blacklistSize: 0,
      mode: "memory" as const,
    })),
    getProxyPoolState: vi.fn(() => ({
      availableProxies: [],
      lastRefreshTime: 0,
      refreshCount: 0,
    })),
  },
  circuitBreakerMock: {
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    cleanupCircuitBreakers: vi.fn(),
    getCircuitBreakerStatus: vi.fn(() => new Map()),
    isCircuitOpen: vi.fn(() => false),
  },
}));

vi.mock("../../../src/logger.js", () => ({ logger: loggerMock }));
vi.mock("../../../src/database/connection.js", () => connectionMock);
vi.mock("../../../src/core/proxy/database-mode.js", () => databaseModeMock);
vi.mock("../../../src/core/proxy/memory-mode.js", () => memoryModeMock);
vi.mock("../../../src/core/proxy/circuit-breaker.js", () => circuitBreakerMock);

beforeEach(() => {
  vi.clearAllMocks();
  // 重置 mock 默认行为
  connectionMock.initDatabase.mockResolvedValue(false);
  memoryModeMock.getProxyPoolState.mockReturnValue({
    availableProxies: [],
    lastRefreshTime: 0,
    refreshCount: 0,
  });
  memoryModeMock.getMemoryStatus.mockReturnValue({
    availableCount: 0,
    lastRefreshTime: 0,
    refreshCount: 0,
    blacklistSize: 0,
    mode: "memory" as const,
  });
  databaseModeMock.getDatabaseStatus.mockResolvedValue({
    availableCount: 0,
    lastRefreshTime: 0,
    refreshCount: 0,
    blacklistSize: 0,
    mode: "database" as const,
  });
});

describe("initProxyManager - 内存模式分支", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initDatabase 返回 false 时走内存模式（refreshProxyPool 被调用）", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );

    await initProxyManager();

    expect(memoryModeMock.refreshProxyPool).toHaveBeenCalledTimes(1);
    expect(databaseModeMock.loadProxiesFromDatabase).not.toHaveBeenCalled();
    expect(isUsingDatabase()).toBe(false);
    expect(loggerMock.info).toHaveBeenCalledWith(
      "使用内存模式",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("已初始化后再次调用应直接返回（不重复初始化）", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager } = await import("../../../src/core/proxy/index.js");

    await initProxyManager();
    const callsBefore = memoryModeMock.refreshProxyPool.mock.calls.length;
    await initProxyManager();
    const callsAfter = memoryModeMock.refreshProxyPool.mock.calls.length;

    expect(callsAfter).toBe(callsBefore);
  });

  it("并发调用应复用 initPromise（refreshProxyPool 只执行一次）", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager } = await import("../../../src/core/proxy/index.js");

    // 并发 3 次
    await Promise.all([initProxyManager(), initProxyManager(), initProxyManager()]);

    expect(memoryModeMock.refreshProxyPool).toHaveBeenCalledTimes(1);
  });
});

describe("initProxyManager - 数据库模式分支", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initDatabase 返回 true 时走数据库模式（loadProxiesFromDatabase 被调用）", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );

    await initProxyManager();

    expect(databaseModeMock.loadProxiesFromDatabase).toHaveBeenCalledTimes(1);
    expect(memoryModeMock.refreshProxyPool).not.toHaveBeenCalled();
    expect(isUsingDatabase()).toBe(true);
    expect(loggerMock.info).toHaveBeenCalledWith(
      "使用数据库模式",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("initDatabase 返回 true 时也应启动断路器清理定时器", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager } = await import("../../../src/core/proxy/index.js");

    await initProxyManager();

    expect(loggerMock.debug).toHaveBeenCalledWith(
      "断路器清理定时器已启动",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });
});

describe("initProxyManager - catch 降级分支", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式加载抛错时应降级到内存模式", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    databaseModeMock.loadProxiesFromDatabase.mockRejectedValueOnce(
      new Error("db load failed"),
    );
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );

    await initProxyManager();

    expect(loggerMock.error).toHaveBeenCalledWith(
      "初始化失败，使用内存模式",
      expect.any(Error),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(memoryModeMock.refreshProxyPool).toHaveBeenCalledTimes(1);
    expect(isUsingDatabase()).toBe(false);
  });

  it("initDatabase 抛错时应降级到内存模式", async () => {
    connectionMock.initDatabase.mockRejectedValue(new Error("init db failed"));
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );

    await initProxyManager();

    expect(loggerMock.error).toHaveBeenCalledWith(
      "初始化失败，使用内存模式",
      expect.any(Error),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(memoryModeMock.refreshProxyPool).toHaveBeenCalledTimes(1);
    expect(isUsingDatabase()).toBe(false);
  });

  it("降级后 refreshProxyPool 自身抛错时应继续抛出（init 失败）", async () => {
    connectionMock.initDatabase.mockRejectedValue(new Error("init db failed"));
    memoryModeMock.refreshProxyPool.mockRejectedValueOnce(
      new Error("refresh also failed"),
    );
    const { initProxyManager } = await import("../../../src/core/proxy/index.js");

    await expect(initProxyManager()).rejects.toThrow("refresh also failed");
  });
});

describe("getAvailableProxy - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式应调用 getAvailableProxyFromDatabase", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    databaseModeMock.getAvailableProxyFromDatabase.mockResolvedValueOnce({
      ip: "1.1.1.1",
      port: "8080",
      protocol: "http",
      country: "US",
      anonymity: "high",
      lastChecked: Date.now(),
      successRate: 0.9,
      avgResponseTime: 100,
    });
    const { initProxyManager, getAvailableProxy } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const proxy = await getAvailableProxy();

    expect(databaseModeMock.getAvailableProxyFromDatabase).toHaveBeenCalledTimes(1);
    expect(memoryModeMock.getAvailableProxyFromMemory).not.toHaveBeenCalled();
    expect(proxy?.ip).toBe("1.1.1.1");
  });

  it("内存模式应调用 getAvailableProxyFromMemory", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getAvailableProxyFromMemory.mockResolvedValueOnce(null);
    const { initProxyManager, getAvailableProxy } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const proxy = await getAvailableProxy();

    expect(memoryModeMock.getAvailableProxyFromMemory).toHaveBeenCalledTimes(1);
    expect(databaseModeMock.getAvailableProxyFromDatabase).not.toHaveBeenCalled();
    expect(proxy).toBeNull();
  });
});

describe("getMultipleProxies - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式应调用 getMultipleProxiesFromDatabase", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    databaseModeMock.getMultipleProxiesFromDatabase.mockResolvedValueOnce([
      { ip: "1.1.1.1", port: "8080", protocol: "http" },
    ]);
    const { initProxyManager, getMultipleProxies } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const proxies = await getMultipleProxies(5);

    expect(databaseModeMock.getMultipleProxiesFromDatabase).toHaveBeenCalledWith(5);
    expect(proxies).toHaveLength(1);
  });

  it("内存模式应调用 getMultipleProxiesFromMemory", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getMultipleProxiesFromMemory.mockResolvedValueOnce([]);
    const { initProxyManager, getMultipleProxies } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const proxies = await getMultipleProxies(3);

    expect(memoryModeMock.getMultipleProxiesFromMemory).toHaveBeenCalledWith(3);
    expect(proxies).toEqual([]);
  });
});

describe("reportProxyFailed - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const proxy = {
    ip: "1.1.1.1",
    port: "8080",
    protocol: "http",
    country: "US",
    anonymity: "high",
    lastChecked: Date.now(),
    successRate: 0.9,
    avgResponseTime: 100,
  };

  it("数据库模式应调用 reportProxyFailedToDatabase + recordFailure", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager, reportProxyFailed } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await reportProxyFailed(proxy);

    expect(circuitBreakerMock.recordFailure).toHaveBeenCalledWith("1.1.1.1:8080");
    expect(databaseModeMock.reportProxyFailedToDatabase).toHaveBeenCalledWith(proxy);
    expect(memoryModeMock.reportProxyFailedToMemory).not.toHaveBeenCalled();
  });

  it("内存模式应调用 reportProxyFailedToMemory + recordFailure", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, reportProxyFailed } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await reportProxyFailed(proxy);

    expect(circuitBreakerMock.recordFailure).toHaveBeenCalledWith("1.1.1.1:8080");
    expect(memoryModeMock.reportProxyFailedToMemory).toHaveBeenCalledWith(proxy);
    expect(databaseModeMock.reportProxyFailedToDatabase).not.toHaveBeenCalled();
  });

  it("port 为字符串时应正确拼接 proxyKey", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, reportProxyFailed } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await reportProxyFailed({ ...proxy, port: "9090" as unknown as number });

    expect(circuitBreakerMock.recordFailure).toHaveBeenCalledWith("1.1.1.1:9090");
  });
});

describe("reportProxySuccess - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const proxy = {
    ip: "2.2.2.2",
    port: 9000,
    protocol: "http",
    country: "US",
    anonymity: "high",
    lastChecked: Date.now(),
    successRate: 0.9,
    avgResponseTime: 100,
  };

  it("数据库模式应调用 reportProxySuccessToDatabase + recordSuccess", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager, reportProxySuccess } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await reportProxySuccess(proxy);

    expect(circuitBreakerMock.recordSuccess).toHaveBeenCalledWith("2.2.2.2:9000");
    expect(databaseModeMock.reportProxySuccessToDatabase).toHaveBeenCalledWith(proxy);
    expect(memoryModeMock.reportProxySuccessToMemory).not.toHaveBeenCalled();
  });

  it("内存模式应调用 reportProxySuccessToMemory + recordSuccess", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, reportProxySuccess } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await reportProxySuccess(proxy);

    expect(circuitBreakerMock.recordSuccess).toHaveBeenCalledWith("2.2.2.2:9000");
    expect(memoryModeMock.reportProxySuccessToMemory).toHaveBeenCalledWith(proxy);
    expect(databaseModeMock.reportProxySuccessToDatabase).not.toHaveBeenCalled();
  });
});

describe("getPoolStatus - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式应调用 getDatabaseStatus", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    databaseModeMock.getDatabaseStatus.mockResolvedValueOnce({
      availableCount: 42,
      lastRefreshTime: 0,
      refreshCount: 0,
      blacklistSize: 0,
      mode: "database",
    });
    const { initProxyManager, getPoolStatus } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const status = await getPoolStatus();

    expect(databaseModeMock.getDatabaseStatus).toHaveBeenCalledTimes(1);
    expect(memoryModeMock.getMemoryStatus).not.toHaveBeenCalled();
    expect(status.availableCount).toBe(42);
    expect(status.mode).toBe("database");
  });

  it("内存模式应调用 getMemoryStatus", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getMemoryStatus.mockReturnValueOnce({
      availableCount: 7,
      lastRefreshTime: 123,
      refreshCount: 2,
      blacklistSize: 1,
      mode: "memory",
    });
    const { initProxyManager, getPoolStatus } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const status = await getPoolStatus();

    expect(memoryModeMock.getMemoryStatus).toHaveBeenCalledTimes(1);
    expect(databaseModeMock.getDatabaseStatus).not.toHaveBeenCalled();
    expect(status.availableCount).toBe(7);
    expect(status.mode).toBe("memory");
  });
});

describe("manualRefresh - 模式分发", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式应调用 loadProxiesFromPool", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager, manualRefresh } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    await manualRefresh();

    expect(databaseModeMock.loadProxiesFromPool).toHaveBeenCalledTimes(1);
    expect(memoryModeMock.refreshProxyPool).not.toHaveBeenCalled();
  });

  it("内存模式应调用 refreshProxyPool", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, manualRefresh } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    // initProxyManager 已经调用过一次 refreshProxyPool，先重置计数
    memoryModeMock.refreshProxyPool.mockClear();
    await manualRefresh();

    expect(memoryModeMock.refreshProxyPool).toHaveBeenCalledTimes(1);
    expect(databaseModeMock.loadProxiesFromPool).not.toHaveBeenCalled();
  });
});

describe("getProxyStats - 模式分发与 isFresh 计算", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("数据库模式应返回 mode=database, isFresh=false, totalFetched=0", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    databaseModeMock.getDatabaseStatus.mockResolvedValueOnce({
      availableCount: 100,
      lastRefreshTime: 0,
      refreshCount: 0,
      blacklistSize: 0,
      mode: "database",
    });
    const { initProxyManager, getProxyStats } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const stats = await getProxyStats();

    expect(stats.mode).toBe("database");
    expect(stats.isFresh).toBe(false);
    expect(stats.totalFetched).toBe(0);
    expect(stats.availableInPool).toBe(100);
  });

  it("内存模式 + lastRefreshTime < 60s 应返回 isFresh=true", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getProxyPoolState.mockReturnValue({
      availableProxies: [],
      lastRefreshTime: Date.now() - 10000, // 10s 前
      refreshCount: 5,
    });
    const { initProxyManager, getProxyStats } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const stats = await getProxyStats();

    expect(stats.mode).toBe("memory");
    expect(stats.isFresh).toBe(true);
    expect(stats.totalFetched).toBe(5);
  });

  it("内存模式 + lastRefreshTime > 60s 应返回 isFresh=false", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getProxyPoolState.mockReturnValue({
      availableProxies: [{ ip: "1.1.1.1", port: 8080 }],
      lastRefreshTime: Date.now() - 120000, // 120s 前
      refreshCount: 3,
    });
    const { initProxyManager, getProxyStats } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const stats = await getProxyStats();

    expect(stats.mode).toBe("memory");
    expect(stats.isFresh).toBe(false);
    expect(stats.availableInPool).toBe(1);
  });

  it("内存模式 availableProxies 长度作为 availableInPool", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    memoryModeMock.getProxyPoolState.mockReturnValue({
      availableProxies: [
        { ip: "1.1.1.1", port: 8080 },
        { ip: "2.2.2.2", port: 9090 },
      ],
      lastRefreshTime: 0,
      refreshCount: 1,
    });
    const { initProxyManager, getProxyStats } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const stats = await getProxyStats();
    expect(stats.availableInPool).toBe(2);
  });
});

describe("isUsingDatabase / getCircuitBreakerStatus", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("内存模式下 isUsingDatabase 应返回 false", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();
    expect(isUsingDatabase()).toBe(false);
  });

  it("数据库模式下 isUsingDatabase 应返回 true", async () => {
    connectionMock.initDatabase.mockResolvedValue(true);
    const { initProxyManager, isUsingDatabase } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();
    expect(isUsingDatabase()).toBe(true);
  });

  it("getCircuitBreakerStatus 应委托给 CircuitBreaker 模块", async () => {
    connectionMock.initDatabase.mockResolvedValue(false);
    const fakeMap = new Map([["1.1.1.1:8080", { failures: 1, lastFailureTime: 0, isOpen: false }]]);
    circuitBreakerMock.getCircuitBreakerStatus.mockReturnValueOnce(fakeMap);
    const { initProxyManager, getCircuitBreakerStatus } = await import(
      "../../../src/core/proxy/index.js"
    );
    await initProxyManager();

    const status = getCircuitBreakerStatus();
    expect(status).toBe(fakeMap);
    expect(status.get("1.1.1.1:8080")).toBeDefined();
  });

  it("未初始化时 isUsingDatabase 也应返回 false（默认值）", async () => {
    const { isUsingDatabase } = await import("../../../src/core/proxy/index.js");
    expect(isUsingDatabase()).toBe(false);
  });
});
