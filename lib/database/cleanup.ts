/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Cleanup - 数据库清理模块
 * 定期清理过期的废弃代理
 */

import { isDatabaseReady } from "./connection.js";
import {
  deleteExpiredDeprecatedProxies,
  getDeprecatedProxyStats,
} from "./deprecated-proxies-dao.js";
import { DATABASE_CONFIG } from "../config.js";

// 清理任务 ID
let cleanupTaskId: NodeJS.Timeout | null = null;

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
 * 启动自动清理任务
 */
export function startCleanupTask(): void {
  if (!isDatabaseReady()) {
    console.log("[Cleanup] Database not ready, cleanup task not started");
    return;
  }

  if (cleanupTaskId) {
    console.log("[Cleanup] Cleanup task already running");
    return;
  }

  console.log(
    `[Cleanup] Starting cleanup task (interval: ${DATABASE_CONFIG.cleanupInterval}ms)`,
  );

  // 立即执行一次清理
  runCleanup().catch((error) => {
    console.error("[Cleanup] Initial cleanup failed:", error);
  });

  // 定期执行清理
  cleanupTaskId = setInterval(() => {
    runCleanup().catch((error) => {
      console.error("[Cleanup] Scheduled cleanup failed:", error);
    });
  }, DATABASE_CONFIG.cleanupInterval);
}

/**
 * 停止自动清理任务
 */
export function stopCleanupTask(): void {
  if (cleanupTaskId) {
    clearInterval(cleanupTaskId);
    cleanupTaskId = null;
    console.log("[Cleanup] Cleanup task stopped");
  }
}

/**
 * 获取清理任务状态
 */
export function getCleanupTaskStatus(): {
  running: boolean;
  interval: number;
  retentionDays: number;
} {
  return {
    running: cleanupTaskId !== null,
    interval: DATABASE_CONFIG.cleanupInterval,
    retentionDays: DATABASE_CONFIG.deprecatedRetentionDays,
  };
}