/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Rate Limit - 请求限流
 *
 * 设计说明：
 * - 单实例内存限流（基于 Map + 滑动窗口），适用于 Vercel Serverless 与 Bun 单实例场景
 * - 跨实例分布式限流（基于 Vercel KV）原 `src/rate-limiter.ts` 已删除：
 *   业务实际通过同步 `checkRateLimit` 处理，未使用 KV 异步限流。
 * - IP 提取同时支持 VercelRequest（@vercel/node）与标准 Request（Bun/Edge Runtime）
 */

import type { VercelRequest } from "@vercel/node";
import { FEATURES } from "../config.js";

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
 * 从标准 Request 对象中获取客户端 IP（用于 Bun 等运行时）
 * @param request 标准 Request 对象
 * @returns 客户端 IP 地址
 */
export function getClientIpFromRequest(request: Request): string {
  // 尝试从各种 headers 中获取真实 IP
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // 默认返回 unknown
  return "unknown";
}

// 模块级限流存储（按端点隔离）
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const captureRateLimitStore = new Map<string, { count: number; resetAt: number }>();

// 限流配置
const RATE_LIMIT_WINDOW = 60000; // 1 分钟
const RATE_LIMIT_MAX = 100;
const CAPTURE_RATE_LIMIT_MAX = 30;
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
  for (const [key, record] of captureRateLimitStore.entries()) {
    if (now > record.resetAt) {
      captureRateLimitStore.delete(key);
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
  if (captureRateLimitStore.size > MAX_STORE_SIZE) {
    const entries = [...captureRateLimitStore.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toDelete = entries.slice(0, captureRateLimitStore.size - MAX_STORE_SIZE);
    for (const [key] of toDelete) {
      captureRateLimitStore.delete(key);
    }
  }
}

// 启动定时清理（每分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 60 * 1000);
}

/**
 * 验证 IP 地址格式是否有效
 */
function isValidIpFormat(ip: string): boolean {
  // IPv4 格式验证
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }

  // IPv6 简单格式验证
  if (ip.includes(':')) {
    return ip.length >= 2 && ip.length <= 45;
  }

  return false;
}

/**
 * 同步限流检查
 *
 * 设计选择同步而非异步：业务路径（standalone.ts / api/index.ts）在请求处理前同步调用，
 * 避免异步开销。内存存储足够单实例场景使用；如需跨实例限流，
 * 应通过反向代理或外置限流服务（如 Vercel Edge Config）实现，而非应用层。
 *
 * @param clientIp 客户端 IP 地址
 * @param endpoint 端点类型，可选 'default' | 'capture'
 * @returns 限流检查结果
 */
export function checkRateLimit(clientIp: string, endpoint?: string): RateLimitResult {
  // 限流未启用时直接放行
  if (!FEATURES.enableRateLimit) {
    return {
      allowed: true,
      remaining: 100,
      resetAt: Date.now() + RATE_LIMIT_WINDOW,
    };
  }

  const now = Date.now();
  const store = endpoint === 'capture' ? captureRateLimitStore : rateLimitStore;

  // 对 unknown IP 或无效 IP 实施更严格的限流（原限制的 1/10）
  // 防止攻击者伪造 IP 头部绕过限流
  const isUnknownOrInvalid = clientIp === 'unknown' || !isValidIpFormat(clientIp);
  const baseLimit = endpoint === 'capture' ? CAPTURE_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  const maxLimit = isUnknownOrInvalid ? Math.floor(baseLimit / 10) : baseLimit;

  const record = store.get(clientIp);

  if (!record || now > record.resetAt) {
    // 创建新窗口
    const newRecord = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW,
    };
    store.set(clientIp, newRecord);
    return {
      allowed: true,
      remaining: maxLimit - 1,
      resetAt: newRecord.resetAt,
    };
  }

  // 在当前窗口内
  if (record.count >= maxLimit) {
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
    remaining: maxLimit - record.count,
    resetAt: record.resetAt,
  };
}
