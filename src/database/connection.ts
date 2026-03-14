/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Connection - 数据库连接管理
 * 支持 Vercel 无服务器连接和传统连接池
 */

import pg from "pg";
import { createClient } from "@vercel/postgres";
import { DATABASE_CONFIG } from "../config.js";
import { logger } from "../logger.js";

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
      logger.info("DATABASE_URL not configured, using memory mode", { module: 'Database' });
      isDatabaseEnabled = false;
      return false;
    }

    // 检测是否在 Vercel 环境
    useVercelPostgres = isVercelEnvironment();

    if (useVercelPostgres) {
      logger.info("Using Vercel Postgres serverless client", { module: 'Database' });
      isDatabaseEnabled = true;

      // 自动运行迁移
      await autoRunMigration();

      return true;
    }

    // 传统环境使用连接池
    try {
      pool = new Pool({
        connectionString: databaseUrl,
        max: DATABASE_CONFIG.pool.maxConnections,
        idleTimeoutMillis: DATABASE_CONFIG.pool.idleTimeoutMillis,
        connectionTimeoutMillis: DATABASE_CONFIG.pool.connectionTimeoutMillis,
      });

      // 测试连接
      const client = await pool.connect();
      await client.query("SELECT NOW()");
      client.release();

      logger.info("Database connection pool established successfully", { module: 'Database' });
      isDatabaseEnabled = true;

      // 自动运行迁移
      await autoRunMigration();

      return true;
    } catch (error) {
      logger.error(
        `Failed to connect to database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'Database' }
      );
      logger.info("Falling back to memory mode", { module: 'Database' });
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
  params?: unknown[],
): Promise<pg.QueryResult> {
  const start = Date.now();

  if (useVercelPostgres) {
    // Vercel 环境：使用无服务器客户端
    try {
      const client = createClient();

      // 使用 query 方法（VercelClient 继承自 pg.Client）
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      logger.debug(`Query executed in ${duration}ms`, { module: 'Database' });

      return result;
    } catch (error) {
      logger.error(
        `Vercel Postgres query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'Database' }
      );
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
      logger.debug(`Query executed in ${duration}ms`, { module: 'Database' });
      return result;
    } catch (error) {
      logger.error(
        `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'Database' }
      );
      throw error;
    }
  }
}

/**
 * 执行事务
 */
export async function transaction(
  callback: (client: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (useVercelPostgres) {
    // Vercel 环境：使用 @vercel/postgres 的事务
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
    logger.debug("Vercel Postgres uses serverless connections, no close needed", { module: 'Database' });
    return;
  }

  if (pool) {
    await pool.end();
    pool = null;
    isDatabaseEnabled = false;
    logger.info("Database connection pool closed", { module: 'Database' });
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
 * 内联的数据库 Schema SQL
 * 用于 Edge Runtime 环境（不支持 fs 模块）
 */
const SCHEMA_SQL = `
  -- 可用代理表
  CREATE TABLE IF NOT EXISTS xrelay.available_proxies (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
    source VARCHAR(50) DEFAULT 'unknown',
    protocol VARCHAR(10) DEFAULT 'http',
    failure_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    weight_score FLOAT DEFAULT 0.5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ip, port)
  );

  -- 废弃代理表
  CREATE TABLE IF NOT EXISTS xrelay.deprecated_proxies (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
    source VARCHAR(50) DEFAULT 'unknown',
    protocol VARCHAR(10) DEFAULT 'http',
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deprecated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ip, port)
  );

  -- 创建索引
  CREATE INDEX IF NOT EXISTS idx_available_proxies_ip_port ON xrelay.available_proxies(ip, port);
  CREATE INDEX IF NOT EXISTS idx_available_proxies_failure ON xrelay.available_proxies(failure_count);
  CREATE INDEX IF NOT EXISTS idx_available_proxies_weight ON xrelay.available_proxies(weight_score DESC);
  CREATE INDEX IF NOT EXISTS idx_deprecated_proxies_created ON xrelay.deprecated_proxies(created_at);

  -- 创建更新时间触发器函数
  CREATE OR REPLACE FUNCTION xrelay.update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    NEW.weight_score = CASE 
      WHEN (NEW.success_count + NEW.failure_count + 2) = 0 THEN 0.5
      ELSE (NEW.success_count + 1.0) / (NEW.success_count + NEW.failure_count + 2.0)
    END;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  -- 创建触发器
  DROP TRIGGER IF EXISTS update_available_proxies_updated_at ON xrelay.available_proxies;
  CREATE TRIGGER update_available_proxies_updated_at
    BEFORE UPDATE ON xrelay.available_proxies
    FOR EACH ROW
    EXECUTE FUNCTION xrelay.update_updated_at_column();
`;

/**
 * 自动运行迁移
 * 使用内联 SQL，兼容 Edge Runtime
 */
async function autoRunMigration(): Promise<void> {
  try {
    logger.debug("Checking for pending migrations...", { module: 'Database' });

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
      logger.debug("Migration already executed, skipping", { module: 'Database' });
      return;
    }

    // 执行迁移（使用内联 SQL）
    logger.info("Running initial migration...", { module: 'Database' });
    
    const statements = SCHEMA_SQL
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

    logger.info("Initial migration completed successfully", { module: 'Database' });
  } catch (error) {
    logger.error(
      `Auto migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined,
      { module: 'Database' }
    );
    // 不抛出错误，允许应用继续运行
  }
}
