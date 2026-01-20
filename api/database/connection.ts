/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Connection - 数据库连接管理
 * 管理 PostgreSQL 连接池，提供连接获取和释放功能
 */

import pg from "pg";

const { Pool } = pg;

// 数据库连接池
let pool: pg.Pool | null = null;
let isDatabaseEnabled = false;

/**
 * 初始化数据库连接
 */
export async function initDatabase(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.log("[Database] DATABASE_URL not configured, using memory mode");
    isDatabaseEnabled = false;
    return false;
  }

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

    console.log("[Database] Database connection established successfully");
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
  return isDatabaseEnabled && pool !== null;
}

/**
 * 执行查询
 */
export async function query(
  text: string,
  params?: any[],
): Promise<pg.QueryResult> {
  if (!pool) {
    throw new Error("Database not initialized");
  }

  const start = Date.now();
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

/**
 * 执行事务
 */
export async function transaction(
  callback: (client: pg.PoolClient) => Promise<any>,
): Promise<any> {
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

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    isDatabaseEnabled = false;
    console.log("[Database] Database connection closed");
  }
}

/**
 * 获取数据库状态
 */
export function getDatabaseStatus(): {
  enabled: boolean;
  connected: boolean;
  poolSize?: number;
} {
  return {
    enabled: isDatabaseEnabled,
    connected: pool !== null && pool.totalCount > 0,
    poolSize: pool?.totalCount,
  };
}

/**
 * 自动运行迁移
 */
async function autoRunMigration(): Promise<void> {
  if (!pool) {
    return;
  }

  try {
    console.log("[Database] Checking for pending migrations...");

    // 创建迁移记录表（如果不存在）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xrelay.migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 检查是否已执行过迁移
    const migrationName = "initial_schema_v1.0.0";
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM xrelay.migrations WHERE name = $1",
      [migrationName]
    );

    const executedCount = parseInt(result.rows[0].count, 10);

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

    // 执行 schema
    await pool.query(schemaSql);

    // 记录迁移
    await pool.query(
      "INSERT INTO xrelay.migrations (name) VALUES ($1)",
      [migrationName]
    );

    console.log("[Database] Initial migration completed successfully");
  } catch (error) {
    console.error("[Database] Auto migration failed:", error);
    // 不抛出错误，允许应用继续运行
  }
}