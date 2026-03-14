/**
 * Proxy Manager - 类型定义
 */

/**
 * 断路器状态
 */
export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

/**
 * 代理池状态（内存模式）
 */
export interface ProxyPoolState {
  availableProxies: ProxyInfo[];
  lastRefreshTime: number;
  refreshCount: number;
}

/**
 * 代理池状态
 */
export interface PoolStatus {
  availableCount: number;
  lastRefreshTime: number;
  refreshCount: number;
  blacklistSize: number;
  mode: "database" | "memory";
}

/**
 * 代理统计信息
 */
export interface ProxyStats {
  totalFetched: number;
  availableInPool: number;
  isFresh: boolean;
  mode: "database" | "memory";
}

/**
 * 代理信息（从 types/index.ts 导入）
 */
import type { ProxyInfo } from "../../types/index.js";
export type { ProxyInfo };
