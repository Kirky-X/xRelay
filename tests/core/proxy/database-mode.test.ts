/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * 代理管理器 - 数据库模式测试
 *
 * 测试目标：src/core/proxy/database-mode.ts 的
 *   loadProxiesFromDatabase / loadProxiesFromPool /
 *   getAvailableProxyFromDatabase / getMultipleProxiesFromDatabase /
 *   reportProxyFailedToDatabase / reportProxySuccessToDatabase / getDatabaseStatus
 *
 * 设计说明：
 * - 使用 vi.hoisted 提升可变 mock 引用（databaseConfigRef / daoMock / depMock 等）
 *   便于在用例内动态调整返回值
 * - mock 所有外部依赖：DAO、断路器、logger、proxy-fetcher、config
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProxyInfo } from "../../../src/types/index.js";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ
const {
  loggerMock,
  databaseConfigRef,
  availableDaoMock,
  deprecatedDaoMock,
  circuitBreakerMock,
  fetcherMock,
  connectionMock,
} = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  databaseConfigRef: {
    minProxyCount: 5,
    failureThreshold: 10,
  },
  availableDaoMock: {
    getProxyCount: vi.fn(),
    incrementFailureCount: vi.fn(),
    incrementSuccessCount: vi.fn(),
    deleteProxy: vi.fn(),
    batchInsertProxies: vi.fn(),
    getWeightedProxies: vi.fn(),
  },
  deprecatedDaoMock: {
    insertDeprecatedProxy: vi.fn(),
    getAllDeprecatedProxies: vi.fn(),
  },
  circuitBreakerMock: {
    isCircuitOpen: vi.fn(),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  },
  fetcherMock: {
    fetchAllProxies: vi.fn(),
  },
  connectionMock: {
    isDatabaseReady: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock("../../../src/logger.js", () => ({ logger: loggerMock }));

vi.mock("../../../src/config.js", () => ({
  DATABASE_CONFIG: databaseConfigRef,
}));

vi.mock("../../../src/database/connection.js", () => connectionMock);

vi.mock("../../../src/database/available-proxies-dao.js", () => availableDaoMock);

vi.mock("../../../src/database/deprecated-proxies-dao.js", () => deprecatedDaoMock);

vi.mock("../../../src/core/proxy/circuit-breaker.js", () => circuitBreakerMock);

vi.mock("../../../src/proxy-fetcher.js", () => fetcherMock);

import {
  loadProxiesFromDatabase,
  loadProxiesFromPool,
  getAvailableProxyFromDatabase,
  getMultipleProxiesFromDatabase,
  reportProxyFailedToDatabase,
  reportProxySuccessToDatabase,
  getDatabaseStatus,
} from "../../../src/core/proxy/database-mode.js";

beforeEach(() => {
  vi.clearAllMocks();
  // 重置默认 mock 行为
  availableDaoMock.getProxyCount.mockResolvedValue(0);
  availableDaoMock.getWeightedProxies.mockResolvedValue([]);
  availableDaoMock.incrementFailureCount.mockResolvedValue(null);
  availableDaoMock.incrementSuccessCount.mockResolvedValue(null);
  availableDaoMock.deleteProxy.mockResolvedValue(true);
  availableDaoMock.batchInsertProxies.mockResolvedValue(0);
  deprecatedDaoMock.getAllDeprecatedProxies.mockResolvedValue([]);
  deprecatedDaoMock.insertDeprecatedProxy.mockResolvedValue({});
  circuitBreakerMock.isCircuitOpen.mockReturnValue(false);
  fetcherMock.fetchAllProxies.mockResolvedValue([]);
});

describe("loadProxiesFromDatabase", () => {
  it("数据库有代理时记录成功日志且不调用 loadProxiesFromPool", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(42);

    await loadProxiesFromDatabase();

    expect(availableDaoMock.getProxyCount).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("数据库中有 42 个代理"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      "从数据库加载代理成功",
      expect.objectContaining({ module: "ProxyManager" }),
    );
    // 不应该调用 fetchAllProxies（即未触发 loadProxiesFromPool）
    expect(fetcherMock.fetchAllProxies).not.toHaveBeenCalled();
  });

  it("数据库为空时调用 loadProxiesFromPool 补充代理", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(0);
    fetcherMock.fetchAllProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: "8080", source: "test", timestamp: 0 },
    ]);
    availableDaoMock.batchInsertProxies.mockResolvedValue(1);

    await loadProxiesFromDatabase();

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("数据库为空"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(fetcherMock.fetchAllProxies).toHaveBeenCalledTimes(1);
  });

  it("getProxyCount 抛错时记录 error 并向上抛出", async () => {
    const err = new Error("db connection failed");
    availableDaoMock.getProxyCount.mockRejectedValue(err);

    await expect(loadProxiesFromDatabase()).rejects.toThrow("db connection failed");

    expect(loggerMock.error).toHaveBeenCalledWith(
      "从数据库加载代理失败",
      err,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("getProxyCount 抛非 Error 值时 error 第二参数为 undefined", async () => {
    availableDaoMock.getProxyCount.mockRejectedValue("string error");

    await expect(loadProxiesFromDatabase()).rejects.toBe("string error");

    expect(loggerMock.error).toHaveBeenCalledWith(
      "从数据库加载代理失败",
      undefined,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });
});

describe("loadProxiesFromPool", () => {
  it("获取到代理时过滤掉废弃代理后批量插入", async () => {
    fetcherMock.fetchAllProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: "8080", source: "src-a", timestamp: 0 },
      { ip: "2.2.2.2", port: "9090", source: "src-b", timestamp: 0 },
      { ip: "3.3.3.3", port: "7070", source: "src-c", timestamp: 0 },
    ]);
    deprecatedDaoMock.getAllDeprecatedProxies.mockResolvedValue([
      { ip: "2.2.2.2", port: 9090, failure_count: 10 },
    ]);
    availableDaoMock.batchInsertProxies.mockResolvedValue(2);

    await loadProxiesFromPool();

    // batchInsertProxies 应只接收 2 个代理（1.1.1.1 和 3.3.3.3）
    expect(availableDaoMock.batchInsertProxies).toHaveBeenCalledTimes(1);
    const inserted = availableDaoMock.batchInsertProxies.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual({
      ip: "1.1.1.1",
      port: 8080,
      source: "src-a",
      failure_count: 0,
      success_count: 0,
    });
    expect(inserted[1]).toEqual({
      ip: "3.3.3.3",
      port: 7070,
      source: "src-c",
      failure_count: 0,
      success_count: 0,
    });
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("成功插入 2 个代理"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("获取到 0 个代理时记录 warn 并直接返回（不调用 batchInsert）", async () => {
    fetcherMock.fetchAllProxies.mockResolvedValue([]);

    await loadProxiesFromPool();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "没有获取到代理",
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(availableDaoMock.batchInsertProxies).not.toHaveBeenCalled();
  });

  it("fetchAllProxies 抛错时记录 error 并向上抛出", async () => {
    const err = new Error("fetch failed");
    fetcherMock.fetchAllProxies.mockRejectedValue(err);

    await expect(loadProxiesFromPool()).rejects.toThrow("fetch failed");

    expect(loggerMock.error).toHaveBeenCalledWith(
      "从代理池加载失败",
      err,
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(availableDaoMock.batchInsertProxies).not.toHaveBeenCalled();
  });

  it("fetchAllProxies 抛非 Error 时 error 第二参数为 undefined", async () => {
    fetcherMock.fetchAllProxies.mockRejectedValue(42);

    await expect(loadProxiesFromPool()).rejects.toBe(42);

    expect(loggerMock.error).toHaveBeenCalledWith(
      "从代理池加载失败",
      undefined,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("全部代理都被废弃时记录过滤后剩余 0 并调用 batchInsert（空数组）", async () => {
    fetcherMock.fetchAllProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: "8080", source: "a", timestamp: 0 },
    ]);
    deprecatedDaoMock.getAllDeprecatedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, failure_count: 1 },
    ]);

    await loadProxiesFromPool();

    expect(availableDaoMock.batchInsertProxies).toHaveBeenCalledWith([]);
  });
});

