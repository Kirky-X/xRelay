/**
 * Cache - 缓存模块（向后兼容层）
 * 此文件重新导出新的模块化实现，并提供面向业务的便捷函数
 */

import { getCache, resetCacheInstance } from "./infrastructure/cache/factory.js";
import { CACHE_CONFIG } from "./config.js";
import { logger } from "./logger.js";

export { getCache, resetCacheInstance };
export type { CacheProvider, CacheEntry, CacheStats } from "./infrastructure/cache/types.js";

/**
 * 生成缓存键
 */
function buildCacheKey(url: string, method: string): string {
  return `${method.toUpperCase()}:${url}`;
}

/**
 * 判断响应是否值得缓存
 * 失败响应、空响应不缓存
 */
function isCacheable(response: unknown): boolean {
  if (!response || typeof response !== "object") {
    return false;
  }

  const r = response as { success?: unknown; status?: unknown; data?: unknown };
  if (r.success === false) {
    return false;
  }

  // 状态码 4xx/5xx 不缓存
  if (typeof r.status === "number" && (r.status < 200 || r.status >= 400)) {
    return false;
  }

  return true;
}

/**
 * 缓存代理响应
 */
export async function cacheResponse<T>(
  url: string,
  method: string,
  response: T,
): Promise<void> {
  if (!isCacheable(response)) {
    logger.debug(`跳过缓存（响应不可缓存）: ${method} ${url}`, {
      module: "Cache",
    });
    return;
  }

  const cache = await getCache<T>();
  const key = buildCacheKey(url, method);
  await cache.set(key, response, CACHE_CONFIG.ttl);
}

/**
 * 获取缓存的响应
 */
export async function getCachedResponse<T>(
  url: string,
  method: string,
): Promise<T | null> {
  const cache = await getCache<T>();
  const key = buildCacheKey(url, method);
  return cache.get(key);
}

/**
 * 清空整个缓存
 */
export async function clearCache(): Promise<void> {
  const cache = await getCache();
  await cache.clear();
  resetCacheInstance();
}

/**
 * 失效指定 URL + 方法的缓存
 */
export async function invalidateCache(
  url: string,
  method: string,
): Promise<void> {
  const cache = await getCache();
  const key = buildCacheKey(url, method);
  await cache.delete(key);
}

/**
 * 获取缓存状态
 */
export async function getCacheStatus() {
  const cache = await getCache();
  const stats = await cache.getStats();
  return {
    size: stats.size,
    maxSize: CACHE_CONFIG.maxSize,
    ttlMs: CACHE_CONFIG.ttl,
    hitRate: stats.hitRate,
  };
}
