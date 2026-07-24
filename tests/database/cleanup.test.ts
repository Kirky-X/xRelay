/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Database Cleanup Tests - 数据库清理模块测试
 * 验证 runCleanup / getCleanupConfig 的行为
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ 问题
const mocks = vi.hoisted(() => ({
  isDatabaseReady: vi.fn(),
  deleteExpiredDeprecatedProxies: vi.fn(),
  getDeprecatedProxyStats: vi.fn(),
}));

// Mock connection.js 的 isDatabaseReady
vi.mock("../../src/database/connection.js", () => ({
  isDatabaseReady: mocks.isDatabaseReady,
}));

// Mock deprecated-proxies-dao.js 的两个函数
vi.mock("../../src/database/deprecated-proxies-dao.js", () => ({
  deleteExpiredDeprecatedProxies: mocks.deleteExpiredDeprecatedProxies,
  getDeprecatedProxyStats: mocks.getDeprecatedProxyStats,
}));

// Mock config.js 的 DATABASE_CONFIG
vi.mock("../../src/config.js", () => ({
  DATABASE_CONFIG: {
    deprecatedRetentionDays: 30,
    cleanupInterval: 86400000,
  },
}));

import { runCleanup, getCleanupConfig } from "../../src/database/cleanup.js";

describe("Database Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runCleanup", () => {
    it("数据库未就绪时返回零值并跳过清理", async () => {
      // 安排：数据库未就绪
      mocks.isDatabaseReady.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // 执行
      const result = await runCleanup();

      // 验证
      expect(result).toEqual({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
      expect(mocks.deleteExpiredDeprecatedProxies).not.toHaveBeenCalled();
      expect(mocks.getDeprecatedProxyStats).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Cleanup] Database not ready, skipping cleanup",
      );
    });

    it("成功执行清理并返回删除数量和统计信息", async () => {
      // 安排：数据库就绪，清理 5 条，统计返回
      mocks.isDatabaseReady.mockReturnValue(true);
      mocks.deleteExpiredDeprecatedProxies.mockResolvedValue(5);
      mocks.getDeprecatedProxyStats.mockResolvedValue({
        total: 20,
        expired: 5,
        recent: 15,
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      // 执行
      const result = await runCleanup();

      // 验证：使用了配置中的 30 天保留期
      expect(mocks.deleteExpiredDeprecatedProxies).toHaveBeenCalledWith(30);
      expect(mocks.getDeprecatedProxyStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        deletedCount: 5,
        stats: { total: 20, expired: 5, recent: 15 },
      });
    });

    it("清理过程出错时返回零值并记录错误", async () => {
      // 安排：数据库就绪，但删除操作抛错
      mocks.isDatabaseReady.mockReturnValue(true);
      mocks.deleteExpiredDeprecatedProxies.mockRejectedValue(
        new Error("DB connection lost"),
      );
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      // 执行
      const result = await runCleanup();

      // 验证
      expect(result).toEqual({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Cleanup] Cleanup task failed:",
        expect.any(Error),
      );
    });

    it("getDeprecatedProxyStats 抛错时同样降级返回零值", async () => {
      // 安排：删除成功，但统计抛错
      mocks.isDatabaseReady.mockReturnValue(true);
      mocks.deleteExpiredDeprecatedProxies.mockResolvedValue(3);
      mocks.getDeprecatedProxyStats.mockRejectedValue(
        new Error("Stats query failed"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      // 执行
      const result = await runCleanup();

      // 验证
      expect(result).toEqual({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
    });
  });

  describe("getCleanupConfig", () => {
    it("返回正确的清理配置（间隔、保留天数、Cron 端点）", () => {
      const config = getCleanupConfig();
      expect(config).toEqual({
        interval: 86400000,
        retentionDays: 30,
        cronEndpoint: "/api/cron/cleanup",
      });
    });
  });
});
