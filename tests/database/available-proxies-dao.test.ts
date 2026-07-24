/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Available Proxies DAO Tests - 可用代理数据访问层测试
 * 验证 upsertProxy / batchInsertProxies / getAllProxies /
 * getProxiesWithWeight（含 calculateWeight 间接测试） /
 * getWeightedProxies / getProxyCount / incrementFailureCount /
 * incrementSuccessCount / updateLastChecked / deleteProxy /
 * clearAllProxies / getFailedProxies 的行为
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
  upsertProxy,
  batchInsertProxies,
  getAllProxies,
  getProxiesWithWeight,
  getWeightedProxies,
  getProxyCount,
  incrementFailureCount,
  incrementSuccessCount,
  updateLastChecked,
  deleteProxy,
  clearAllProxies,
  getFailedProxies,
} from "../../src/database/available-proxies-dao.js";

describe("Available Proxies DAO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("upsertProxy", () => {
    it("调用 query 并传入正确的 SQL（含 ON CONFLICT）和 7 个参数，返回 rows[0]", async () => {
      // 安排
      const mockRow = { id: 1, ip: "1.2.3.4", port: 8080 };
      queryMock.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // 执行
      const result = await upsertProxy({
        ip: "1.2.3.4",
        port: 8080,
        source: "test",
        failure_count: 0,
        success_count: 1,
        last_used_at: new Date("2026-01-01"),
        last_checked_at: new Date("2026-01-02"),
      });

      // 验证返回值
      expect(result).toEqual(mockRow);
      // 验证 SQL
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("INSERT INTO xrelay.available_proxies");
      expect(sql).toContain("ON CONFLICT (ip, port)");
      expect(sql).toContain("DO UPDATE SET");
      expect(sql).toContain("RETURNING *");
      // 验证参数
      expect(params).toHaveLength(7);
      expect(params[0]).toBe("1.2.3.4");
      expect(params[1]).toBe(8080);
      expect(params[2]).toBe("test");
      expect(params[3]).toBe(0); // failure_count
      expect(params[4]).toBe(1); // success_count
      expect(params[5]).toEqual(new Date("2026-01-01")); // last_used_at
      expect(params[6]).toEqual(new Date("2026-01-02")); // last_checked_at
    });

    it("last_used_at / last_checked_at 未传时传入 null", async () => {
      // 安排
      queryMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      // 执行：不传 last_used_at 和 last_checked_at
      await upsertProxy({
        ip: "1.2.3.4",
        port: 8080,
        source: "test",
        failure_count: 0,
        success_count: 0,
      });

      // 验证
      const params = queryMock.mock.calls[0][1];
      expect(params[5]).toBeNull(); // last_used_at || null
      expect(params[6]).toBeNull(); // last_checked_at || null
    });
  });

  describe("batchInsertProxies", () => {
    it("空数组时返回 0 且不调用 query", async () => {
      const result = await batchInsertProxies([]);
      expect(result).toBe(0);
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("单条数据时构造单条 VALUES 子句", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await batchInsertProxies([
        { ip: "1.2.3.4", port: 8080, source: "test", failure_count: 0 },
      ]);

      expect(result).toBe(1);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("VALUES ($1, $2, $3, $4, 0)");
      expect(sql).toContain("ON CONFLICT (ip, port) DO NOTHING");
      expect(params).toEqual(["1.2.3.4", 8080, "test", 0]);
    });

    it("多条数据时构造多条 VALUES 子句", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 2 });

      const result = await batchInsertProxies([
        { ip: "1.1.1.1", port: 80, source: "a", failure_count: 0 },
        { ip: "2.2.2.2", port: 81, source: "b", failure_count: 1 },
      ]);

      expect(result).toBe(2);
      const [sql, params] = queryMock.mock.calls[0];
      // 两条 VALUES 子句
      expect(sql).toContain("($1, $2, $3, $4, 0)");
      expect(sql).toContain("($5, $6, $7, $8, 0)");
      expect(params).toEqual(["1.1.1.1", 80, "a", 0, "2.2.2.2", 81, "b", 1]);
    });

    it("超过 1000 条时分批处理（验证 query 被调用 2 次，第二批从 index 1000 开始）", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 1000 });

      // 构造 1001 条数据
      const proxies = Array.from({ length: 1001 }, (_, i) => ({
        ip: `10.0.${Math.floor(i / 256)}.${i % 256}`,
        port: 8000 + i,
        source: "test",
        failure_count: 0,
      }));

      const result = await batchInsertProxies(proxies);

      // 验证分批：调用 2 次
      expect(queryMock).toHaveBeenCalledTimes(2);
      // 第一批 1000 条 → 4000 个参数
      const firstBatchParams = queryMock.mock.calls[0][1];
      expect(firstBatchParams).toHaveLength(1000 * 4);
      // 第二批 1 条 → 4 个参数
      const secondBatchParams = queryMock.mock.calls[1][1];
      expect(secondBatchParams).toHaveLength(1 * 4);
      // 第二批的第一个参数应该是 proxies[1000] 的 ip
      expect(secondBatchParams[0]).toBe(proxies[1000].ip);
      // 总计插入数
      expect(result).toBe(2000); // 1000 + 1000
    });
  });

  describe("getAllProxies", () => {
    it("调用 query 并返回 rows（按 updated_at DESC 排序）", async () => {
      const mockRows = [
        { id: 1, ip: "1.1.1.1", port: 80 },
        { id: 2, ip: "2.2.2.2", port: 81 },
      ];
      queryMock.mockResolvedValue({ rows: mockRows, rowCount: 2 });

      const result = await getAllProxies();

      expect(result).toEqual(mockRows);
      const [sql] = queryMock.mock.calls[0];
      expect(sql).toContain("SELECT * FROM xrelay.available_proxies");
      expect(sql).toContain("ORDER BY updated_at DESC");
    });
  });

  describe("getProxiesWithWeight + calculateWeight", () => {
    it("为每条 row 计算 weight（Laplace 平滑）", async () => {
      queryMock.mockResolvedValue({
        rows: [
          { id: 1, success_count: 0, failure_count: 0 },
          { id: 2, success_count: 9, failure_count: 1 },
        ],
        rowCount: 2,
      });

      const result = await getProxiesWithWeight();

      expect(result).toHaveLength(2);
      expect(result[0].weight).toBeCloseTo(0.5, 5); // (0+1)/(0+0+2)
      expect(result[1].weight).toBeCloseTo(10 / 12, 5); // (9+1)/(9+1+2)
    });

    it("calculateWeight：成功 0 失败 0 → 0.5", async () => {
      queryMock.mockResolvedValue({
        rows: [{ id: 1, success_count: 0, failure_count: 0 }],
        rowCount: 1,
      });
      const result = await getProxiesWithWeight();
      expect(result[0].weight).toBeCloseTo(0.5, 5);
    });

    it("calculateWeight：成功 9 失败 1 → 10/12 ≈ 0.833", async () => {
      queryMock.mockResolvedValue({
        rows: [{ id: 1, success_count: 9, failure_count: 1 }],
        rowCount: 1,
      });
      const result = await getProxiesWithWeight();
      expect(result[0].weight).toBeCloseTo(10 / 12, 5);
    });

    it("calculateWeight：成功 0 失败 1 → 1/3 ≈ 0.333", async () => {
      queryMock.mockResolvedValue({
        rows: [{ id: 1, success_count: 0, failure_count: 1 }],
        rowCount: 1,
      });
      const result = await getProxiesWithWeight();
      expect(result[0].weight).toBeCloseTo(1 / 3, 5);
    });

    it("保留原始 row 字段（spread 操作）", async () => {
      queryMock.mockResolvedValue({
        rows: [{ id: 5, ip: "1.2.3.4", port: 8080, success_count: 3, failure_count: 1 }],
        rowCount: 1,
      });
      const result = await getProxiesWithWeight();
      expect(result[0].id).toBe(5);
      expect(result[0].ip).toBe("1.2.3.4");
      expect(result[0].port).toBe(8080);
      expect(result[0]).toHaveProperty("weight");
    });
  });

  describe("getWeightedProxies", () => {
    it("主查询有结果时直接返回", async () => {
      const mockRows = [{ id: 1, ip: "1.2.3.4", port: 8080 }];
      queryMock.mockResolvedValue({ rows: mockRows, rowCount: 1 });

      const result = await getWeightedProxies(5);

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRows);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("weight_score IS NOT NULL");
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([5]);
    });

    it("主查询无结果时降级到 fallback 查询", async () => {
      const fallbackRows = [{ id: 2, ip: "5.6.7.8", port: 9090 }];
      queryMock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: fallbackRows, rowCount: 1 });

      const result = await getWeightedProxies(3);

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual(fallbackRows);
      // 验证 fallback SQL 不包含 weight_score 条件
      const fallbackSql = queryMock.mock.calls[1][0];
      expect(fallbackSql).not.toContain("weight_score IS NOT NULL");
      expect(fallbackSql).toContain("LIMIT $1");
    });
  });

  describe("getProxyCount", () => {
    it("解析 rows[0].count 为数字", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "42" }], rowCount: 1 });
      const result = await getProxyCount();
      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });

    it("count 为 0 时返回 0", async () => {
      queryMock.mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 });
      const result = await getProxyCount();
      expect(result).toBe(0);
    });
  });

  describe("incrementFailureCount", () => {
    it("rows 非空时返回 rows[0]", async () => {
      const mockRow = { id: 1, ip: "1.2.3.4", port: 8080, failure_count: 2 };
      queryMock.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      const result = await incrementFailureCount("1.2.3.4", 8080);

      expect(result).toEqual(mockRow);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET failure_count = failure_count + 1");
      expect(sql).toContain("WHERE ip = $1 AND port = $2");
      expect(sql).toContain("RETURNING *");
      expect(params).toEqual(["1.2.3.4", 8080]);
    });

    it("rows 为空时返回 null", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      const result = await incrementFailureCount("1.2.3.4", 8080);
      expect(result).toBeNull();
    });
  });

  describe("incrementSuccessCount", () => {
    it("rows 非空时返回 rows[0]", async () => {
      const mockRow = { id: 1, ip: "1.2.3.4", port: 8080, success_count: 5 };
      queryMock.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      const result = await incrementSuccessCount("1.2.3.4", 8080);

      expect(result).toEqual(mockRow);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET success_count = success_count + 1");
      expect(sql).toContain("last_used_at = CURRENT_TIMESTAMP");
      expect(sql).toContain("RETURNING *");
      expect(params).toEqual(["1.2.3.4", 8080]);
    });

    it("rows 为空时返回 null", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      const result = await incrementSuccessCount("1.2.3.4", 8080);
      expect(result).toBeNull();
    });
  });

  describe("updateLastChecked", () => {
    it("调用 query 且无返回值", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await updateLastChecked("1.2.3.4", 8080);

      expect(result).toBeUndefined();
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET last_checked_at = CURRENT_TIMESTAMP");
      expect(sql).toContain("updated_at = CURRENT_TIMESTAMP");
      expect(sql).toContain("WHERE ip = $1 AND port = $2");
      expect(params).toEqual(["1.2.3.4", 8080]);
    });
  });

  describe("deleteProxy", () => {
    it("rowCount > 0 时返回 true", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
      const result = await deleteProxy("1.2.3.4", 8080);
      expect(result).toBe(true);
    });

    it("rowCount = 0 时返回 false", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      const result = await deleteProxy("1.2.3.4", 8080);
      expect(result).toBe(false);
    });

    it("rowCount 为 null 时返回 false", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: null });
      const result = await deleteProxy("1.2.3.4", 8080);
      expect(result).toBe(false);
    });
  });

  describe("clearAllProxies", () => {
    it("返回 rowCount", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 25 });
      const result = await clearAllProxies();
      expect(result).toBe(25);
      const [sql] = queryMock.mock.calls[0];
      expect(sql).toBe("DELETE FROM xrelay.available_proxies");
    });

    it("rowCount 为 null 时返回 0", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: null });
      const result = await clearAllProxies();
      expect(result).toBe(0);
    });
  });

  describe("getFailedProxies", () => {
    it("使用默认 threshold=10", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await getFailedProxies();
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("WHERE failure_count >= $1");
      expect(params).toEqual([10]);
    });

    it("传入自定义 threshold 参数", async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      await getFailedProxies(5);
      const params = queryMock.mock.calls[0][1];
      expect(params).toEqual([5]);
    });

    it("返回查询结果 rows", async () => {
      const mockRows = [
        { id: 1, ip: "1.2.3.4", port: 8080, failure_count: 15 },
      ];
      queryMock.mockResolvedValue({ rows: mockRows, rowCount: 1 });
      const result = await getFailedProxies(10);
      expect(result).toEqual(mockRows);
    });
  });
});
