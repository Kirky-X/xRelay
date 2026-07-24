/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Database Connection Tests - 数据库连接管理测试
 * 验证 initDatabase / getPool / isDatabaseReady / query / transaction /
 * closeDatabase / getDatabaseStatus 以及私有 autoRunMigration 的行为
 *
 * 设计说明：
 * - connection.ts 包含模块级状态（pool / isDatabaseEnabled / useVercelPostgres / initializationPromise）
 * - 每个用例通过 vi.resetModules() + 动态 import 获取全新模块实例
 * - Mock pg.Pool / @vercel/postgres.createClient / logger / config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ 问题
const mocks = vi.hoisted(() => {
  // Pool 模式下的 client（pool.connect() 返回）
  const poolClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  // Pool 实例（new Pool() 返回）
  const pool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    totalCount: 0,
  };
  const poolConstructor = vi.fn();
  // Vercel 模式下的 client（createClient() 返回）
  const vercelClient = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  };
  const createClient = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { poolClient, pool, poolConstructor, vercelClient, createClient, logger };
});

// Mock pg 模块 - 源码使用 `import pg from "pg"; const { Pool } = pg;`
// 同时提供 default 和顶层 Pool 以兼容不同导入方式
vi.mock("pg", () => {
  const Pool = mocks.poolConstructor;
  return { default: { Pool }, Pool };
});

// Mock @vercel/postgres 模块
vi.mock("@vercel/postgres", () => ({
  createClient: mocks.createClient,
}));

// Mock logger 模块（避免 console 输出污染）
vi.mock("../../src/logger.js", () => ({
  logger: mocks.logger,
}));

