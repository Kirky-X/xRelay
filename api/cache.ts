/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cache - 响应缓存
 * 对相同 URL 的请求进行缓存，减少重复请求
 */

import type { ProxyResponse } from "./request-handler";
import { CACHE_CONFIG } from "./config";

// 缓存条目
interface CacheEntry {
  key: string;
  response: ProxyResponse;
  timestamp: number;
}

// 内存缓存
const cacheStore: Map<string, CacheEntry> = new Map();

/**
 * 生成缓存 key
 */
function generateCacheKey(url: string, method: string): string {
  return `${method.toUpperCase()}:${url}`;
}

/**
 * 获取缓存
 */
export function getCachedResponse(
  url: string,
  method: string,
): ProxyResponse | null {
  const key = generateCacheKey(url, method);
  const entry = cacheStore.get(key);

  if (!entry) {
    return null;
  }

  const now = Date.now();

  // 检查是否过期
  if (now - entry.timestamp > CACHE_CONFIG.ttl) {
    console.log(`[Cache] 缓存过期，删除: ${key}`);
    cacheStore.delete(key);
    return null;
  }

  console.log(`[Cache] 缓存命中: ${key}`);
  return {
    ...entry.response,
    // 标记这是从缓存返回的
  };
}

/**
 * 缓存响应
 */
export function cacheResponse(
  url: string,
  method: string,
  response: ProxyResponse,
): void {
  // 只缓存成功的响应
  if (!response.success) {
    console.log(`[Cache] 不缓存失败的响应`);
    return;
  }

  const key = generateCacheKey(url, method);

  // 如果缓存已满，删除最旧的条目
  if (cacheStore.size >= CACHE_CONFIG.maxSize) {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [k, entry] of cacheStore.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = k;
      }
    }

    if (oldestKey) {
      console.log(`[Cache] 缓存已满，删除最旧条目: ${oldestKey}`);
      cacheStore.delete(oldestKey);
    }
  }

  cacheStore.set(key, {
    key,
    response,
    timestamp: Date.now(),
  });

  console.log(`[Cache] 缓存响应: ${key}`);
}

/**
 * 清除缓存
 */
export function clearCache(): void {
  cacheStore.clear();
  console.log(`[Cache] 缓存已清除`);
}

/**
 * 获取缓存状态
 */
export function getCacheStatus(): {
  size: number;
  maxSize: number;
  ttlMs: number;
} {
  return {
    size: cacheStore.size,
    maxSize: CACHE_CONFIG.maxSize,
    ttlMs: CACHE_CONFIG.ttl,
  };
}

/**
 * 清理过期缓存
 */
export function cleanupCache(): void {
  const now = Date.now();
  let removedCount = 0;

  for (const [key, entry] of cacheStore.entries()) {
    if (now - entry.timestamp > CACHE_CONFIG.ttl) {
      cacheStore.delete(key);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`[Cache] 清理了 ${removedCount} 个过期缓存`);
  }
}

/**
 * 删除特定 URL 的缓存
 */
export function invalidateCache(url: string, method: string): void {
  const key = generateCacheKey(url, method);
  cacheStore.delete(key);
  console.log(`[Cache] 失效缓存: ${key}`);
}
