/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { VercelRequest } from "@vercel/node";
import type { Middleware, MiddlewareContext } from "./types.js";
import { checkGlobalRateLimit, checkIpRateLimit } from "../rate-limiter.js";
import { FEATURES } from "../config.js";

/**
 * 限流配置
 */
export interface RateLimitConfig {
  enabled: boolean;
  enableGlobalLimit: boolean;
  enableIpLimit: boolean;
}

/**
 * 限流检查结果
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * 从 Vercel 请求中获取客户端 IP
 * @param req Vercel 请求对象
 * @returns 客户端 IP 地址
 */
export function getClientIp(req: VercelRequest): string {
  // 优先使用 Vercel 提供的 IP
  const vercelIp = (req as VercelRequest & { ip?: string }).ip;
  if (vercelIp) {
    return vercelIp;
  }

  // 尝试从各种 headers 中获取真实 IP
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips.trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // 默认返回 unknown
  return "unknown";
}

/**
 * 检查限流（适配 Vercel API 入口）
 * @param clientIp 客户端 IP 地址
 * @returns 限流检查结果
 */
export async function checkRateLimitForIp(
  clientIp: string
): Promise<RateLimitResult> {
  if (!FEATURES.enableRateLimit) {
    return {
      allowed: true,
      remaining: 100,
      resetAt: Date.now() + 60000,
    };
  }

  const result = await checkIpRateLimit(clientIp);
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAt: Date.now() + result.resetIn,
  };
}

// 模块级限流存储
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// 限流配置
const RATE_LIMIT_WINDOW = 60000; // 1 分钟
const RATE_LIMIT_MAX = 100;
const MAX_STORE_SIZE = 10000; // 最大存储条目数

/**
 * 清理过期的限流条目
 * 防止内存泄漏
 */
function cleanupRateLimitStore(): void {
  const now = Date.now();
  
  // 删除过期条目
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
  
  // 如果超过最大数量，删除最旧的条目
  if (rateLimitStore.size > MAX_STORE_SIZE) {
    const entries = [...rateLimitStore.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toDelete = entries.slice(0, rateLimitStore.size - MAX_STORE_SIZE);
    for (const [key] of toDelete) {
      rateLimitStore.delete(key);
    }
  }
}

// 启动定时清理（每分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 60 * 1000);
}

/**
 * 同步版本的限流检查（用于简单场景）
 * 注意：此函数返回一个 Promise 的占位结果，实际限流检查是异步的
 * @param clientIp 客户端 IP 地址
 * @returns 限流检查结果
 */
export function checkRateLimit(clientIp: string): RateLimitResult {
  const now = Date.now();
  const record = rateLimitStore.get(clientIp);

  if (!record || now > record.resetAt) {
    // 创建新窗口
    const newRecord = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW,
    };
    rateLimitStore.set(clientIp, newRecord);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - 1,
      resetAt: newRecord.resetAt,
    };
  }

  // 在当前窗口内
  if (record.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.resetAt,
    };
  }

  // 增加计数
  record.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - record.count,
    resetAt: record.resetAt,
  };
}

/**
 * 创建限流中间件
 * 
 * 支持全局和 IP 级别的限流检查
 */
export function rateLimitMiddleware(config: RateLimitConfig): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    if (!config.enabled) {
      await next();
      return;
    }

    // 全局限流检查
    if (config.enableGlobalLimit) {
      const globalLimit = await checkGlobalRateLimit();
      if (!globalLimit.allowed) {
        context.response = new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again later.",
            code: "RATE_LIMIT_GLOBAL",
            retryAfter: Math.ceil(globalLimit.resetIn / 1000),
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
        return;
      }
    }

    // IP 级限流检查
    if (config.enableIpLimit) {
      const ipLimit = await checkIpRateLimit(context.clientIp);
      if (!ipLimit.allowed) {
        context.response = new Response(
          JSON.stringify({
            error: "Rate limit exceeded for your IP.",
            code: "RATE_LIMIT_IP",
            retryAfter: Math.ceil(ipLimit.resetIn / 1000),
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
        return;
      }
    }

    await next();
  };
}