// Mock config 模块
vi.mock("../../src/config.js", () => ({
  DATABASE_CONFIG: {
    pool: {
      maxConnections: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },
}));

describe("Database Connection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // === 设置默认 mock 实现 ===
    // Pool 构造函数返回 pool 实例（必须用 function 关键字，不能用箭头函数，
    // 因为源码使用 `new Pool(...)` 调用，箭头函数不支持 [[Construct]]）
    mocks.poolConstructor.mockImplementation(function () {
      return mocks.pool;
    });
    // Pool.connect 返回 poolClient
    mocks.pool.connect.mockResolvedValue(mocks.poolClient);
    // Pool.query 默认返回空结果
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.pool.end.mockResolvedValue(undefined);
    // poolClient.query 默认返回空结果（用于 SELECT NOW() 测试连接）
    mocks.poolClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.poolClient.release.mockReturnValue(undefined);

    // Vercel createClient 返回 vercelClient
    mocks.createClient.mockImplementation(() => mocks.vercelClient);
    mocks.vercelClient.connect.mockResolvedValue(undefined);
    mocks.vercelClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.vercelClient.end.mockResolvedValue(undefined);

    // 清理环境变量
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ============================================================
  // 辅助函数：设置迁移查询的 mock（SELECT COUNT 返回指定值）
  // ============================================================
  function setupPoolMigrationMock(count: string) {
    mocks.pool.query.mockImplementation((text: string) => {
      if (text.includes("SELECT COUNT")) {
        return Promise.resolve({ rows: [{ count }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  function setupVercelMigrationMock(count: string) {
    mocks.vercelClient.query.mockImplementation((text: string) => {
      if (text.includes("SELECT COUNT")) {
        return Promise.resolve({ rows: [{ count }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  // ============================================================
  // initDatabase
  // ============================================================
  describe("initDatabase", () => {
    it("无 DATABASE_URL 时返回 false，不创建 Pool", async () => {
      const { initDatabase } = await import("../../src/database/connection.js");
      const result = await initDatabase();

      expect(result).toBe(false);
      expect(mocks.poolConstructor).not.toHaveBeenCalled();
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        "DATABASE_URL not configured, using memory mode",
        expect.any(Object),
      );
    });

    it("Vercel 环境 + DATABASE_URL 时使用 @vercel/postgres 并自动调用 autoRunMigration", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1"); // 迁移已执行

      const { initDatabase } = await import("../../src/database/connection.js");
      const result = await initDatabase();

      expect(result).toBe(true);
      // Vercel 模式不创建 Pool
      expect(mocks.poolConstructor).not.toHaveBeenCalled();
      // createClient 被调用（autoRunMigration 使用 query → createClient）
      expect(mocks.createClient).toHaveBeenCalled();
      // 验证 autoRunMigration 执行了 CREATE SCHEMA
      expect(mocks.vercelClient.query).toHaveBeenCalledWith(
        "CREATE SCHEMA IF NOT EXISTS xrelay",
        undefined,
      );
    });

    it("非 Vercel 环境 + DATABASE_URL 时创建 Pool，连接测试成功后返回 true", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1"); // 迁移已执行

      const { initDatabase } = await import("../../src/database/connection.js");
      const result = await initDatabase();

      expect(result).toBe(true);
      // 验证 Pool 被创建
      expect(mocks.poolConstructor).toHaveBeenCalledTimes(1);
      expect(mocks.poolConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: "postgresql://test",
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        }),
      );
      // 验证连接测试：connect → query("SELECT NOW()") → release
      expect(mocks.pool.connect).toHaveBeenCalled();
      expect(mocks.poolClient.query).toHaveBeenCalledWith("SELECT NOW()");
      expect(mocks.poolClient.release).toHaveBeenCalled();
    });

    it("非 Vercel 环境 + Pool 连接失败时返回 false，记录错误日志", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      mocks.pool.connect.mockRejectedValue(new Error("Connection refused"));

      const { initDatabase } = await import("../../src/database/connection.js");
      const result = await initDatabase();

      expect(result).toBe(false);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect to database"),
        expect.any(Error),
        expect.any(Object),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        "Falling back to memory mode",
        expect.any(Object),
      );
    });

    it("已初始化时直接返回 true（缓存）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const { initDatabase } = await import("../../src/database/connection.js");

      // 第一次调用：执行初始化
      const firstResult = await initDatabase();
      expect(firstResult).toBe(true);

      // 记录第一次调用后的 createClient 调用次数
      const callsAfterFirst = mocks.createClient.mock.calls.length;

      // 第二次调用：应直接返回 true，不触发新的 createClient
      const secondResult = await initDatabase();
      expect(secondResult).toBe(true);
      expect(mocks.createClient.mock.calls.length).toBe(callsAfterFirst);
    });

    it("并发调用时只执行一次初始化（initializationPromise 缓存）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");
      // 让 connect 延迟返回，确保两个 initDatabase 并发
      mocks.pool.connect.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mocks.poolClient), 50)),
      );

      const { initDatabase } = await import("../../src/database/connection.js");
      // 并发调用
      const [result1, result2] = await Promise.all([initDatabase(), initDatabase()]);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      // Pool 构造函数只被调用一次
      expect(mocks.poolConstructor).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // query
  // ============================================================
  describe("query", () => {
    it("Vercel 模式下创建 client、connect、query、end（成功路径）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      // 重新设置 query mock（clearAllMocks 不清除实现，但为保险重新设置）
      mocks.createClient.mockImplementation(() => mocks.vercelClient);
      mocks.vercelClient.connect.mockResolvedValue(undefined);
      mocks.vercelClient.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
      mocks.vercelClient.end.mockResolvedValue(undefined);

      const result = await mod.query("SELECT * FROM test", [1]);

      expect(mocks.createClient).toHaveBeenCalledTimes(1);
      expect(mocks.vercelClient.connect).toHaveBeenCalledTimes(1);
      expect(mocks.vercelClient.query).toHaveBeenCalledWith("SELECT * FROM test", [1]);
      expect(mocks.vercelClient.end).toHaveBeenCalledTimes(1);
      expect(result.rows).toEqual([{ id: 1 }]);
    });

    it("Vercel 模式下 client.query 失败时抛出错误并记录", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.createClient.mockImplementation(() => mocks.vercelClient);
      mocks.vercelClient.connect.mockResolvedValue(undefined);
      mocks.vercelClient.query.mockRejectedValue(new Error("Query failed"));
      mocks.vercelClient.end.mockResolvedValue(undefined);

      await expect(mod.query("SELECT * FROM test")).rejects.toThrow("Query failed");
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Vercel Postgres query failed"),
        expect.any(Error),
        expect.any(Object),
      );
    });

    it("Vercel 模式下 client.end 失败时记录 debug 但不抛出", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.createClient.mockImplementation(() => mocks.vercelClient);
      mocks.vercelClient.connect.mockResolvedValue(undefined);
      mocks.vercelClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      mocks.vercelClient.end.mockRejectedValue(new Error("End failed"));

      // query 不应因 end 失败而抛错
      const result = await mod.query("SELECT * FROM test");
      expect(result).toEqual({ rows: [], rowCount: 0 });
      // 验证 debug 日志被调用
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("client end failed"),
        expect.any(Object),
      );
    });

    it("Pool 模式 + pool=null 时抛出 'Database not initialized'", async () => {
      // 不调用 initDatabase，pool 为 null
      const { query } = await import("../../src/database/connection.js");

      await expect(query("SELECT 1")).rejects.toThrow("Database not initialized");
    });

    it("Pool 模式 + pool.query 成功时返回结果", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      // 设置 pool.query 返回值
      mocks.pool.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await mod.query("SELECT * FROM test", [1]);

      expect(mocks.pool.query).toHaveBeenCalledWith("SELECT * FROM test", [1]);
      expect(result.rows).toEqual([{ id: 1 }]);
      // Vercel 模式未被使用
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("Pool 模式 + pool.query 失败时抛出错误并记录", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.pool.query.mockRejectedValue(new Error("Pool query failed"));

      await expect(mod.query("SELECT * FROM test")).rejects.toThrow("Pool query failed");
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Query failed"),
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  // ============================================================
  // transaction
  // ============================================================
  describe("transaction", () => {
    it("Vercel 模式成功路径（BEGIN/COMMIT/END）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.createClient.mockImplementation(() => mocks.vercelClient);
      mocks.vercelClient.connect.mockResolvedValue(undefined);
      mocks.vercelClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      mocks.vercelClient.end.mockResolvedValue(undefined);

      const callback = vi.fn().mockResolvedValue("result");
      const result = await mod.transaction(callback);

      expect(mocks.vercelClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mocks.vercelClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mocks.vercelClient.end).toHaveBeenCalledTimes(1);
      expect(result).toBe("result");
    });

    it("Vercel 模式 callback 抛错时 ROLLBACK 并 rethrow", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.createClient.mockImplementation(() => mocks.vercelClient);
      mocks.vercelClient.connect.mockResolvedValue(undefined);
      mocks.vercelClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      mocks.vercelClient.end.mockResolvedValue(undefined);

      const callback = vi.fn().mockRejectedValue(new Error("Callback failed"));
      await expect(mod.transaction(callback)).rejects.toThrow("Callback failed");
      expect(mocks.vercelClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mocks.vercelClient.end).toHaveBeenCalledTimes(1);
    });

    it("Pool 模式 + pool=null 时抛错", async () => {
      // 不调用 initDatabase，pool 为 null
      const { transaction } = await import("../../src/database/connection.js");

      await expect(transaction(async () => {})).rejects.toThrow(
        "Database not initialized",
      );
    });

    it("Pool 模式成功路径（BEGIN/COMMIT/release）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.pool.connect.mockResolvedValue(mocks.poolClient);
      mocks.poolClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const callback = vi.fn().mockResolvedValue("tx-result");
      const result = await mod.transaction(callback);

      expect(mocks.poolClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mocks.poolClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mocks.poolClient.release).toHaveBeenCalledTimes(1);
      expect(result).toBe("tx-result");
    });

    it("Pool 模式 callback 抛错时调用 ROLLBACK 并 release", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.pool.connect.mockResolvedValue(mocks.poolClient);
      mocks.poolClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const callback = vi.fn().mockRejectedValue(new Error("Callback failed"));
      await expect(mod.transaction(callback)).rejects.toThrow("Callback failed");
      expect(mocks.poolClient.query).toHaveBeenCalledWith("ROLLBACK");
      // release 在 finally 中调用，即使抛错也会执行
      expect(mocks.poolClient.release).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // closeDatabase
  // ============================================================
  describe("closeDatabase", () => {
    it("Vercel 模式下不操作（不调用 pool.end）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      await mod.closeDatabase();

      // Vercel 模式下不调用 pool.end
      expect(mocks.pool.end).not.toHaveBeenCalled();
      // 数据库仍然启用
      expect(mod.isDatabaseReady()).toBe(true);
    });

    it("Pool 模式下调用 pool.end() 并清空 pool", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      vi.clearAllMocks();

      mocks.pool.end.mockResolvedValue(undefined);
      await mod.closeDatabase();

      expect(mocks.pool.end).toHaveBeenCalledTimes(1);
      // pool 已清空
      expect(mod.getPool()).toBeNull();
      expect(mod.isDatabaseReady()).toBe(false);
    });

    it("Pool 模式下 pool=null 时不操作", async () => {
      // 不调用 initDatabase
      const { closeDatabase, getPool } = await import("../../src/database/connection.js");

      await closeDatabase();

      expect(getPool()).toBeNull();
      expect(mocks.pool.end).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // getDatabaseStatus
  // ============================================================
  describe("getDatabaseStatus", () => {
    it("未初始化时返回 disabled 状态", async () => {
      const { getDatabaseStatus } = await import("../../src/database/connection.js");
      const status = getDatabaseStatus();

      expect(status.enabled).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.mode).toBe("disabled");
      expect(status.poolSize).toBeUndefined();
    });

    it("Vercel 模式返回 vercel 状态", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();

      const status = mod.getDatabaseStatus();
      expect(status.enabled).toBe(true);
      expect(status.connected).toBe(true);
      expect(status.mode).toBe("vercel");
    });

    it("Pool 模式返回 pool 状态", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();

      const status = mod.getDatabaseStatus();
      expect(status.enabled).toBe(true);
      expect(status.connected).toBe(true);
      expect(status.mode).toBe("pool");
      expect(status.poolSize).toBe(0); // mockPool.totalCount = 0
    });
  });

  // ============================================================
  // getPool / isDatabaseReady
  // ============================================================
  describe("getPool", () => {
    it("未初始化时返回 null", async () => {
      const { getPool } = await import("../../src/database/connection.js");
      expect(getPool()).toBeNull();
    });

    it("Pool 模式下返回 pool 实例", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      setupPoolMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();

      expect(mod.getPool()).toBe(mocks.pool);
    });

    it("Vercel 模式下返回 null", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();

      expect(mod.getPool()).toBeNull();
    });
  });

  describe("isDatabaseReady", () => {
    it("未初始化时返回 false", async () => {
      const { isDatabaseReady } = await import("../../src/database/connection.js");
      expect(isDatabaseReady()).toBe(false);
    });

    it("初始化后返回 true", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("1");

      const mod = await import("../../src/database/connection.js");
      await mod.initDatabase();
      expect(mod.isDatabaseReady()).toBe(true);
    });
  });

  // ============================================================
  // autoRunMigration（通过 initDatabase 间接测试）
  // ============================================================
  describe("autoRunMigration", () => {
    it("迁移已执行时跳过（SELECT COUNT 返回 >0）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("5"); // 迁移已执行

      const { initDatabase } = await import("../../src/database/connection.js");
      await initDatabase();

      // 验证没有 INSERT INTO migrations 调用
      const insertCalls = mocks.vercelClient.query.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("INSERT INTO xrelay.migrations"),
      );
      expect(insertCalls).toHaveLength(0);

      // 验证执行了基础查询：CREATE SCHEMA + CREATE TABLE migrations + SELECT COUNT
      expect(mocks.vercelClient.query).toHaveBeenCalledWith(
        "CREATE SCHEMA IF NOT EXISTS xrelay",
        undefined,
      );
    });

    it("首次执行时一次性发送 SCHEMA_SQL 并插入 migrations 记录", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";
      setupVercelMigrationMock("0"); // 首次执行

      const { initDatabase } = await import("../../src/database/connection.js");
      await initDatabase();

      // 验证 CREATE SCHEMA 被调用
      expect(mocks.vercelClient.query).toHaveBeenCalledWith(
        "CREATE SCHEMA IF NOT EXISTS xrelay",
        undefined,
      );

      // 验证 INSERT INTO migrations 被调用
      const insertCalls = mocks.vercelClient.query.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("INSERT INTO xrelay.migrations"),
      );
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0][1]).toEqual(["initial_schema_v1.0.0"]);

      // 验证 query 调用次数：
      //   1) CREATE SCHEMA
      //   2) CREATE TABLE migrations
      //   3) SELECT COUNT(*) 检查迁移
      //   4) SCHEMA_SQL 整块发送（含 PL/pgSQL $$ 块，不能 split(";")）
      //   5) INSERT INTO migrations 记录
      // 实现明确选择一次性发送完整 SCHEMA_SQL，因为 $$ ... $$ 块内含分号，
      // split(";") 会破坏 PL/pgSQL 函数体语法。
      const allQueryCalls = mocks.vercelClient.query.mock.calls.length;
      expect(allQueryCalls).toBe(5);

      // 验证 SCHEMA_SQL 作为单条整块语句被发送（不是拆分后的片段）
      const schemaSqlCalls = mocks.vercelClient.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("CREATE TABLE IF NOT EXISTS xrelay.available_proxies"),
      );
      expect(schemaSqlCalls).toHaveLength(1);
      // 该整块 SQL 应包含触发器函数定义（含 $$ 块）
      expect(schemaSqlCalls[0][0]).toContain("update_updated_at_column");
      expect(schemaSqlCalls[0][0]).toContain("LANGUAGE plpgsql");
    });

    it("失败时不抛出错误，仅记录（initDatabase 仍返回 true）", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL = "1";

      // 让 CREATE SCHEMA 失败
      mocks.vercelClient.query.mockImplementation((text: string) => {
        if (text.includes("CREATE SCHEMA")) {
          return Promise.reject(new Error("Schema creation failed"));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const { initDatabase } = await import("../../src/database/connection.js");
      const result = await initDatabase();

      // autoRunMigration 捕获错误，initDatabase 仍返回 true
      expect(result).toBe(true);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Auto migration failed"),
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  // ============================================================
  // isVercelEnvironment（通过 initDatabase 间接测试）
  // ============================================================
  describe("isVercelEnvironment（通过 initDatabase 间接测试）", () => {
    it("VERCEL_ENV 环境变量触发 Vercel 模式", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.VERCEL_ENV = "production";
      setupVercelMigrationMock("1");

      const { initDatabase, getDatabaseStatus } = await import(
        "../../src/database/connection.js"
      );
      await initDatabase();

      expect(getDatabaseStatus().mode).toBe("vercel");
      expect(mocks.poolConstructor).not.toHaveBeenCalled();
    });

    it("AWS_LAMBDA_FUNCTION_VERSION 环境变量触发 Vercel 模式", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      process.env.AWS_LAMBDA_FUNCTION_VERSION = "1";
      setupVercelMigrationMock("1");

      const { initDatabase, getDatabaseStatus } = await import(
        "../../src/database/connection.js"
      );
      await initDatabase();

      expect(getDatabaseStatus().mode).toBe("vercel");
    });

    it("无 Vercel 环境变量时使用 Pool 模式", async () => {
      process.env.DATABASE_URL = "postgresql://test";
      // 确保没有 Vercel 环境变量
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      setupPoolMigrationMock("1");

      const { initDatabase, getDatabaseStatus } = await import(
        "../../src/database/connection.js"
      );
      await initDatabase();

      expect(getDatabaseStatus().mode).toBe("pool");
      expect(mocks.poolConstructor).toHaveBeenCalled();
    });
  });
});
