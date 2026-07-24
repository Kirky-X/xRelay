/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  tags: string[];
}

/**
 * 高级缓存 - 真正的 LRU 实现
 *
 * 使用 Map 的插入顺序特性实现 LRU：
 * - get 命中时 delete + 重新 set（移到末尾，标记为最近使用）
 * - 淘汰时删除 keys().next().value（最旧，最少最近使用）
 *
 * 统计：
 * - hits：缓存命中次数
 * - misses：缓存未命中次数
 * - hitRate = hits / (hits + misses)
 */
export class AdvancedCache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000, defaultTtl = 300000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    // LRU：移到末尾（最近使用）
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.data;
  }

  set(key: string, data: T, ttl?: number, tags: string[] = []): void {
    // 已存在则先删除（保证移到末尾）
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      this.evictLru();
    }

    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
      tags,
    });
  }

  /**
   * LRU 淘汰：删除最旧（最近最少使用）的条目
   * Map 的 keys().next().value 返回最早插入的 key
   */
  private evictLru(): void {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
    }
  }

  invalidateByTag(tag: string): void {
    for (const [key, entry] of this.store.entries()) {
      if (entry.tags.includes(tag)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}
