/**
 * Proxy Manager - 代理池管理
 * 管理代理的生命周期、轮换、失效检测
 */

import { fetchAllProxies, type ProxyInfo } from './proxy-fetcher';
import {
  quickTestProxies,
  cleanupBlacklist,
  getBlacklistStatus
} from './proxy-tester';

// 代理池状态
interface ProxyPoolState {
  availableProxies: ProxyInfo[];
  lastRefreshTime: number;
  refreshCount: number;
}

// 全局代理池状态
const proxyPool: ProxyPoolState = {
  availableProxies: [],
  lastRefreshTime: 0,
  refreshCount: 0
};

// 配置
const POOL_REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟刷新
const MIN_PROXY_COUNT = 3; // 最小可用代理数量
const MAX_PROXY_COUNT = 10; // 最大保留代理数量

/**
 * 获取可用的代理（自动刷新池）
 */
export async function getAvailableProxy(): Promise<ProxyInfo | null> {
  // 检查是否需要刷新
  const needsRefresh = shouldRefreshPool();

  if (needsRefresh) {
    await refreshProxyPool();
  }

  // 清理黑名单
  cleanupBlacklist();

  // 返回随机可用代理
  if (proxyPool.availableProxies.length > 0) {
    const proxy = proxyPool.availableProxies[Math.floor(Math.random() * proxyPool.availableProxies.length)];
    console.log(`[ProxyManager] 获取代理: ${proxy.ip}:${proxy.port}`);
    return proxy;
  }

  console.log(`[ProxyManager] 没有可用代理`);
  return null;
}

/**
 * 获取多个代理用于并行请求
 */
export async function getMultipleProxies(count: number): Promise<ProxyInfo[]> {
  if (proxyPool.availableProxies.length < count) {
    await refreshProxyPool();
  }

  // 随机选择指定数量的代理
  const shuffled = [...proxyPool.availableProxies];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * 报告代理失效
 */
export function reportProxyFailed(proxy: ProxyInfo): void {
  proxyPool.availableProxies = proxyPool.availableProxies.filter(
    p => `${p.ip}:${p.port}` !== `${proxy.ip}:${proxy.port}`
  );
  console.log(`[ProxyManager] 代理失效，已从池中移除: ${proxy.ip}:${proxy.port}`);
  console.log(`[ProxyManager] 池中剩余代理: ${proxyPool.availableProxies.length}`);
}

/**
 * 报告代理成功
 */
export function reportProxySuccess(_proxy: ProxyInfo): void {
  // 成功，保持在池中
  // 可以记录成功次数用于负载均衡
}

/**
 * 刷新代理池
 */
async function refreshProxyPool(): Promise<void> {
  console.log(`[ProxyManager] 刷新代理池...`);

  try {
    // 1. 获取最新代理列表
    const allProxies = await fetchAllProxies();
    console.log(`[ProxyManager] 获取到 ${allProxies.length} 个代理`);

    if (allProxies.length === 0) {
      console.log(`[ProxyManager] 没有获取到代理`);
      return;
    }

    // 2. 快速测试可用性，筛选出可用的
    const availableProxies = await quickTestProxies(
      allProxies.slice(0, 20), // 只测试前20个，避免超时
      2000
    );

    // 3. 更新池状态
    proxyPool.availableProxies = availableProxies.slice(0, MAX_PROXY_COUNT);
    proxyPool.lastRefreshTime = Date.now();
    proxyPool.refreshCount++;

    console.log(`[ProxyManager] 代理池刷新完成，可用代理: ${proxyPool.availableProxies.length}`);

  } catch (error) {
    console.error(`[ProxyManager] 刷新代理池失败:`, error);
  }
}

/**
 * 检查是否需要刷新代理池
 */
function shouldRefreshPool(): boolean {
  const now = Date.now();

  // 首次加载
  if (proxyPool.lastRefreshTime === 0) {
    return true;
  }

  // 代理数量不足
  if (proxyPool.availableProxies.length < MIN_PROXY_COUNT) {
    return true;
  }

  // 超过刷新间隔
  if (now - proxyPool.lastRefreshTime > POOL_REFRESH_INTERVAL) {
    return true;
  }

  return false;
}

/**
 * 获取代理池状态
 */
export function getPoolStatus(): {
  availableCount: number;
  lastRefreshTime: number;
  refreshCount: number;
  blacklistSize: number;
} {
  return {
    availableCount: proxyPool.availableProxies.length,
    lastRefreshTime: proxyPool.lastRefreshTime,
    refreshCount: proxyPool.refreshCount,
    blacklistSize: getBlacklistStatus().size
  };
}

/**
 * 手动触发刷新
 */
export async function manualRefresh(): Promise<void> {
  proxyPool.lastRefreshTime = 0; // 强制刷新
  await refreshProxyPool();
}

/**
 * 获取代理统计信息
 */
export function getProxyStats(): {
  totalFetched: number;
  availableInPool: number;
  isFresh: boolean;
} {
  const isFresh = Date.now() - proxyPool.lastRefreshTime < POOL_REFRESH_INTERVAL;

  return {
    totalFetched: proxyPool.refreshCount,
    availableInPool: proxyPool.availableProxies.length,
    isFresh
  };
}