describe("getAvailableProxyFromDatabase", () => {
  it("代理数量充足时返回首个未打开断路器的代理", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 1 },
      { ip: "2.2.2.2", port: 9090, source: "b", failure_count: 0, success_count: 1 },
    ]);
    circuitBreakerMock.isCircuitOpen.mockReturnValue(false);

    const result = await getAvailableProxyFromDatabase();

    expect(result).not.toBeNull();
    expect(result?.ip).toBe("1.1.1.1");
    expect(result?.port).toBe("8080");
    expect(result?.source).toBe("a");
    expect(typeof result?.timestamp).toBe("number");
    // 不应该触发补充代理
    expect(fetcherMock.fetchAllProxies).not.toHaveBeenCalled();
  });

  it("代理数量低于 minProxyCount 时先补充代理", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(2); // 低于 5
    fetcherMock.fetchAllProxies.mockResolvedValue([
      { ip: "9.9.9.9", port: "8888", source: "x", timestamp: 0 },
    ]);
    availableDaoMock.batchInsertProxies.mockResolvedValue(1);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 1 },
    ]);

    const result = await getAvailableProxyFromDatabase();

    expect(fetcherMock.fetchAllProxies).toHaveBeenCalledTimes(1);
    expect(result?.ip).toBe("1.1.1.1");
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("代理数量不足 (2 < 5)"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("getWeightedProxies 返回空数组时返回 null 并 warn", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([]);

    const result = await getAvailableProxyFromDatabase();

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "没有可用代理",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("所有代理的断路器都已打开时返回 null 并 warn", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 0 },
      { ip: "2.2.2.2", port: 9090, source: "b", failure_count: 0, success_count: 0 },
    ]);
    circuitBreakerMock.isCircuitOpen.mockReturnValue(true);

    const result = await getAvailableProxyFromDatabase();

    expect(result).toBeNull();
    expect(circuitBreakerMock.isCircuitOpen).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "所有代理的断路器都已打开",
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("断路器打开的代理被跳过，返回下一个可用代理", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 5, success_count: 0 },
      { ip: "2.2.2.2", port: 9090, source: "b", failure_count: 0, success_count: 5 },
    ]);
    // 第一个代理断路器打开，第二个关闭
    circuitBreakerMock.isCircuitOpen
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await getAvailableProxyFromDatabase();

    expect(result?.ip).toBe("2.2.2.2");
    expect(result?.port).toBe("9090");
  });
});

