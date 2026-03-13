/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Manager - 代理池管理
 * 管理代理的生命周期、轮换、失效检测
 * 支持数据库模式和内存模式
 */

import { fetchAllProxies, type ProxyInfo } from "./proxy-fetcher.js";
import {
  quickTestProxies,
  cleanupBlacklist,
  getBlacklistStatus,
} from "./proxy-tester.js";
import { PROXY_CONFIG, DATABASE_CONFIG } from "./config.js";
import {
  initDatabase,
  isDatabaseReady,
  getPool,
} from "./database/connection.js";
import {
  upsertProxy,
  getAllProxies,
  getProxyCount,
  incrementFailureCount,
  incrementSuccessCount,
  deleteProxy,
  batchInsertProxies,
  getWeightedProxies,
  type AvailableProxy,
} from "./database/available-proxies-dao.js";
import {
  insertDeprecatedProxy,
  isProxyDeprecated,
  getAllDeprecatedProxies,
} from "./database/deprecated-proxies-dao.js";
import { logger } from "./logger.js";

// 断路器状态接口
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

// 断路器配置
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5, // 失败次数阈值
  resetTimeout: 60000, // 断路器重置超时时间（1分钟）
};

// 断路器状态存储
const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * 检查断路器是否打开
 * @param proxyKey 代理标识 (ip:port)
 * @returns true 表示断路器打开（代理不可用），false 表示断路器关闭（代理可用）
 */
function isCircuitOpen(proxyKey: string): boolean {
  const state = circuitBreakers.get(proxyKey);
  if (!state) return false;
  
  if (state.isOpen) {
    // 检查是否超过重置超时时间（半开状态）
    if (Date.now() - state.lastFailureTime > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      // 半开状态，允许一次尝试
      state.isOpen = false;
      logger.proxyManager.info(`断路器进入半开状态: ${proxyKey}`);
      return false;
    }
    return true;
  }
  return false;
}

/**
 * 记录代理失败（断路器）
 * @param proxyKey 代理标识 (ip:port)
 */
function recordFailure(proxyKey: string): void {
  const state = circuitBreakers.get(proxyKey) || { 
    failures: 0, 
    lastFailureTime: 0, 
    isOpen: false 
  };
  
  state.failures++;
  state.lastFailureTime = Date.now();
  
  if (state.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold && !state.isOpen) {
    state.isOpen = true;
    logger.proxyManager.warn(`断路器打开: ${proxyKey} (失败次数: ${state.failures})`);
  }
  
  circuitBreakers.set(proxyKey, state);
}

/**
 * 记录代理成功（重置断路器）
 * @param proxyKey 代理标识 (ip:port)
 */
function recordSuccess(proxyKey: string): void {
  const state = circuitBreakers.get(proxyKey);
  if (state) {
    // 成功后重置断路器状态
    state.failures = 0;
    state.isOpen = false;
    circuitBreakers.set(proxyKey, state);
    logger.proxyManager.verbose(`断路器重置: ${proxyKey}`);
  }
}

/**
 * 获取断路器状态（用于调试和监控）
 */
export function getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
  return new Map(circuitBreakers);
}

// 代理池状态（内存模式）
interface ProxyPoolState {
  availableProxies: ProxyInfo[];
  lastRefreshTime: number;
  refreshCount: number;
}

// 全局代理池状态
const proxyPool: ProxyPoolState = {
  availableProxies: [],
  lastRefreshTime: 0,
  refreshCount: 0,
};

// 初始化状态
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// 数据库模式标志
let isDatabaseMode = false;

/**
 * 初始化代理管理器
 */
export async function initProxyManager(): Promise<void> {
  // 防止重复初始化
  if (isInitialized) {
    return;
  }

  // 如果已经在初始化中，等待完成
  if (initPromise) {
    return initPromise;
  }

  // 开始初始化
  initPromise = (async () => {
    try {
      logger.proxyManager.info("初始化代理管理器...");

      // 尝试初始化数据库
      const dbInitialized = await initDatabase();
      isDatabaseMode = dbInitialized;

      if (isDatabaseMode) {
        logger.proxyManager.info("使用数据库模式");
        await loadProxiesFromDatabase();
      } else {
        logger.proxyManager.info("使用内存模式");
        await refreshProxyPool();
      }

      isInitialized = true;
    } catch (error) {
      logger.proxyManager.error("初始化失败，使用内存模式", { error: error instanceof Error ? error.message : String(error) });
      isDatabaseMode = false;
      await refreshProxyPool();
      isInitialized = true;
    }
  })();

  return initPromise;
}

