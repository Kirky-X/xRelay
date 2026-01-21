/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Connection - 数据库连接管理
 * 支持 Vercel 无服务器连接和传统连接池
 */

import pg from "pg";

const { Pool } = pg;

// 数据库连接池（非 Vercel 环境）
let pool: pg.Pool | null = null;
let isDatabaseEnabled = false;
let useVercelPostgres = false;
let initializationPromise: Promise<boolean> | null = null;

/**
 * 检测是否在 Vercel 环境中运行
 */
function isVercelEnvironment(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV !== undefined ||
    process.env.AWS_LAMBDA_FUNCTION_VERSION !== undefined
  );
}

/**
 * 初始化数据库连接
 */
export async function initDatabase(): Promise<boolean> {
  // 如果已经初始化成功，直接返回
  if (isDatabaseEnabled) {
    return true;
  }

  // 如果正在初始化，等待结果
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.log("[Database] DATABASE_URL not configured, using memory mode");
      isDatabaseEnabled = false;
      return false;
    }

    // 检测是否在 Vercel 环境
    useVercelPostgres = isVercelEnvironment();

    if (useVercelPostgres) {
      console.log("[Database] Using Vercel Postgres serverless client");
      isDatabaseEnabled = true;

      // 自动运行迁移
      await autoRunMigration();

      return true;
    }

    // 传统环境使用连接池
    try {
      pool = new Pool({
        connectionString: databaseUrl,
        max: 20, // 最大连接数
        idleTimeoutMillis: 30000, // 空闲连接超时 30 秒
        connectionTimeoutMillis: 5000, // 连接超时 5 秒
      });

      // 测试连接
      const client = await pool.connect();
      await client.query("SELECT NOW()");
      client.release();

      console.log("[Database] Database connection pool established successfully");
      isDatabaseEnabled = true;

      // 自动运行迁移
      await autoRunMigration();

      return true;
    } catch (error) {
      console.error("[Database] Failed to connect to database:", error);
      console.log("[Database] Falling back to memory mode");
      isDatabaseEnabled = false;
      pool = null;
      return false;
    }
  })();

  try {
    return await initializationPromise;
  } finally {
    // 如果失败，重置 promise 以便重试
    if (!isDatabaseEnabled) {
      initializationPromise = null;
    }
  }
}

/**
 * 获取数据库连接池
 */
export function getPool(): pg.Pool | null {
  return pool;
}

/**
 * 检查数据库是否启用
 */
export function isDatabaseReady(): boolean {
  return isDatabaseEnabled;
}

/**
 * 执行查询
 */
export async function query(
  text: string,
  params?: any[],
): Promise<pg.QueryResult> {
  const start = Date.now();

  if (useVercelPostgres) {
    // Vercel 环境：使用无服务器客户端
    try {
      const { createClient } = await import("@vercel/postgres");
      const client = createClient();

      // 使用 query 方法（VercelClient 继承自 pg.Client）
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      console.log(`[Database] Query executed in ${duration}ms: ${text.substring(0, 100)}...`);

      return result;
    } catch (error) {
      console.error("[Database] Vercel Postgres query failed:", error);
      throw error;
    }
  } else {
    // 传统环境：使用连接池
    if (!pool) {
      throw new Error("Database not initialized");
    }

    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      console.log(`[Database] Query executed in ${duration}ms: ${text.substring(0, 100)}...`);
      return result;
    } catch (error) {
      console.error("[Database] Query failed:", error);
      throw error;
    }
  }
}

/**
 * 执行事务
 */
export async function transaction(
  callback: (client: any) => Promise<any>,
): Promise<any> {
  if (useVercelPostgres) {
    // Vercel 环境：使用 @vercel/postgres 的事务
    const { createClient } = await import("@vercel/postgres");
    const client = createClient();
    try {
      await client.connect();
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  } else {
    // 传统环境：使用连接池事务
    if (!pool) {
      throw new Error("Database not initialized");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (useVercelPostgres) {
    console.log("[Database] Vercel Postgres uses serverless connections, no close needed");
    return;
  }

  if (pool) {
    await pool.end();
    pool = null;
    isDatabaseEnabled = false;
    console.log("[Database] Database connection pool closed");
  }
}

/**
 * 获取数据库状态
 */
export function getDatabaseStatus(): {
  enabled: boolean;
  connected: boolean;
  poolSize?: number;
  mode: "vercel" | "pool" | "disabled";
} {
  return {
    enabled: isDatabaseEnabled,
    connected: isDatabaseEnabled,
    poolSize: pool?.totalCount,
    mode: useVercelPostgres ? "vercel" : (pool ? "pool" : "disabled"),
  };
}

/**
 * 自动运行迁移
 */
async function autoRunMigration(): Promise<void> {
  try {
    console.log("[Database] Checking for pending migrations...");

    // 确保 schema 存在
    await query("CREATE SCHEMA IF NOT EXISTS xrelay");

    // 创建迁移记录表（如果不存在）
    await query(`
      CREATE TABLE IF NOT EXISTS xrelay.migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 检查是否已执行过迁移
    const migrationName = "initial_schema_v1.0.0";
    const result = await query(
      "SELECT COUNT(*) as count FROM xrelay.migrations WHERE name = $1",
      [migrationName]
    );

    const executedCount = parseInt(result.rows[0].count as string, 10);

    if (executedCount > 0) {
      console.log("[Database] Migration already executed, skipping");
      return;
    }

    // 执行迁移
    console.log("[Database] Running initial migration...");
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const schemaPath = join(__dirname, "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");

    // 分割 SQL 语句并逐个执行
    const statements = schemaSql
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      if (statement.trim()) {
        await query(statement);
      }
    }

    // 记录迁移
    await query(
      "INSERT INTO xrelay.migrations (name) VALUES ($1)",
      [migrationName]
    );

    console.log("[Database] Initial migration completed successfully");
  } catch (error) {
    console.error("[Database] Auto migration failed:", error);
    // 不抛出错误，允许应用继续运行
  }
}