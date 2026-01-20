/**
 * Configuration - 全局配置
 */

// 代理配置
export const PROXY_CONFIG = {
  // 代理源
  sources: [
    {
      name: 'ProxyScrape',
      url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&limit=20'
    },
    {
      name: 'FreeProxyList',
      url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/main/http.txt'
    },
    {
      name: 'ProxyListDownload',
      url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
    }
  ],

  // 代理池配置
  pool: {
    refreshInterval: 5 * 60 * 1000, // 5分钟
    minProxyCount: 3,
    maxProxyCount: 10,
    testTimeout: 2000,
    maxAttempts: 3
  },

  // 请求超时
  timeouts: {
    proxy: 8000, // 8秒
    direct: 10000 // 10秒
  }
};

// 限流配置
export const RATE_LIMIT_CONFIG = {
  global: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 10
  },
  ip: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 5
  }
};

// 缓存配置
export const CACHE_CONFIG = {
  ttl: 5 * 60 * 1000, // 5分钟
  maxSize: 100
};

// 功能开关
export const FEATURES = {
  enableCache: true,
  enableRateLimit: true,
  enableFallback: true
};
