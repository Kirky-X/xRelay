/**
 * 缓存工厂
 * 根据环境自动选择缓存实现
 */

import type { CacheProvider } from "./types.js";
import { KVCache } from "./kv-cache.js";
import { MemoryCache } from "./memory-cache.js";
import { getKV } from "../../kv-client.js";

let cacheInstance: CacheProvider | null = null;

/**
 * 获取缓存实例（单例）
 */
export async function getCache<T = unknown>(): Promise<CacheProvider<T>> {
  if (cacheInstance) {
    return cacheInstance as CacheProvider<T>;
  }

  const kv = await getKV();
  cacheInstance = kv ? new KVCache<T>() : new MemoryCache<T>();

  return cacheInstance as CacheProvider<T>;
}

/**
 * 重置缓存实例（用于测试）
 */
export function resetCacheInstance(): void {
  cacheInstance = null;
}
