/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Cleanup - 数据库清理模块
 * 由 Vercel Cron Jobs 定期调用，清理过期的废弃代理
 * 
 * 注意：在 Vercel 无服务器环境中，setInterval 不会持久运行。
 * 清理任务通过 /api/cron/cleanup 端点由 Vercel Cron Jobs 触发。
 */

import { isDatabaseReady } from "./connection.js";
import {
  deleteExpiredDeprecatedProxies,
  getDeprecatedProxyStats,
} from "./deprecated-proxies-dao.js";
import { DATABASE_CONFIG } from "../config.js";

/**
 * 执行清理任务
 */
export async function runCleanup(): Promise<{
  deletedCount: number;
  stats: {
    total: number;
    expired: number;
    recent: number;
  };
}> {
  if (!isDatabaseReady()) {
    console.log("[Cleanup] Database not ready, skipping cleanup");
    return {
      deletedCount: 0,
      stats: { total: 0, expired: 0, recent: 0 },
    };
  }

  console.log("[Cleanup] Starting cleanup task...");

  try {
    // 获取清理前的统计信息
    const statsBefore = await getDeprecatedProxyStats();

    // 删除过期的废弃代理
    const deletedCount = await deleteExpiredDeprecatedProxies(
      DATABASE_CONFIG.deprecatedRetentionDays,
    );

    // 获取清理后的统计信息
    const statsAfter = await getDeprecatedProxyStats();

    console.log(
      `[Cleanup] Cleanup completed. Deleted ${deletedCount} expired proxies.`,
    );
    console.log(
      `[Cleanup] Stats: Total=${statsAfter.total}, Expired=${statsAfter.expired}, Recent=${statsAfter.recent}`,
    );

    return {
      deletedCount,
      stats: statsAfter,
    };
  } catch (error) {
    console.error("[Cleanup] Cleanup task failed:", error);
    return {
      deletedCount: 0,
      stats: { total: 0, expired: 0, recent: 0 },
    };
  }
}

/**
 * 获取清理任务配置
 * 注意：实际的定时清理由 Vercel Cron Jobs 触发
 */
export function getCleanupConfig(): {
  interval: number;
  retentionDays: number;
  cronEndpoint: string;
} {
  return {
    interval: DATABASE_CONFIG.cleanupInterval,
    retentionDays: DATABASE_CONFIG.deprecatedRetentionDays,
    cronEndpoint: "/api/cron/cleanup",
  };
}