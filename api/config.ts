/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Configuration - 全局配置
 */

// 代理配置
export const PROXY_CONFIG = {
  // 代理源
  sources: [
    {
      name: "ProxyScrape",
      url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&limit=20",
    },
    {
      name: "FreeProxyList",
      url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/main/http.txt",
    },
    {
      name: "ProxyListDownload",
      url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    },
  ],

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

// 限流配置
export const RATE_LIMIT_CONFIG = {
  global: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 10,
  },
  ip: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 5,
  },
};

// 缓存配置
export const CACHE_CONFIG = {
  ttl: 5 * 60 * 1000, // 5分钟
  maxSize: 100,
};

// 功能开关
export const FEATURES = {
  enableCache: true,
  enableRateLimit: true,
  enableFallback: true,
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
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  // 是否启用详细日志（生产环境应设为 false）
  enableVerboseLogging: process.env.NODE_ENV !== "production",
};
