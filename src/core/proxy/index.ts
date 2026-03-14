/**
 * Proxy Manager - 代理池管理
 * 管理代理的生命周期、轮换、失效检测
 * 支持数据库模式和内存模式
 */

import type { ProxyInfo } from "../../types/index.js";
import type { PoolStatus, ProxyStats } from "./types.js";
import { logger } from "../../logger.js";
import { initDatabase, isDatabaseReady } from "../../database/connection.js";

import * as CircuitBreaker from "./circuit-breaker.js";
import * as DatabaseMode from "./database-mode.js";
import * as MemoryMode from "./memory-mode.js";

// 初始化状态
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// 数据库模式标志
let isDatabaseMode = false;

/**
 * 初始化代理管理器
 */
export async function initProxyManager(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      logger.info("初始化代理管理器...", { module: 'ProxyManager' });

      const dbInitialized = await initDatabase();
      isDatabaseMode = dbInitialized;

      if (isDatabaseMode) {
        logger.info("使用数据库模式", { module: 'ProxyManager' });
        await DatabaseMode.loadProxiesFromDatabase();
      } else {
        logger.info("使用内存模式", { module: 'ProxyManager' });
        await MemoryMode.refreshProxyPool();
      }

      if (typeof setInterval !== 'undefined') {
        setInterval(CircuitBreaker.cleanupCircuitBreakers, 60 * 60 * 1000);
        logger.debug("断路器清理定时器已启动", { module: 'ProxyManager' });
      }

      isInitialized = true;
    } catch (error) {
      logger.error("初始化失败，使用内存模式", error instanceof Error ? error : undefined, { module: 'ProxyManager' });
      isDatabaseMode = false;
      await MemoryMode.refreshProxyPool();
      isInitialized = true;
    }
  })();

  return initPromise;
}

/**
 * 获取可用的代理（自动刷新池）
 */
export async function getAvailableProxy(): Promise<ProxyInfo | null> {
  await initProxyManager();

  if (isDatabaseMode) {
    return DatabaseMode.getAvailableProxyFromDatabase();
  } else {
    return MemoryMode.getAvailableProxyFromMemory();
  }
}

/**
 * 获取多个代理用于并行请求
 */
export async function getMultipleProxies(count: number): Promise<ProxyInfo[]> {
  await initProxyManager();

  if (isDatabaseMode) {
    return DatabaseMode.getMultipleProxiesFromDatabase(count);
  } else {
    return MemoryMode.getMultipleProxiesFromMemory(count);
  }
}

/**
 * 报告代理失效
 */
export async function reportProxyFailed(proxy: ProxyInfo): Promise<void> {
  const proxyKey = `${proxy.ip}:${proxy.port}`;
  CircuitBreaker.recordFailure(proxyKey);

  if (isDatabaseMode) {
    await DatabaseMode.reportProxyFailedToDatabase(proxy);
  } else {
    MemoryMode.reportProxyFailedToMemory(proxy);
  }
}

/**
 * 报告代理成功
 */
export async function reportProxySuccess(proxy: ProxyInfo): Promise<void> {
  const proxyKey = `${proxy.ip}:${proxy.port}`;
  CircuitBreaker.recordSuccess(proxyKey);

  if (isDatabaseMode) {
    await DatabaseMode.reportProxySuccessToDatabase(proxy);
  } else {
    MemoryMode.reportProxySuccessToMemory(proxy);
  }
}

/**
 * 获取代理池状态
 */
export async function getPoolStatus(): Promise<PoolStatus> {
  if (isDatabaseMode) {
    return DatabaseMode.getDatabaseStatus();
  } else {
    return MemoryMode.getMemoryStatus();
  }
}

/**
 * 手动触发刷新
 */
export async function manualRefresh(): Promise<void> {
  if (isDatabaseMode) {
    await DatabaseMode.loadProxiesFromPool();
  } else {
    await MemoryMode.refreshProxyPool();
  }
}

/**
 * 获取代理统计信息
 */
export async function getProxyStats(): Promise<ProxyStats> {
  const availableInPool = isDatabaseMode
    ? await DatabaseMode.getDatabaseStatus().then(s => s.availableCount)
    : MemoryMode.getProxyPoolState().availableProxies.length;

  const isFresh = isDatabaseMode
    ? false
    : Date.now() - MemoryMode.getProxyPoolState().lastRefreshTime < 60000;

  return {
    totalFetched: isDatabaseMode ? 0 : MemoryMode.getProxyPoolState().refreshCount,
    availableInPool,
    isFresh,
    mode: isDatabaseMode ? "database" : "memory",
  };
}

/**
 * 获取断路器状态（用于调试和监控）
 */
export function getCircuitBreakerStatus() {
  return CircuitBreaker.getCircuitBreakerStatus();
}

/**
 * 检查是否使用数据库模式
 */
export function isUsingDatabase(): boolean {
  return isDatabaseMode;
}
