/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limiter - 请求限流
 * 防止滥用，保护代理资源
 */

import { RATE_LIMIT_CONFIG } from "./config";

// 内存存储（Vercel Edge 中使用全局变量）
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// 全局限流状态
const globalRateLimit: Map<string, RateLimitEntry> = new Map();
const ipRateLimit: Map<string, RateLimitEntry> = new Map();

// 自动清理定时器
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// 启动自动清理
function startAutoCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(
    () => {
      cleanupRateLimits();
    },
    5 * 60 * 1000,
  ); // 每 5 分钟清理一次
}

// 确保清理定时器启动
startAutoCleanup();

/**
 * 检查全局限流
 */
export function checkGlobalRateLimit(): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const now = Date.now();
  const key = "global";
  const entry = globalRateLimit.get(key);

  if (!entry || now > entry.resetTime) {
    // 新窗口
    globalRateLimit.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_CONFIG.global.windowMs,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.global.maxRequests - 1,
      resetIn: RATE_LIMIT_CONFIG.global.windowMs,
    };
  }

  if (entry.count >= RATE_LIMIT_CONFIG.global.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.global.maxRequests - entry.count,
    resetIn: entry.resetTime - now,
  };
}

/**
 * 检查 IP 级别限流
 */
export function checkIpRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const now = Date.now();
  const entry = ipRateLimit.get(ip);

  if (!entry || now > entry.resetTime) {
    // 新窗口
    ipRateLimit.set(ip, {
      count: 1,
      resetTime: now + RATE_LIMIT_CONFIG.ip.windowMs,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.ip.maxRequests - 1,
      resetIn: RATE_LIMIT_CONFIG.ip.windowMs,
    };
  }

  if (entry.count >= RATE_LIMIT_CONFIG.ip.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.ip.maxRequests - entry.count,
    resetIn: entry.resetTime - now,
  };
}

/**
 * 获取限流状态
 */
export function getRateLimitStatus() {
  return {
    global: {
      limit: RATE_LIMIT_CONFIG.global.maxRequests,
      windowMs: RATE_LIMIT_CONFIG.global.windowMs,
    },
    ip: {
      limit: RATE_LIMIT_CONFIG.ip.maxRequests,
      windowMs: RATE_LIMIT_CONFIG.ip.windowMs,
    },
  };
}

/**
 * 清理过期的限流记录
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  let removedGlobal = 0;
  let removedIp = 0;

  for (const [key, entry] of globalRateLimit.entries()) {
    if (now > entry.resetTime) {
      globalRateLimit.delete(key);
      removedGlobal++;
    }
  }

  for (const [key, entry] of ipRateLimit.entries()) {
    if (now > entry.resetTime) {
      ipRateLimit.delete(key);
      removedIp++;
    }
  }

  if (removedGlobal > 0 || removedIp > 0) {
    console.log(
      `[RateLimiter] 清理完成，全局限流: ${globalRateLimit.size} (移除 ${removedGlobal}), IP限流: ${ipRateLimit.size} (移除 ${removedIp})`,
    );
  }
}