/**
 * 从数据库加载代理
 */
async function loadProxiesFromDatabase(): Promise<void> {
  try {
    const count = await getProxyCount();
    logger.proxyManager.info(`数据库中有 ${count} 个代理`);

    if (count === 0) {
      logger.proxyManager.info("数据库为空，从代理池加载...");
      await loadProxiesFromPool();
    } else {
      logger.proxyManager.info("从数据库加载代理成功");
    }
  } catch (error) {
    logger.proxyManager.error("从数据库加载代理失败", { error: error instanceof Error ? error.message : String(error) });
    // 降级到内存模式
    isDatabaseMode = false;
    await refreshProxyPool();
  }
}

/**
 * 从代理池加载代理到数据库
 */
async function loadProxiesFromPool(): Promise<void> {
  try {
    logger.proxyManager.info("从代理源获取代理...");
    const allProxies = await fetchAllProxies();
    logger.proxyManager.info(`获取到 ${allProxies.length} 个代理`);

    if (allProxies.length === 0) {
      logger.proxyManager.warn("没有获取到代理");
      return;
    }

    // 获取废弃代理列表，用于过滤
    const deprecatedProxies = await getAllDeprecatedProxies();
    const deprecatedSet = new Set(
      deprecatedProxies.map((p) => `${p.ip}:${p.port}`),
    );

    // 过滤废弃代理
    const filteredProxies = allProxies.filter(
      (p) => !deprecatedSet.has(`${p.ip}:${p.port}`),
    );
    logger.proxyManager.info(
      `过滤后剩余 ${filteredProxies.length} 个代理`,
    );

    // 批量插入数据库
    const proxiesToInsert = filteredProxies.map((p) => ({
      ip: p.ip,
      port: parseInt(p.port, 10),
      source: p.source,
      failure_count: 0,
      success_count: 0,
    }));

    await batchInsertProxies(proxiesToInsert);
    logger.proxyManager.info(`成功插入 ${proxiesToInsert.length} 个代理`);
  } catch (error) {
    logger.proxyManager.error("从代理池加载失败", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 获取可用的代理（自动刷新池）
 */
export async function getAvailableProxy(): Promise<ProxyInfo | null> {
  // 确保代理管理器已初始化
  await initProxyManager();

  if (isDatabaseMode) {
    return getAvailableProxyFromDatabase();
  } else {
    return getAvailableProxyFromMemory();
  }
}

/**
 * 从数据库获取可用代理
 */
async function getAvailableProxyFromDatabase(): Promise<ProxyInfo | null> {
  // 检查是否需要补充代理
  const count = await getProxyCount();
  if (count < DATABASE_CONFIG.minProxyCount) {
    logger.proxyManager.info(
      `代理数量不足 (${count} < ${DATABASE_CONFIG.minProxyCount})，补充代理...`,
    );
    await loadProxiesFromPool();
  }

  // 获取带权重的代理（获取更多候选，以便过滤断路器打开的代理）
  const proxies = await getWeightedProxies(10);
  if (proxies.length === 0) {
    logger.proxyManager.warn("没有可用代理");
    return null;
  }

  // 找到第一个断路器未打开的代理
  for (const proxy of proxies) {
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    if (!isCircuitOpen(proxyKey)) {
      logger.proxyManager.verbose(`获取代理: ${proxy.ip}:***`);
      return {
        ip: proxy.ip,
        port: proxy.port.toString(),
        source: proxy.source,
        timestamp: Date.now(),
      };
    }
  }

  logger.proxyManager.warn("所有代理的断路器都已打开");
  return null;
}

/**
 * 从内存获取可用代理
 */
async function getAvailableProxyFromMemory(): Promise<ProxyInfo | null> {
  // 检查是否需要刷新
  const needsRefresh = shouldRefreshPool();

  if (needsRefresh) {
    await refreshProxyPool();
  }

  // 清理黑名单
  cleanupBlacklist();

  // 返回随机可用代理（跳过断路器打开的代理）
  if (proxyPool.availableProxies.length > 0) {
    // 过滤断路器打开的代理
    const availableProxies = proxyPool.availableProxies.filter(proxy => {
      const proxyKey = `${proxy.ip}:${proxy.port}`;
      return !isCircuitOpen(proxyKey);
    });

    if (availableProxies.length > 0) {
      const proxy =
        availableProxies[
          Math.floor(Math.random() * availableProxies.length)
        ];
      logger.proxyManager.verbose(`获取代理: ${proxy.ip}:***`);
      return proxy;
    }

    logger.proxyManager.warn("所有代理的断路器都已打开");
    return null;
  }

  logger.proxyManager.warn(`没有可用代理`);
  return null;
}

/**
 * 获取多个代理用于并行请求
 */
export async function getMultipleProxies(count: number): Promise<ProxyInfo[]> {
  // 确保代理管理器已初始化
  await initProxyManager();

  if (isDatabaseMode) {
    return getMultipleProxiesFromDatabase(count);
  } else {
    return getMultipleProxiesFromMemory(count);
  }
}

/**
 * 从数据库获取多个代理
 */
async function getMultipleProxiesFromDatabase(
  count: number,
): Promise<ProxyInfo[]> {
  // 检查是否需要补充代理
  const dbCount = await getProxyCount();
  if (dbCount < DATABASE_CONFIG.minProxyCount) {
    logger.proxyManager.info(
      `代理数量不足 (${dbCount} < ${DATABASE_CONFIG.minProxyCount})，补充代理...`,
    );
    await loadProxiesFromPool();
  }

  // 获取带权重的代理（获取更多候选，以便过滤断路器打开的代理）
  const proxies = await getWeightedProxies(count * 3);
  
  // 过滤断路器打开的代理
  const availableProxies = proxies.filter(p => {
    const proxyKey = `${p.ip}:${p.port}`;
    return !isCircuitOpen(proxyKey);
  });

  return availableProxies.slice(0, count).map((p) => ({
    ip: p.ip,
    port: p.port.toString(),
    source: p.source,
    timestamp: Date.now(),
  }));
}

/**
 * 从内存获取多个代理
 */
async function getMultipleProxiesFromMemory(count: number): Promise<ProxyInfo[]> {
  if (proxyPool.availableProxies.length < count) {
    await refreshProxyPool();
  }

  // 过滤断路器打开的代理
  const availableProxies = proxyPool.availableProxies.filter(proxy => {
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    return !isCircuitOpen(proxyKey);
  });

  // 随机选择指定数量的代理
  const shuffled = [...availableProxies];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * 报告代理失效
 */
export async function reportProxyFailed(proxy: ProxyInfo): Promise<void> {
  // 更新断路器状态
  const proxyKey = `${proxy.ip}:${proxy.port}`;
  recordFailure(proxyKey);

  if (isDatabaseMode) {
    await reportProxyFailedToDatabase(proxy);
  } else {
    reportProxyFailedToMemory(proxy);
  }
}

/**
 * 向数据库报告代理失效
 */
async function reportProxyFailedToDatabase(proxy: ProxyInfo): Promise<void> {
  try {
    // 增加失败次数
    const updated = await incrementFailureCount(proxy.ip, parseInt(proxy.port, 10));

    if (!updated) {
      console.log(`[ProxyManager] 代理不存在: ${proxy.ip}:***`);
      return;
    }

    console.log(
      `[ProxyManager] 代理失败次数: ${updated.failure_count} (${proxy.ip}:***)`,
    );

    // 检查是否超过阈值
    if (updated.failure_count >= DATABASE_CONFIG.failureThreshold) {
      console.log(
        `[ProxyManager] 代理失败次数超过阈值，移入废弃表: ${proxy.ip}:***`,
      );

      // 移入废弃表
      await insertDeprecatedProxy({
        ip: updated.ip,
        port: updated.port,
        source: updated.source,
        protocol: "http",
        failure_count: updated.failure_count,
        created_at: updated.created_at,
      });

      // 从可用表删除
      await deleteProxy(updated.ip, updated.port);
    }
  } catch (error) {
    console.error("[ProxyManager] 报告代理失败失败:", error);
  }
}

/**
 * 向内存报告代理失效
 */
function reportProxyFailedToMemory(proxy: ProxyInfo): void {
  proxyPool.availableProxies = proxyPool.availableProxies.filter(
    (p) => `${p.ip}:${p.port}` !== `${proxy.ip}:${proxy.port}`,
  );
  logger.proxyManager.verbose(`代理失效，已从池中移除: ${proxy.ip}:***`);
  logger.proxyManager.verbose(
    `池中剩余代理: ${proxyPool.availableProxies.length}`,
  );
}

/**
 * 报告代理成功
 */
export async function reportProxySuccess(proxy: ProxyInfo): Promise<void> {
  // 重置断路器状态
  const proxyKey = `${proxy.ip}:${proxy.port}`;
  recordSuccess(proxyKey);

  if (isDatabaseMode) {
    await reportProxySuccessToDatabase(proxy);
  } else {
    reportProxySuccessToMemory(proxy);
  }
}

/**
 * 向数据库报告代理成功
 */
async function reportProxySuccessToDatabase(proxy: ProxyInfo): Promise<void> {
  try {
    await incrementSuccessCount(proxy.ip, parseInt(proxy.port, 10));
    logger.proxyManager.verbose(`代理成功: ${proxy.ip}:***`);
  } catch (error) {
    logger.proxyManager.error("报告代理成功失败", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 向内存报告代理成功
 */
function reportProxySuccessToMemory(_proxy: ProxyInfo): void {
  // 成功，保持在池中
  // 可以记录成功次数用于负载均衡
}

/**
 * 刷新代理池（内存模式）
 */
async function refreshProxyPool(): Promise<void> {
  logger.proxyManager.info(`刷新代理池...`);

  try {
    // 1. 获取最新代理列表
    const allProxies = await fetchAllProxies();
    logger.proxyManager.info(`获取到 ${allProxies.length} 个代理`);

    if (allProxies.length === 0) {
      logger.proxyManager.warn(`没有获取到代理`);
      return;
    }

    // 2. 快速测试可用性，筛选出可用的
    const availableProxies = await quickTestProxies(
      allProxies.slice(0, 20), // 只测试前20个，避免超时
      PROXY_CONFIG.pool.testTimeout,
    );

    // 3. 更新池状态
    proxyPool.availableProxies = availableProxies.slice(
      0,
      PROXY_CONFIG.pool.maxProxyCount,
    );
    proxyPool.lastRefreshTime = Date.now();
    proxyPool.refreshCount++;

    logger.proxyManager.info(
      `代理池刷新完成，可用代理: ${proxyPool.availableProxies.length}`,
    );
  } catch (error) {
    logger.proxyManager.error(`刷新代理池失败`, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 检查是否需要刷新代理池（内存模式）
 */
function shouldRefreshPool(): boolean {
  const now = Date.now();

  // 首次加载
  if (proxyPool.lastRefreshTime === 0) {
    return true;
  }

  // 代理数量不足
  if (proxyPool.availableProxies.length < PROXY_CONFIG.pool.minProxyCount) {
    return true;
  }

  // 超过刷新间隔
  if (now - proxyPool.lastRefreshTime > PROXY_CONFIG.pool.refreshInterval) {
    return true;
  }

  return false;
}

/**
 * 获取代理池状态
 */
export async function getPoolStatus(): Promise<{
  availableCount: number;
  lastRefreshTime: number;
  refreshCount: number;
  blacklistSize: number;
  mode: "database" | "memory";
}> {
  const availableCount = isDatabaseMode
    ? await getProxyCount()
    : proxyPool.availableProxies.length;

  return {
    availableCount,
    lastRefreshTime: proxyPool.lastRefreshTime,
    refreshCount: proxyPool.refreshCount,
    blacklistSize: getBlacklistStatus().size,
    mode: isDatabaseMode ? "database" : "memory",
  };
}

/**
 * 手动触发刷新
 */
export async function manualRefresh(): Promise<void> {
  if (isDatabaseMode) {
    await loadProxiesFromPool();
  } else {
    proxyPool.lastRefreshTime = 0; // 强制刷新
    await refreshProxyPool();
  }
}

/**
 * 获取代理统计信息
 */
export async function getProxyStats(): Promise<{
  totalFetched: number;
  availableInPool: number;
  isFresh: boolean;
  mode: "database" | "memory";
}> {
  const availableInPool = isDatabaseMode
    ? await getProxyCount()
    : proxyPool.availableProxies.length;

  const isFresh =
    Date.now() - proxyPool.lastRefreshTime < PROXY_CONFIG.pool.refreshInterval;

  return {
    totalFetched: proxyPool.refreshCount,
    availableInPool,
    isFresh,
    mode: isDatabaseMode ? "database" : "memory",
  };
}

/**
 * 检查是否使用数据库模式
 */
export function isUsingDatabase(): boolean {
  return isDatabaseMode;
}
