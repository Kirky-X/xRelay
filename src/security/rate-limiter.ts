/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 限流器模块
 * 实现滑动窗口限流算法，防止 API 滥用
 */

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export class SlidingWindowRateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let entry = this.store.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    const currentCount = entry.timestamps.length;

    if (currentCount >= this.maxRequests) {
      const oldestTimestamp = entry.timestamps[0];
      const retryAfter = Math.ceil((oldestTimestamp - windowStart) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetAt: oldestTimestamp + this.windowMs,
        retryAfter,
      };
    }

    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: this.maxRequests - currentCount - 1,
      resetAt: now + this.windowMs,
      retryAfter: 0,
    };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  getStats(key: string): { count: number; remaining: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    const windowStart = now - this.windowMs;
    const count = entry.timestamps.filter(t => t > windowStart).length;

    return {
      count,
      remaining: this.maxRequests - count,
    };
  }
}
