/**
 * 代理管理器 - 内存模式
 */

import type { ProxyInfo } from "../../types/index.js";
import type { ProxyPoolState, PoolStatus } from "./types.js";
import { fetchAllProxies } from "../../proxy-fetcher.js";
import { quickTestProxies, cleanupBlacklist } from "../../proxy-tester.js";
import { PROXY_CONFIG } from "../../config.js";
import { logger } from "../../logger.js";
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker.js";

// 全局代理池状态
const proxyPool: ProxyPoolState = {
  availableProxies: [],
  lastRefreshTime: 0,
  refreshCount: 0,
};

/**
 * 刷新代理池（内存模式）
 */
export async function refreshProxyPool(): Promise<void> {
  logger.info(`刷新代理池...`, { module: 'ProxyManager' });

  try {
    const allProxies = await fetchAllProxies();
    logger.info(`获取到 ${allProxies.length} 个代理`, { module: 'ProxyManager' });

    if (allProxies.length === 0) {
      logger.warn(`没有获取到代理`, { module: 'ProxyManager' });
      return;
    }

    const availableProxies = await quickTestProxies(
      allProxies.slice(0, 20),
      PROXY_CONFIG.pool.testTimeout,
    );

    proxyPool.availableProxies = availableProxies.slice(
      0,
      PROXY_CONFIG.pool.maxProxyCount,
    );
    proxyPool.lastRefreshTime = Date.now();
    proxyPool.refreshCount++;

    logger.info(
      `代理池刷新完成，可用代理: ${proxyPool.availableProxies.length}`,
      { module: 'ProxyManager' }
    );
  } catch (error) {
    logger.error(`刷新代理池失败`, error instanceof Error ? error : undefined, { module: 'ProxyManager' });
  }
}

/**
 * 检查是否需要刷新代理池（内存模式）
 */
export function shouldRefreshPool(): boolean {
  const now = Date.now();

  if (proxyPool.lastRefreshTime === 0) {
    return true;
  }

  if (proxyPool.availableProxies.length < PROXY_CONFIG.pool.minProxyCount) {
    return true;
  }

  if (now - proxyPool.lastRefreshTime > PROXY_CONFIG.pool.refreshInterval) {
    return true;
  }

  return false;
}

/**
 * 从内存获取可用代理
 */
export async function getAvailableProxyFromMemory(): Promise<ProxyInfo | null> {
  const needsRefresh = shouldRefreshPool();

  if (needsRefresh) {
    await refreshProxyPool();
  }

  cleanupBlacklist();

  if (proxyPool.availableProxies.length > 0) {
    const availableProxies = proxyPool.availableProxies.filter(proxy => {
      const proxyKey = `${proxy.ip}:${proxy.port}`;
      return !isCircuitOpen(proxyKey);
    });

    if (availableProxies.length > 0) {
      const proxy =
        availableProxies[
        Math.floor(Math.random() * availableProxies.length)
        ];
      logger.debug(`获取代理: ${proxy.ip}:***`, { module: 'ProxyManager' });
      return proxy;
    }

    logger.warn("所有代理的断路器都已打开", { module: 'ProxyManager' });
    return null;
  }

  logger.warn(`没有可用代理`, { module: 'ProxyManager' });
  return null;
}

/**
 * 从内存获取多个代理
 */
export async function getMultipleProxiesFromMemory(count: number): Promise<ProxyInfo[]> {
  if (proxyPool.availableProxies.length < count) {
    await refreshProxyPool();
  }

  const availableProxies = proxyPool.availableProxies.filter(proxy => {
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    return !isCircuitOpen(proxyKey);
  });

  const shuffled = [...availableProxies];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * 向内存报告代理失效
 */
export function reportProxyFailedToMemory(proxy: ProxyInfo): void {
  const proxyKey = `${proxy.ip}:${proxy.port}`;
  recordFailure(proxyKey);

  proxyPool.availableProxies = proxyPool.availableProxies.filter(
    (p) => `${p.ip}:${p.port}` !== `${proxy.ip}:${proxy.port}`,
  );
  logger.debug(`代理失效，已从池中移除: ${proxy.ip}:***`, { module: 'ProxyManager' });
  logger.debug(
    `池中剩余代理: ${proxyPool.availableProxies.length}`,
    { module: 'ProxyManager' }
  );
}

/**
 * 向内存报告代理成功
 */
export function reportProxySuccessToMemory(_proxy: ProxyInfo): void {
  const proxyKey = `${_proxy.ip}:${_proxy.port}`;
  recordSuccess(proxyKey);
}

/**
 * 获取内存模式的状态
 */
export function getMemoryStatus(): PoolStatus {
  return {
    availableCount: proxyPool.availableProxies.length,
    lastRefreshTime: proxyPool.lastRefreshTime,
    refreshCount: proxyPool.refreshCount,
    blacklistSize: 0,
    mode: "memory",
  };
}

/**
 * 获取代理池状态
 */
export function getProxyPoolState(): ProxyPoolState {
  return proxyPool;
}
