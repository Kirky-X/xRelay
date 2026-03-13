/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limiter - 请求限流（基于 Vercel KV）
 * 防止滥用，保护服务稳定性
 */

import { getKV } from "./kv-client.js";
import { RATE_LIMIT_CONFIG } from "./config.js";

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
 * 检查限流（通用实现）
 */
async function checkRateLimit(
  type: 'global' | 'ip',
  identifier?: string
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  try {
    const kv = await getKV();
    const config = type === 'global' ? RATE_LIMIT_CONFIG.global : RATE_LIMIT_CONFIG.ip;

    if (!kv) {
      return { allowed: true, remaining: config.maxRequests, resetIn: 0 };
    }

    const key = generateKey(type, identifier);
    const maxRequests = config.maxRequests;
    const windowMs = config.windowMs;

    // 原子递增计数
    const count = await kv.incr(key);

    // 首次递增时设置过期时间
    if (count === 1) {
      await kv.pexpire(key, windowMs);
    }

    // 获取剩余时间（毫秒）
    const ttl = await kv.pttl(key);
    const resetIn = ttl > 0 ? ttl : windowMs;

    // 检查是否超限
    if (count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      resetIn,
    };
  } catch (error) {
    const config = type === 'global' ? RATE_LIMIT_CONFIG.global : RATE_LIMIT_CONFIG.ip;
    console.log(`[RateLimit] 检查${type === 'global' ? '全局' : 'IP'}限流失败: ${error}`);
    // 错误时拒绝请求，而非放行
    return { allowed: false, remaining: 0, resetIn: config.windowMs };
  }
}

/**
 * 检查全局限流
 */
export const checkGlobalRateLimit = () => checkRateLimit('global');

/**
 * 检查 IP 限流
 */
export const checkIpRateLimit = (ip: string) => checkRateLimit('ip', ip);

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
 * 获取限流状态（适配原子操作存储格式）
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

    // 获取当前计数（原子操作存储的是简单数字）
    const count = await kv.get<number>(key);

    if (count === null) {
      return {
        count: 0,
        maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
        resetIn: 0,
      };
    }

    // 获取剩余时间（毫秒）
    const ttl = await kv.pttl(key);
    const resetIn = ttl > 0 ? ttl : 0;

    return {
      count,
      maxRequests: type === 'global' ? RATE_LIMIT_CONFIG.global.maxRequests : RATE_LIMIT_CONFIG.ip.maxRequests,
      resetIn,
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
