/**
 * 断路器模块
 * 管理代理的断路器状态，防止重复使用失败的代理
 */

import { logger } from "../../logger.js";
import type { CircuitBreakerState } from "./types.js";

// 断路器配置
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 60000,
  maxSize: 1000,
  maxAge: 24 * 60 * 60 * 1000,
};

// 断路器状态存储
const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * 清理断路器过期条目
 * 防止内存泄漏
 */
export function cleanupCircuitBreakers(): void {
  const now = Date.now();
  const entries = [...circuitBreakers.entries()];

  for (const [key, state] of entries) {
    if (now - state.lastFailureTime > CIRCUIT_BREAKER_CONFIG.maxAge) {
      circuitBreakers.delete(key);
    }
  }

  if (circuitBreakers.size > CIRCUIT_BREAKER_CONFIG.maxSize) {
    const sorted = entries
      .filter(([key]) => circuitBreakers.has(key))
      .sort((a, b) => a[1].lastFailureTime - b[1].lastFailureTime);
    const toDelete = sorted.slice(0, circuitBreakers.size - CIRCUIT_BREAKER_CONFIG.maxSize);
    for (const [key] of toDelete) {
      circuitBreakers.delete(key);
    }
    logger.debug(`清理了 ${toDelete.length} 个断路器条目`, { module: 'CircuitBreaker' });
  }
}

/**
 * 检查断路器是否打开
 */
export function isCircuitOpen(proxyKey: string): boolean {
  const state = circuitBreakers.get(proxyKey);
  if (!state) return false;

  if (state.isOpen) {
    if (Date.now() - state.lastFailureTime > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      state.isOpen = false;
      logger.info(`断路器进入半开状态: ${proxyKey}`, { module: 'CircuitBreaker' });
      return false;
    }
    return true;
  }
  return false;
}

/**
 * 记录代理失败
 */
export function recordFailure(proxyKey: string): void {
  const state = circuitBreakers.get(proxyKey) || {
    failures: 0,
    lastFailureTime: 0,
    isOpen: false,
  };

  state.failures++;
  state.lastFailureTime = Date.now();

  if (state.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold && !state.isOpen) {
    state.isOpen = true;
    logger.warn(`断路器打开: ${proxyKey} (失败次数: ${state.failures})`, { module: 'CircuitBreaker' });
  }

  circuitBreakers.set(proxyKey, state);
}

/**
 * 记录代理成功
 */
export function recordSuccess(proxyKey: string): void {
  const state = circuitBreakers.get(proxyKey);
  if (state) {
    state.failures = 0;
    state.isOpen = false;
    circuitBreakers.set(proxyKey, state);
    logger.debug(`断路器重置: ${proxyKey}`, { module: 'CircuitBreaker' });
  }
}

/**
 * 获取断路器状态（用于调试和监控）
 */
export function getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
  return new Map(circuitBreakers);
}
