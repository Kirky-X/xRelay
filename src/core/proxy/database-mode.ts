/**
 * 代理管理器 - 数据库模式
 */

import type { ProxyInfo } from "../../types/index.js";
import type { PoolStatus } from "./types.js";
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
} from "../../database/available-proxies-dao.js";
import {
  insertDeprecatedProxy,
  getAllDeprecatedProxies,
} from "../../database/deprecated-proxies-dao.js";
import { fetchAllProxies } from "../../proxy-fetcher.js";
import { PROXY_CONFIG, DATABASE_CONFIG } from "../../config.js";
import { logger } from "../../logger.js";
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker.js";

/**
 * 从数据库加载代理
 */
export async function loadProxiesFromDatabase(): Promise<void> {
  try {
    const count = await getProxyCount();
    logger.info(`数据库中有 ${count} 个代理`, { module: 'ProxyManager' });

    if (count === 0) {
      logger.info("数据库为空，从代理池加载...", { module: 'ProxyManager' });
      await loadProxiesFromPool();
    } else {
      logger.info("从数据库加载代理成功", { module: 'ProxyManager' });
    }
  } catch (error) {
    logger.error("从数据库加载代理失败", error instanceof Error ? error : undefined, { module: 'ProxyManager' });
    throw error;
  }
}

/**
 * 从代理池加载代理到数据库
 */
export async function loadProxiesFromPool(): Promise<void> {
  try {
    logger.info("从代理源获取代理...", { module: 'ProxyManager' });
    const allProxies = await fetchAllProxies();
    logger.info(`获取到 ${allProxies.length} 个代理`, { module: 'ProxyManager' });

    if (allProxies.length === 0) {
      logger.warn("没有获取到代理", { module: 'ProxyManager' });
      return;
    }

    const deprecatedProxies = await getAllDeprecatedProxies();
    const deprecatedSet = new Set(
      deprecatedProxies.map((p) => `${p.ip}:${p.port}`),
    );

    const filteredProxies = allProxies.filter(
      (p) => !deprecatedSet.has(`${p.ip}:${p.port}`),
    );
    logger.info(
      `过滤后剩余 ${filteredProxies.length} 个代理`,
      { module: 'ProxyManager' }
    );

    const proxiesToInsert = filteredProxies.map((p) => ({
      ip: p.ip,
      port: parseInt(p.port, 10),
      source: p.source,
      failure_count: 0,
      success_count: 0,
    }));

    await batchInsertProxies(proxiesToInsert);
    logger.info(`成功插入 ${proxiesToInsert.length} 个代理`, { module: 'ProxyManager' });
  } catch (error) {
    logger.error("从代理池加载失败", error instanceof Error ? error : undefined, { module: 'ProxyManager' });
    throw error;
  }
}

/**
 * 从数据库获取可用代理
 */
export async function getAvailableProxyFromDatabase(): Promise<ProxyInfo | null> {
  const count = await getProxyCount();
  if (count < DATABASE_CONFIG.minProxyCount) {
    logger.info(
      `代理数量不足 (${count} < ${DATABASE_CONFIG.minProxyCount})，补充代理...`,
      { module: 'ProxyManager' }
    );
    await loadProxiesFromPool();
  }

  const proxies = await getWeightedProxies(10);
  if (proxies.length === 0) {
    logger.warn("没有可用代理", { module: 'ProxyManager' });
    return null;
  }

  for (const proxy of proxies) {
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    if (!isCircuitOpen(proxyKey)) {
      logger.debug(`获取代理: ${proxy.ip}:***`, { module: 'ProxyManager' });
      return {
        ip: proxy.ip,
        port: proxy.port.toString(),
        source: proxy.source,
        timestamp: Date.now(),
      };
    }
  }

  logger.warn("所有代理的断路器都已打开", { module: 'ProxyManager' });
  return null;
}

/**
 * 从数据库获取多个代理
 */
export async function getMultipleProxiesFromDatabase(
  count: number,
): Promise<ProxyInfo[]> {
  const dbCount = await getProxyCount();
  if (dbCount < DATABASE_CONFIG.minProxyCount) {
    logger.info(
      `代理数量不足 (${dbCount} < ${DATABASE_CONFIG.minProxyCount})，补充代理...`,
      { module: 'ProxyManager' }
    );
    await loadProxiesFromPool();
  }

  const proxies = await getWeightedProxies(count * 3);

  const availableProxies = proxies.filter((p) => {
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
 * 向数据库报告代理失效
 */
export async function reportProxyFailedToDatabase(proxy: ProxyInfo): Promise<void> {
  try {
    const updated = await incrementFailureCount(proxy.ip, parseInt(proxy.port, 10));

    if (!updated) {
      logger.debug(`代理不存在: ${proxy.ip}:***`, { module: 'ProxyManager' });
      return;
    }

    logger.debug(
      `代理失败次数: ${updated.failure_count} (${proxy.ip}:***)`,
      { module: 'ProxyManager' }
    );

    if (updated.failure_count >= DATABASE_CONFIG.failureThreshold) {
      logger.info(
        `代理失败次数超过阈值，移入废弃表: ${proxy.ip}:***`,
        { module: 'ProxyManager' }
      );

      await insertDeprecatedProxy({
        ip: updated.ip,
        port: updated.port,
        source: updated.source,
        protocol: "http",
        failure_count: updated.failure_count,
        created_at: updated.created_at,
      });

      await deleteProxy(updated.ip, updated.port);
    }
  } catch (error) {
    logger.error(
      `报告代理失败失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined,
      { module: 'ProxyManager' }
    );
  }
}

/**
 * 向数据库报告代理成功
 */
export async function reportProxySuccessToDatabase(proxy: ProxyInfo): Promise<void> {
  try {
    await incrementSuccessCount(proxy.ip, parseInt(proxy.port, 10));
    logger.debug(`代理成功: ${proxy.ip}:***`, { module: 'ProxyManager' });
  } catch (error) {
    logger.error("报告代理成功失败", error instanceof Error ? error : undefined, { module: 'ProxyManager' });
  }
}

/**
 * 获取数据库模式的状态
 */
export async function getDatabaseStatus(): Promise<PoolStatus> {
  const availableCount = await getProxyCount();

  return {
    availableCount,
    lastRefreshTime: 0,
    refreshCount: 0,
    blacklistSize: 0,
    mode: "database",
  };
}
