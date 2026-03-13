/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cache - 响应缓存（基于 Vercel KV）
 * 对相同 URL 的请求进行缓存，减少重复请求
 * 
 * 注意：缓存过期完全依赖 KV 的 TTL 自动过期机制，无需手动清理
 */

import type { ProxyResponse } from "./request-handler.js";
import { getKV } from "./kv-client.js";
import { CACHE_CONFIG } from "./config.js";

// 缓存条目
interface CacheEntry {
  response: ProxyResponse;
  timestamp: number;
}

/**
 * 生成缓存 key
 */
function generateCacheKey(url: string, method: string): string {
  return `cache:${method.toUpperCase()}:${url}`;
}

/**
 * 获取缓存
 * 依赖 KV 的 TTL 自动过期机制，无需手动检查过期
 */
export async function getCachedResponse(
  url: string,
  method: string,
): Promise<ProxyResponse | null> {
  try {
    const kv = await getKV();
    if (!kv) {
      return null;
    }

    const key = generateCacheKey(url, method);
    const value = await kv.get<CacheEntry>(key);

    if (!value) {
      return null;
    }

    console.log(`[Cache] 缓存命中: ${key}`);
    return value.response;
  } catch (error) {
    console.log(`[Cache] 获取缓存失败: ${error}`);
    return null;
  }
}

/**
 * 缓存响应
 * 使用 KV 的 TTL 自动过期机制
 */
export async function cacheResponse(
  url: string,
  method: string,
  response: ProxyResponse,
): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) {
      return;
    }

    // 只缓存成功的响应
    if (!response.success) {
      console.log(`[Cache] 不缓存失败的响应`);
      return;
    }

    const key = generateCacheKey(url, method);
    const entry: CacheEntry = {
      response,
      timestamp: Date.now(),
    };

    // 设置缓存，使用 KV 的 TTL 自动过期
    await kv.set(key, entry, { px: CACHE_CONFIG.ttl });
    console.log(`[Cache] 缓存响应: ${key} (TTL: ${CACHE_CONFIG.ttl}ms)`);
  } catch (error) {
    console.log(`[Cache] 缓存响应失败: ${error}`);
  }
}

/**
 * 清除所有缓存
 */
export async function clearCache(): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) {
      return;
    }

    let count = 0;

    // 使用 scanIterator 列出所有缓存键
    for await (const key of kv.scanIterator({ match: 'cache:*' })) {
      await kv.del(key);
      count++;
    }

    console.log(`[Cache] 缓存已清除，删除了 ${count} 个条目`);
  } catch (error) {
    console.log(`[Cache] 清除缓存失败: ${error}`);
  }
}

/**
 * 获取缓存状态
 */
export async function getCacheStatus(): Promise<{
  size: number;
  maxSize: number;
  ttlMs: number;
}> {
  try {
    const kv = await getKV();
    if (!kv) {
      return {
        size: 0,
        maxSize: CACHE_CONFIG.maxSize,
        ttlMs: CACHE_CONFIG.ttl,
      };
    }

    let count = 0;

    for await (const key of kv.scanIterator({ match: 'cache:*' })) {
      count++;
    }

    return {
      size: count,
      maxSize: CACHE_CONFIG.maxSize,
      ttlMs: CACHE_CONFIG.ttl,
    };
  } catch (error) {
    console.log(`[Cache] 获取缓存状态失败: ${error}`);
    return {
      size: 0,
      maxSize: CACHE_CONFIG.maxSize,
      ttlMs: CACHE_CONFIG.ttl,
    };
  }
}

/**
 * 删除特定 URL 的缓存
 */
export async function invalidateCache(url: string, method: string): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) {
      return;
    }

    const key = generateCacheKey(url, method);
    await kv.del(key);
    console.log(`[Cache] 失效缓存: ${key}`);
  } catch (error) {
    console.log(`[Cache] 失效缓存失败: ${error}`);
  }
}
