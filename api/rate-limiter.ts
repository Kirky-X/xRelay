/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limiter - 请求限流（基于 Vercel KV）
 * 防止滥用，保护服务稳定性
 */

import { RATE_LIMIT_CONFIG } from "./config";

// 限流记录
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * 获取 KV 实例
 */
async function getKV() {
  const { createClient } = await import('@vercel/kv');

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return createClient({
    url,
    token,
  });
}

/**
 * 生成限流 key
 */
function generateKey(type: 'global' | 'ip', identifier?: string): string {
  if (type === 'global') {
    return `ratelimit:global`;
  } else {
    return `ratelimit:ip:${identifier}`;
  }
}

/**
 * 检查全局限流
 */
export async function checkGlobalRateLimit(): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  try {
    const kv = await getKV();
    if (!kv) {
      return { allowed: true, remaining: RATE_LIMIT_CONFIG.global.maxRequests, resetIn: 0 };
    }

    const key = generateKey('global');
    const now = Date.now();
    const value = await kv.get<RateLimitRecord>(key);

    if (!value) {
      // 首次请求，创建记录
      const newRecord: RateLimitRecord = {
        count: 1,
        resetTime: now + RATE_LIMIT_CONFIG.global.windowMs,
      };
      await kv.set(key, newRecord, { px: RATE_LIMIT_CONFIG.global.windowMs });
      return {
        allowed: true,
        remaining: RATE_LIMIT_CONFIG.global.maxRequests - 1,
        resetIn: RATE_LIMIT_CONFIG.global.windowMs,
      };
    }

    // 检查是否需要重置
    if (now >= value.resetTime) {
      const newRecord: RateLimitRecord = {
        count: 1,
        resetTime: now + RATE_LIMIT_CONFIG.global.windowMs,
      };
      await kv.set(key, newRecord, { px: RATE_LIMIT_CONFIG.global.windowMs });
      return {
        allowed: true,
        remaining: RATE_LIMIT_CONFIG.global.maxRequests - 1,
        resetIn: RATE_LIMIT_CONFIG.global.windowMs,
      };
    }

    // 检查是否超限
    if (value.count >= RATE_LIMIT_CONFIG.global.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: value.resetTime - now,
      };
    }

    // 增加计数
    const updatedRecord: RateLimitRecord = {
      count: value.count + 1,
      resetTime: value.resetTime,
    };
    await kv.set(key, updatedRecord, { px: RATE_LIMIT_CONFIG.global.windowMs });

    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.global.maxRequests - value.count - 1,
      resetIn: value.resetTime - now,
    };
  } catch (error) {
    console.log(`[RateLimit] 检查全局限流失败: ${error}`);
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.global.maxRequests, resetIn: 0 };
  }
}

/**
 * 检查 IP 限流
 */
export async function checkIpRateLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  try {
    const kv = await getKV();
    if (!kv) {
      return { allowed: true, remaining: RATE_LIMIT_CONFIG.ip.maxRequests, resetIn: 0 };
    }

    const key = generateKey('ip', ip);
    const now = Date.now();
    const value = await kv.get<RateLimitRecord>(key);

    if (!value) {
      // 首次请求，创建记录
      const newRecord: RateLimitRecord = {
        count: 1,
        resetTime: now + RATE_LIMIT_CONFIG.ip.windowMs,
      };
      await kv.set(key, newRecord, { px: RATE_LIMIT_CONFIG.ip.windowMs });
      return {
        allowed: true,
        remaining: RATE_LIMIT_CONFIG.ip.maxRequests - 1,
        resetIn: RATE_LIMIT_CONFIG.ip.windowMs,
      };
    }

    // 检查是否需要重置
    if (now >= value.resetTime) {
      const newRecord: RateLimitRecord = {
        count: 1,
        resetTime: now + RATE_LIMIT_CONFIG.ip.windowMs,
      };
      await kv.set(key, newRecord, { px: RATE_LIMIT_CONFIG.ip.windowMs });
      return {
        allowed: true,
        remaining: RATE_LIMIT_CONFIG.ip.maxRequests - 1,
        resetIn: RATE_LIMIT_CONFIG.ip.windowMs,
      };
    }

    // 检查是否超限
    if (value.count >= RATE_LIMIT_CONFIG.ip.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: value.resetTime - now,
      };
    }

    // 增加计数
    const updatedRecord: RateLimitRecord = {
      count: value.count + 1,
      resetTime: value.resetTime,
    };
    await kv.set(key, updatedRecord, { px: RATE_LIMIT_CONFIG.ip.windowMs });

    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.ip.maxRequests - value.count - 1,
      resetIn: value.resetTime - now,
    };
  } catch (error) {
    console.log(`[RateLimit] 检查 IP 限流失败: ${error}`);
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.ip.maxRequests, resetIn: 0 };
  }
}

/**
 * 重置限流
 */
export async function resetRateLimit(type: 'global' | 'ip', identifier?: string): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv) {
      return;
    }

    const key = generateKey(type, identifier);
    await kv.del(key);
    console.log(`[RateLimit] 重置限流: ${key}`);
  } catch (error) {
    console.log(`[RateLimit] 重置限流失败: ${error}`);
  }
}

/**
 * 获取限流状态
 */
export async function getRateLimitStatus(type: 'global' | 'ip', identifier?: string): Promise<{
  count: number;
  maxRequests: number;
  resetIn: number;
}> {
  try {
    const kv = await getKV();
    if (!kv) {
      return {
        count: 0,
        maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
        resetIn: 0,
      };
    }

    const key = generateKey(type, identifier);
    const value = await kv.get<RateLimitRecord>(key);
    const now = Date.now();

    if (!value) {
      return {
        count: 0,
        maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
        resetIn: 0,
      };
    }

    return {
      count: value.count,
      maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
      resetIn: Math.max(0, value.resetTime - now),
    };
  } catch (error) {
    console.log(`[RateLimit] 获取限流状态失败: ${error}`);
    return {
      count: 0,
      maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
      resetIn: 0,
    };
  }
}