describe("getMultipleProxiesFromDatabase", () => {
  it("代理数量充足时返回指定数量的代理（过滤断路器打开的）", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 1 },
      { ip: "2.2.2.2", port: 9090, source: "b", failure_count: 0, success_count: 1 },
      { ip: "3.3.3.3", port: 7070, source: "c", failure_count: 0, success_count: 1 },
    ]);
    // 第二个代理断路器打开
    circuitBreakerMock.isCircuitOpen
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await getMultipleProxiesFromDatabase(2);

    // 期望返回 2 个代理（1.1.1.1 和 3.3.3.3）
    expect(result).toHaveLength(2);
    expect(result[0].ip).toBe("1.1.1.1");
    expect(result[1].ip).toBe("3.3.3.3");
    // getWeightedProxies 应以 count * 3 调用
    expect(availableDaoMock.getWeightedProxies).toHaveBeenCalledWith(6);
  });

  it("代理数量低于 minProxyCount 时先补充代理", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(1);
    fetcherMock.fetchAllProxies.mockResolvedValue([
      { ip: "9.9.9.9", port: "8888", source: "x", timestamp: 0 },
    ]);
    availableDaoMock.batchInsertProxies.mockResolvedValue(1);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 1 },
    ]);

    const result = await getMultipleProxiesFromDatabase(1);

    expect(fetcherMock.fetchAllProxies).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("代理数量不足 (1 < 5)"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("所有代理都被过滤时返回空数组", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 5, success_count: 0 },
    ]);
    circuitBreakerMock.isCircuitOpen.mockReturnValue(true);

    const result = await getMultipleProxiesFromDatabase(5);

    expect(result).toEqual([]);
  });

  it("返回数量不超过请求的 count", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(10);
    availableDaoMock.getWeightedProxies.mockResolvedValue([
      { ip: "1.1.1.1", port: 8080, source: "a", failure_count: 0, success_count: 1 },
      { ip: "2.2.2.2", port: 9090, source: "b", failure_count: 0, success_count: 1 },
      { ip: "3.3.3.3", port: 7070, source: "c", failure_count: 0, success_count: 1 },
      { ip: "4.4.4.4", port: 6060, source: "d", failure_count: 0, success_count: 1 },
    ]);
    circuitBreakerMock.isCircuitOpen.mockReturnValue(false);

    const result = await getMultipleProxiesFromDatabase(2);

    expect(result).toHaveLength(2);
  });
});

