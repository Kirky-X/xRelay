/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Configuration - 全局配置
 */

// 代理配置
// 注意：代理源列表在 src/proxy-fetcher.ts 的 PROXY_SOURCES 中维护
// 此处仅保留代理池与超时配置
export const PROXY_CONFIG = {
  // 代理池配置
  pool: {
    refreshInterval: 5 * 60 * 1000, // 5分钟
    minProxyCount: 3,
    maxProxyCount: 10,
    testTimeout: 2000,
    maxAttempts: 3,
  },

  // 请求超时
  timeouts: {
    proxy: 8000, // 8秒
    direct: 10000, // 10秒
  },
};

// 数据库配置
export const DATABASE_CONFIG = {
  // 最小代理数量，低于此值时自动补充
  minProxyCount: 5,
  // 失败阈值，超过此值移入废弃表
  failureThreshold: 10,
  // 废弃代理保留天数
  deprecatedRetentionDays: 30,
  // 自动清理间隔（毫秒）
  cleanupInterval: 24 * 60 * 60 * 1000, // 24小时
  // 每次请求选取的代理数量
  proxiesPerRequest: 5,
  // 连接池配置
  pool: {
    maxConnections: 20,
    idleTimeoutMillis: 30000, // 30秒
    connectionTimeoutMillis: 5000, // 5秒
  },
};

// 限流配置（按端点隔离）
// 注意：实际限流实现在 middleware/rate-limit.ts 中
// 此处配置作为文档参考，运行时使用 rate-limit.ts 中的硬编码值
export const RATE_LIMIT_CONFIG = {
  proxy: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 100,
  },
  capture: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 30,
  },
  // 未知/无效 IP 使用更严格限制（1/10）
  unknownIpDivisor: 10,
};

// 缓存配置
export const CACHE_CONFIG = {
  ttl: 5 * 60 * 1000, // 5分钟
  maxSize: 100,
};

// 功能开关
export const FEATURES = {
  enableCache: process.env.ENABLE_CACHE !== "false",
  enableRateLimit: process.env.ENABLE_RATE_LIMIT !== "false",
  enableFallback: process.env.ENABLE_FALLBACK !== "false",
  enableApiKey: process.env.ENABLE_API_KEY === "true",
};

// API Key 配置
export const API_KEY_CONFIG = {
  enabled: process.env.ENABLE_API_KEY === "true",
  keys: process.env.API_KEYS ? process.env.API_KEYS.split(",") : [],
  headerName: process.env.API_KEY_HEADER || "x-api-key",
};

// 代理测试配置
export const PROXY_TEST_CONFIG = {
  testTimeout: 3000,
  testUrl: "https://httpbin.org/ip",
  blacklistDuration: 5 * 60 * 1000,
  quickTestTimeout: 2000,
};

// 请求超时配置
export const REQUEST_TIMEOUT_CONFIG = {
  proxy: 8000,
  direct: 10000,
};

// 安全配置
export const SECURITY_CONFIG = {
  // URL 白名单（防止 SSRF）
  // 空数组表示允许所有公网 URL（但会阻止内网地址）
  allowedDomains: [] as string[],
  // 允许的协议
  allowedProtocols: ["http:", "https:"],
  // 禁止的内网地址段
  blockedIpRanges: [
    "127.0.0.0/8", // Loopback
    "10.0.0.0/8", // Private Class A
    "172.16.0.0/12", // Private Class B
    "192.168.0.0/16", // Private Class C
    "169.254.0.0/16", // Link-local
    "::1/128", // IPv6 Loopback
    "fc00::/7", // IPv6 Private
    "fe80::/10", // IPv6 Link-local
  ],
  // 请求大小限制（字节）
  maxRequestSize: 100 * 1024, // 100KB (was 10MB)
  // 响应体大小限制（字节）
  // 用于限制代理/直连/降级路径的响应体读取，防止 OOM
  // 与 request-handler.ts 和 webpage-capture/* 共享使用
  maxResponseSize: 10 * 1024 * 1024, // 10MB
  // 是否启用详细日志（生产环境应设为 false）
  enableVerboseLogging: process.env.NODE_ENV !== "production",
};

/**
 * 检查是否为生产环境
 */
export function isProduction(): boolean {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

// CORS 配置
// 优先从 CORS_ORIGINS 环境变量读取（逗号分隔），未配置时回退到默认白名单
// 生产环境务必显式配置 CORS_ORIGINS，避免依赖硬编码默认值
export const CORS_CONFIG = {
  allowedOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : isProduction()
      ? ["https://vercel-proxy-shield.vercel.app"]
      : [
          "https://vercel-proxy-shield.vercel.app",
          "http://localhost:3000",
          "http://localhost:5173",
        ],
  allowedMethods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 86400, // 24小时
};

/**
 * 验证生产环境配置
 * @returns 验证结果，包含是否有效和错误列表
 *
 * 注意：本函数仅返回验证结果，是否阻止启动由调用方决定。
 * - standalone.ts（独立部署）：验证失败时记录错误并 exit(1)
 * - Vercel Edge：函数即起即停，不阻止启动但记录错误日志
 */
export function validateProductionConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (isProduction()) {
    // 生产环境必须配置 API Key
    if (!process.env.API_KEYS || process.env.API_KEYS.trim() === "") {
      errors.push("API_KEYS environment variable must be set in production");
    }

    // 生产环境必须启用 API Key 验证
    if (process.env.ENABLE_API_KEY !== "true") {
      errors.push("ENABLE_API_KEY must be set to 'true' in production");
    }

    // 生产环境必须配置 CRON_SECRET，防止未授权触发清理任务
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.trim() === "") {
      errors.push("CRON_SECRET environment variable must be set in production to protect cron endpoints");
    }

    // 生产环境建议显式配置 CORS_ORIGINS（不依赖硬编码默认值）
    if (!process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.trim() === "") {
      errors.push("CORS_ORIGINS environment variable must be set in production to lock down allowed origins");
    }

    // 生产环境应关闭详细日志
    if (process.env.ENABLE_VERBOSE_LOGGING === "true") {
      console.warn("[Config] WARNING: Verbose logging is enabled in production");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 验证生产环境配置，失败时记录错误并退出进程（仅独立部署使用）
 *
 * 用于 standalone.ts 等长生命周期进程：配置错误会导致服务以不安全状态运行，
 * 因此必须 fail-closed。Vercel Edge 函数不调用此函数（短生命周期，无法 exit）。
 */
export function enforceProductionConfigOrExit(): void {
  const result = validateProductionConfig();
  if (!result.valid) {
    for (const err of result.errors) {
      console.error(`[Config] CRITICAL: ${err}`);
    }
    console.error("[Config] Production config validation failed. Exiting.");
    process.exit(1);
  }
}
