/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 代理存储策略接口
 * 定义代理管理的统一接口
 */

import type { ProxyInfo } from "../types/index.js";

/**
 * 代理池状态
 */
export interface PoolStatus {
  available: number;
  total: number;
  lastRefreshTime: number;
  refreshCount: number;
  isDatabaseMode: boolean;
}

/**
 * 代理统计信息
 */
export interface ProxyStats {
  totalProxies: number;
  availableProxies: number;
  circuitBreakerOpen: number;
  circuitBreakerClosed: number;
  blacklisted: number;
}

/**
 * 代理存储策略接口
 */
export interface IProxyStorageStrategy {
  /**
   * 获取一个可用代理
   */
  getProxy(): Promise<ProxyInfo | null>;

  /**
   * 获取多个可用代理
   */
  getProxies(count: number): Promise<ProxyInfo[]>;

  /**
   * 报告代理失败
   */
  reportFailed(proxy: ProxyInfo): Promise<void>;

  /**
   * 报告代理成功
   */
  reportSuccess(proxy: ProxyInfo): Promise<void>;

  /**
   * 获取池状态
   */
  getStatus(): Promise<PoolStatus>;

  /**
   * 刷新代理池
   */
  refresh(): Promise<void>;

  /**
   * 初始化
   */
  initialize(): Promise<void>;

  /**
   * 策略名称
   */
  readonly name: string;
}
