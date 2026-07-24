/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Deprecated Proxies DAO Tests - 废弃代理数据访问层测试
 * 验证 insertDeprecatedProxy / isProxyDeprecated / getAllDeprecatedProxies /
 * getDeprecatedProxyCount / getExpiredDeprecatedProxies /
 * deleteExpiredDeprecatedProxies / clearAllDeprecatedProxies /
 * getDeprecatedProxyStats 的行为
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ 问题
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

// Mock connection.js 的 query 函数（具名导出）
vi.mock("../../src/database/connection.js", () => ({
  query: queryMock,
}));

import {
  insertDeprecatedProxy,
  isProxyDeprecated,
  getAllDeprecatedProxies,
  getDeprecatedProxyCount,
  getExpiredDeprecatedProxies,
  deleteExpiredDeprecatedProxies,
  clearAllDeprecatedProxies,
  getDeprecatedProxyStats,
} from "../../src/database/deprecated-proxies-dao.js";

describe("Deprecated Proxies DAO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("insertDeprecatedProxy", () => {
    it("调用 query 并传入正确的 SQL（含 ON CONFLICT）和 6 个参数，返回 rows[0]", async () => {
      // 安排
      const mockRow = { id: 1, ip: "1.2.3.4", port: 8080 };
      queryMock.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // 执行
      const result = await insertDeprecatedProxy({
        ip: "1.2.3.4",
        port: 8080,
        source: "test",
        protocol: "http",
        failure_count: 5,
        created_at: new Date("2026-01-01"),
      });

      // 验证返回值
      expect(result).toEqual(mockRow);
      // 验证 SQL
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("INSERT INTO xrelay.deprecated_proxies");
      expect(sql).toContain("ON CONFLICT (ip, port)");
      expect(sql).toContain("RETURNING *");
      // 验证参数
      expect(params).toHaveLength(6);
      expect(params[0]).toBe("1.2.3.4");
      expect(params[1]).toBe(8080);
      expect(params[2]).toBe("test");
      expect(params[3]).toBe("http");
      expect(params[4]).toBe(5);
    });

    it("source/protocol 未传时使用默认值（null / http / new Date()）", async () => {
      // 安排
      queryMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      // 执行：不传 source、protocol、created_at
      await insertDeprecatedProxy({
        ip: "1.2.3.4",
        port: 8080,
        failure_count: 0,
      });

      // 验证默认值
      const params = queryMock.mock.calls[0][1];
      expect(params[2]).toBeNull(); // source || null
      expect(params[3]).toBe("http"); // protocol || "http"
      expect(params[5]).toBeInstanceOf(Date); // created_at || new Date()
    });
  });

  describe("isProxyDeprecated", () => {
    it("count > 0 时返回 true", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "3" }], rowCount: 1 });
      const result = await isProxyDeprecated("1.2.3.4", 8080);
      expect(result).toBe(true);
    });

    it("count = 0 时返回 false", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 });
      const result = await isProxyDeprecated("1.2.3.4", 8080);
      expect(result).toBe(false);
    });

    it("调用 query 时传入 ip 和 port 参数", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 });
      await isProxyDeprecated("5.6.7.8", 9090);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SELECT COUNT(*)");
      expect(sql).toContain("WHERE ip = $1 AND port = $2");
      expect(params).toEqual(["5.6.7.8", 9090]);
    });
  });

  describe("getAllDeprecatedProxies", () => {
    it("调用 query 并返回 rows（按 deprecated_at DESC 排序）", async () => {
      const mockRows = [
        { id: 1, ip: "1.1.1.1", port: 80 },
        { id: 2, ip: "2.2.2.2", port: 81 },
      ];
      queryMock.mockResolvedValue({ rows: mockRows, rowCount: 2 });

      const result = await getAllDeprecatedProxies();

      expect(result).toEqual(mockRows);
      const [sql] = queryMock.mock.calls[0];
      expect(sql).toContain("SELECT * FROM xrelay.deprecated_proxies");
      expect(sql).toContain("ORDER BY deprecated_at DESC");
    });
  });

  describe("getDeprecatedProxyCount", () => {
    it("解析 rows[0].count 为数字", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "42" }], rowCount: 1 });
      const result = await getDeprecatedProxyCount();
      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });
  });

  describe("getExpiredDeprecatedProxies", () => {
    it("使用默认 days=30 调用 query", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await getExpiredDeprecatedProxies();
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("WHERE deprecated_at < NOW() - INTERVAL '1 day' * $1");
      expect(params).toEqual([30]);
    });

    it("传入自定义 days 参数", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await getExpiredDeprecatedProxies(60);
      const params = queryMock.mock.calls[0][1];
      expect(params).toEqual([60]);
    });

    it("days=0 时抛出验证错误", async () => {
      await expect(getExpiredDeprecatedProxies(0)).rejects.toThrow(
        "Invalid days parameter",
      );
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("days=1.5（非整数）时抛出验证错误", async () => {
      await expect(getExpiredDeprecatedProxies(1.5)).rejects.toThrow(
        "Invalid days parameter",
      );
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("days=400（超出上限）时抛出验证错误", async () => {
      await expect(getExpiredDeprecatedProxies(400)).rejects.toThrow(
        "Invalid days parameter",
      );
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("days=1（下界）和 days=365（上界）通过验证", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await getExpiredDeprecatedProxies(1);
      await getExpiredDeprecatedProxies(365);
      expect(queryMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("deleteExpiredDeprecatedProxies", () => {
    it("成功删除时返回 rowCount", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 7 });
      const result = await deleteExpiredDeprecatedProxies(30);
      expect(result).toBe(7);
    });

    it("rowCount 为 null 时返回 0", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: null });
      const result = await deleteExpiredDeprecatedProxies(30);
      expect(result).toBe(0);
    });

    it("使用默认 days=30", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await deleteExpiredDeprecatedProxies();
      const params = queryMock.mock.calls[0][1];
      expect(params).toEqual([30]);
    });

    it("days 无效时抛出验证错误且不调用 query", async () => {
      await expect(deleteExpiredDeprecatedProxies(0)).rejects.toThrow(
        "Invalid days parameter",
      );
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe("clearAllDeprecatedProxies", () => {
    it("清空所有废弃代理并返回 rowCount", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 15 });
      const result = await clearAllDeprecatedProxies();
      expect(result).toBe(15);
      const [sql] = queryMock.mock.calls[0];
      expect(sql).toBe("DELETE FROM xrelay.deprecated_proxies");
    });

    it("rowCount 为 null 时返回 0", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: null });
      const result = await clearAllDeprecatedProxies();
      expect(result).toBe(0);
    });
  });

  describe("getDeprecatedProxyStats", () => {
    it("返回 total/expired/recent 三项统计（并行查询）", async () => {
      // Promise.all 按调用顺序返回：total, expired, recent
      queryMock
        .mockResolvedValueOnce({ rows: [{ count: "100" }] })
        .mockResolvedValueOnce({ rows: [{ count: "30" }] })
        .mockResolvedValueOnce({ rows: [{ count: "10" }] });

      const result = await getDeprecatedProxyStats();

      expect(result).toEqual({ total: 100, expired: 30, recent: 10 });
      expect(queryMock).toHaveBeenCalledTimes(3);
    });

    it("验证三条查询的 SQL 语句分别对应 total/expired/recent", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "0" }] });

      await getDeprecatedProxyStats();

      const sqls = queryMock.mock.calls.map((c: unknown[]) => c[0] as string);
      // total: 无 WHERE
      expect(sqls[0]).toContain("SELECT COUNT(*) as count FROM xrelay.deprecated_proxies");
      expect(sqls[0]).not.toContain("WHERE");
      // expired: 30 days 前
      expect(sqls[1]).toContain("WHERE deprecated_at < NOW() - INTERVAL '30 days'");
      // recent: 7 days 内
      expect(sqls[2]).toContain("WHERE deprecated_at >= NOW() - INTERVAL '7 days'");
    });
  });
});
