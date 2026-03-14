/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  tags: string[];
  hitCount: number;
}

export class AdvancedCache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;

  constructor(maxSize = 1000, defaultTtl = 300000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.store.delete(key);
      return null;
    }
    
    entry.hitCount++;
    return entry.data;
  }

  set(key: string, data: T, ttl?: number, tags: string[] = []): void {
    if (this.store.size >= this.maxSize) {
      this.evictLru();
    }
    
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
      tags,
      hitCount: 0,
    });
  }

  private evictLru(): void {
    const entries = [...this.store.entries()]
      .sort((a, b) => a[1].hitCount - b[1].hitCount);
    
    const toEvict = entries.slice(0, Math.floor(this.maxSize * 0.1));
    toEvict.forEach(([key]) => this.store.delete(key));
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
    const totalHits = [...this.store.values()].reduce((sum, e) => sum + e.hitCount, 0);
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hitRate: totalHits / (this.store.size || 1),
    };
  }
}
