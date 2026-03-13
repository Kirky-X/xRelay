/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Migration Script - 数据库迁移脚本
 * 用于初始化和更新数据库结构
 */

import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 执行数据库迁移
 */
export async function runMigration(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("[Migration] Starting database migration...");

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    // 读取 schema.sql 文件
    const schemaPath = join(__dirname, "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");

    // 执行 SQL
    await pool.query(schemaSql);

    console.log("[Migration] Database migration completed successfully");
  } catch (error) {
    console.error("[Migration] Database migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 如果直接运行此脚本，执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(() => {
      console.log("[Migration] Done");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[Migration] Error:", error);
      process.exit(1);
    });
}