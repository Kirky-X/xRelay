/**
 * 内存缓存实现
 * 使用 LRU 策略
 */

import type { CacheProvider, CacheEntry, CacheStats } from "./types.js";
import { CACHE_CONFIG } from "../../config.js";
import { logger } from "../../logger.js";

export class MemoryCache<T = unknown> implements CacheProvider<T> {
  private store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  async get(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  async set(key: string, value: T, ttl: number = CACHE_CONFIG.ttl): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl,
    };

    this.store.set(key, entry);

    if (this.store.size > CACHE_CONFIG.maxSize) {
      this.evictLRU();
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  async getStats(): Promise<CacheStats> {
    return {
      size: this.store.size,
      maxSize: CACHE_CONFIG.maxSize,
      ttlMs: CACHE_CONFIG.ttl,
      hitRate: this.hits / (this.hits + this.misses) || 0,
    };
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
      logger.debug(`LRU 驱逐: ${oldestKey}`, { module: 'MemoryCache' });
    }
  }
}
