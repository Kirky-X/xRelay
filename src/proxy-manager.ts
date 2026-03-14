/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Manager - 代理池管理（向后兼容层）
 * 此文件重新导出新的模块化实现，保持向后兼容性
 */

export {
  initProxyManager,
  getAvailableProxy,
  getMultipleProxies,
  reportProxyFailed,
  reportProxySuccess,
  getPoolStatus,
  manualRefresh,
  getProxyStats,
  getCircuitBreakerStatus,
  isUsingDatabase,
} from './core/proxy/index.js';
