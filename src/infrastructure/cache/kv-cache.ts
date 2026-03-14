/**
 * KV 缓存实现
 * 使用 Vercel KV 存储
 */

import type { CacheProvider, CacheEntry, CacheStats } from "./types.js";
import { getKV } from "../../kv-client.js";
import { CACHE_CONFIG } from "../../config.js";
import { logger } from "../../logger.js";

export class KVCache<T = unknown> implements CacheProvider<T> {
  private hits = 0;
  private misses = 0;

  async get(key: string): Promise<T | null> {
    try {
      const kv = await getKV();
      if (!kv) {
        return null;
      }

      const value = await kv.get<CacheEntry<T>>(`cache:${key}`);
      if (!value) {
        this.misses++;
        return null;
      }

      const entry = value as CacheEntry<T>;
      if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
        await kv.del(`cache:${key}`);
        this.misses++;
        return null;
      }

      this.hits++;
      return entry.value;
    } catch (error) {
      logger.debug(`获取缓存失败: ${error}`, { module: 'KVCache' });
      return null;
    }
  }

  async set(key: string, value: T, ttl: number = CACHE_CONFIG.ttl): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) {
        return;
      }

      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
      };

      await kv.set(`cache:${key}`, entry, { px: ttl });
      logger.debug(`缓存响应: ${key} (TTL: ${ttl}ms)`, { module: 'KVCache' });
    } catch (error) {
      logger.debug(`缓存响应失败: ${error}`, { module: 'KVCache' });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) {
        return;
      }

      await kv.del(`cache:${key}`);
      logger.debug(`失效缓存: ${key}`, { module: 'KVCache' });
    } catch (error) {
      logger.debug(`失效缓存失败: ${error}`, { module: 'KVCache' });
    }
  }

  async clear(): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) {
        return;
      }

      let count = 0;
      const keys = await kv.keys('cache:*');
      for (const key of keys) {
        await kv.del(key);
        count++;
      }

      logger.info(`缓存已清除，删除了 ${count} 个条目`, { module: 'KVCache' });
    } catch (error) {
      logger.error('清除缓存失败', error instanceof Error ? error : undefined, { module: 'KVCache' });
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const kv = await getKV();
      if (!kv) {
        return {
          size: 0,
          maxSize: CACHE_CONFIG.maxSize,
          ttlMs: CACHE_CONFIG.ttl,
          hitRate: 0,
        };
      }

      const keys = await kv.keys('cache:*');
      const count = keys.length;

      return {
        size: count,
        maxSize: CACHE_CONFIG.maxSize,
        ttlMs: CACHE_CONFIG.ttl,
        hitRate: this.hits / (this.hits + this.misses) || 0,
      };
    } catch (error) {
      logger.debug(`获取缓存状态失败: ${error}`, { module: 'KVCache' });
      return {
        size: 0,
        maxSize: CACHE_CONFIG.maxSize,
        ttlMs: CACHE_CONFIG.ttl,
        hitRate: 0,
      };
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const kv = await getKV();
      if (!kv) {
        return false;
      }

      const value = await kv.get<CacheEntry<T>>(`cache:${key}`);
      if (!value) {
        return false;
      }

      const entry = value as CacheEntry<T>;
      if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
        await kv.del(`cache:${key}`);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
