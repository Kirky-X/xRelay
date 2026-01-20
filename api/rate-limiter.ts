/**
 * Rate Limiter - 请求限流
 * 防止滥用，保护代理资源
 */

// 限流配置
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟窗口
const MAX_REQUESTS_PER_WINDOW = 10; // 每分钟最多10次
const IP_RATE_LIMIT_WINDOW = 60 * 1000; // IP 级别限流
const MAX_REQUESTS_PER_IP = 5; // 每个 IP 每分钟最多5次

// 内存存储（Vercel Edge 中使用全局变量）
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// 全局限流状态
const globalRateLimit: Map<string, RateLimitEntry> = new Map();
const ipRateLimit: Map<string, RateLimitEntry> = new Map();

/**
 * 检查全局限流
 */
export function checkGlobalRateLimit(): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const key = 'global';
  const entry = globalRateLimit.get(key);

  if (!entry || now > entry.resetTime) {
    // 新窗口
    globalRateLimit.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return {
      allowed: true,
      remaining: MAX_REQUESTS_PER_WINDOW - 1,
      resetIn: RATE_LIMIT_WINDOW
    };
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_WINDOW - entry.count,
    resetIn: entry.resetTime - now
  };
}

/**
 * 检查 IP 级别限流
 */
export function checkIpRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = ipRateLimit.get(ip);

  if (!entry || now > entry.resetTime) {
    // 新窗口
    ipRateLimit.set(ip, {
      count: 1,
      resetTime: now + IP_RATE_LIMIT_WINDOW
    });
    return {
      allowed: true,
      remaining: MAX_REQUESTS_PER_IP - 1,
      resetIn: IP_RATE_LIMIT_WINDOW
    };
  }

  if (entry.count >= MAX_REQUESTS_PER_IP) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_IP - entry.count,
    resetIn: entry.resetTime - now
  };
}

/**
 * 获取限流状态
 */
export function getRateLimitStatus() {
  return {
    global: {
      limit: MAX_REQUESTS_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW
    },
    ip: {
      limit: MAX_REQUESTS_PER_IP,
      windowMs: IP_RATE_LIMIT_WINDOW
    }
  };
}

/**
 * 清理过期的限流记录
 */
export function cleanupRateLimits(): void {
  const now = Date.now();

  for (const [key, entry] of globalRateLimit.entries()) {
    if (now > entry.resetTime) {
      globalRateLimit.delete(key);
    }
  }

  for (const [key, entry] of ipRateLimit.entries()) {
    if (now > entry.resetTime) {
      ipRateLimit.delete(key);
    }
  }

  console.log(`[RateLimiter] 清理完成，全局限流: ${globalRateLimit.size}, IP限流: ${ipRateLimit.size}`);
}