describe("reportProxyFailedToDatabase", () => {
  const proxy: ProxyInfo = {
    ip: "1.1.1.1",
    port: "8080",
    source: "test",
    timestamp: 0,
  };

  it("代理不存在（updated 为 null）时仅记录 debug 日志", async () => {
    availableDaoMock.incrementFailureCount.mockResolvedValue(null);

    await reportProxyFailedToDatabase(proxy);

    expect(availableDaoMock.incrementFailureCount).toHaveBeenCalledWith("1.1.1.1", 8080);
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining("代理不存在"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(deprecatedDaoMock.insertDeprecatedProxy).not.toHaveBeenCalled();
    expect(availableDaoMock.deleteProxy).not.toHaveBeenCalled();
  });

  it("失败次数未达阈值时只更新 failure_count 不移入废弃表", async () => {
    availableDaoMock.incrementFailureCount.mockResolvedValue({
      ip: "1.1.1.1",
      port: 8080,
      source: "test",
      failure_count: 3,
      success_count: 0,
      created_at: new Date("2026-01-01"),
    });

    await reportProxyFailedToDatabase(proxy);

    expect(deprecatedDaoMock.insertDeprecatedProxy).not.toHaveBeenCalled();
    expect(availableDaoMock.deleteProxy).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining("代理失败次数: 3"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("失败次数达到阈值时移入废弃表并删除代理", async () => {
    const createdAt = new Date("2026-01-01");
    availableDaoMock.incrementFailureCount.mockResolvedValue({
      ip: "1.1.1.1",
      port: 8080,
      source: "test",
      failure_count: 10,
      success_count: 0,
      created_at: createdAt,
    });

    await reportProxyFailedToDatabase(proxy);

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("代理失败次数超过阈值"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
    expect(deprecatedDaoMock.insertDeprecatedProxy).toHaveBeenCalledWith({
      ip: "1.1.1.1",
      port: 8080,
      source: "test",
      protocol: "http",
      failure_count: 10,
      created_at: createdAt,
    });
    expect(availableDaoMock.deleteProxy).toHaveBeenCalledWith("1.1.1.1", 8080);
  });

  it("内部抛错时记录 error 不向上抛出", async () => {
    const err = new Error("update failed");
    availableDaoMock.incrementFailureCount.mockRejectedValue(err);

    // 不应抛出
    await expect(reportProxyFailedToDatabase(proxy)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("报告代理失败失败: update failed"),
      err,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("内部抛非 Error 值时 error 第二参数为 undefined", async () => {
    availableDaoMock.incrementFailureCount.mockRejectedValue("string error");

    await expect(reportProxyFailedToDatabase(proxy)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("报告代理失败失败: Unknown error"),
      undefined,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("port 字符串被正确转为数字传给 incrementFailureCount", async () => {
    availableDaoMock.incrementFailureCount.mockResolvedValue(null);
    const p: ProxyInfo = {
      ip: "1.2.3.4",
      port: "3128",
      source: "x",
      timestamp: 0,
    };

    await reportProxyFailedToDatabase(p);

    expect(availableDaoMock.incrementFailureCount).toHaveBeenCalledWith("1.2.3.4", 3128);
  });
});

describe("reportProxySuccessToDatabase", () => {
  const proxy: ProxyInfo = {
    ip: "1.1.1.1",
    port: "8080",
    source: "test",
    timestamp: 0,
  };

  it("成功时调用 incrementSuccessCount 并记录 debug 日志", async () => {
    availableDaoMock.incrementSuccessCount.mockResolvedValue({
      ip: "1.1.1.1",
      port: 8080,
      source: "test",
      failure_count: 0,
      success_count: 1,
    });

    await reportProxySuccessToDatabase(proxy);

    expect(availableDaoMock.incrementSuccessCount).toHaveBeenCalledWith("1.1.1.1", 8080);
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining("代理成功"),
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("内部抛错时记录 error 不向上抛出", async () => {
    const err = new Error("update failed");
    availableDaoMock.incrementSuccessCount.mockRejectedValue(err);

    await expect(reportProxySuccessToDatabase(proxy)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      "报告代理成功失败",
      err,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });

  it("内部抛非 Error 时 error 第二参数为 undefined", async () => {
    availableDaoMock.incrementSuccessCount.mockRejectedValue(123);

    await expect(reportProxySuccessToDatabase(proxy)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      "报告代理成功失败",
      undefined,
      expect.objectContaining({ module: "ProxyManager" }),
    );
  });
});

describe("getDatabaseStatus", () => {
  it("返回数据库模式的状态（mode=database，固定字段为 0）", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(37);

    const status = await getDatabaseStatus();

    expect(status).toEqual({
      availableCount: 37,
      lastRefreshTime: 0,
      refreshCount: 0,
      blacklistSize: 0,
      mode: "database",
    });
    expect(availableDaoMock.getProxyCount).toHaveBeenCalledTimes(1);
  });

  it("getProxyCount 为 0 时返回 availableCount=0", async () => {
    availableDaoMock.getProxyCount.mockResolvedValue(0);

    const status = await getDatabaseStatus();

    expect(status.availableCount).toBe(0);
    expect(status.mode).toBe("database");
  });
});
