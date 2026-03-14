/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 代理存储策略实现
 */

import type { IProxyStorageStrategy, PoolStatus } from "./proxy-strategy.js";
import type { ProxyInfo } from "../types/index.js";
import { logger } from "../logger.js";
import {
  getWeightedProxies,
  incrementFailureCount,
  incrementSuccessCount,
  deleteProxy,
  getProxyCount,
} from "../database/available-proxies-dao.js";
import { insertDeprecatedProxy } from "../database/deprecated-proxies-dao.js";
import { DATABASE_CONFIG } from "../config.js";

/**
 * 数据库存储策略
 * 使用 PostgreSQL 存储和管理代理
 */
export class DatabaseStrategy implements IProxyStorageStrategy {
  readonly name = "database";

  async initialize(): Promise<void> {
    logger.info("初始化数据库代理策略", { module: 'DatabaseStrategy' });
  }

  async getProxy(): Promise<ProxyInfo | null> {
    try {
      const proxies = await getWeightedProxies(1);
      return proxies.length > 0 ? this.toProxyInfo(proxies[0]) : null;
    } catch (error) {
      logger.error(
        `获取代理失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'DatabaseStrategy' }
      );
      return null;
    }
  }

  async getProxies(count: number): Promise<ProxyInfo[]> {
    try {
      const proxies = await getWeightedProxies(count);
      return proxies.map(this.toProxyInfo);
    } catch (error) {
      logger.error(
        `获取多个代理失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'DatabaseStrategy' }
      );
      return [];
    }
  }

  async reportFailed(proxy: ProxyInfo): Promise<void> {
    try {
      const updated = await incrementFailureCount(proxy.ip, parseInt(String(proxy.port), 10));

      if (!updated) {
        logger.debug(`代理不存在: ${proxy.ip}:***`, { module: 'DatabaseStrategy' });
        return;
      }

      if (updated.failure_count >= DATABASE_CONFIG.failureThreshold) {
        logger.info(`代理失败次数超过阈值，移入废弃表: ${proxy.ip}:***`, { module: 'DatabaseStrategy' });

        await insertDeprecatedProxy({
          ip: updated.ip,
          port: updated.port,
          source: updated.source,
          protocol: "http",
          failure_count: updated.failure_count,
          created_at: updated.created_at,
        });

        await deleteProxy(updated.ip, updated.port);
      }
    } catch (error) {
      logger.error(
        `报告代理失败失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'DatabaseStrategy' }
      );
    }
  }

  async reportSuccess(proxy: ProxyInfo): Promise<void> {
    try {
      await incrementSuccessCount(proxy.ip, parseInt(String(proxy.port), 10));
    } catch (error) {
      logger.error(
        `报告代理成功失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { module: 'DatabaseStrategy' }
      );
    }
  }

  async getStatus(): Promise<PoolStatus> {
    try {
      const count = await getProxyCount();
      return {
        available: count,
        total: count,
        lastRefreshTime: Date.now(),
        refreshCount: 0,
        isDatabaseMode: true,
      };
    } catch {
      return {
        available: 0,
        total: 0,
        lastRefreshTime: 0,
        refreshCount: 0,
        isDatabaseMode: true,
      };
    }
  }

  async refresh(): Promise<void> {
    // 数据库模式下刷新由数据库层处理
    logger.debug("数据库模式下的刷新请求", { module: 'DatabaseStrategy' });
  }

  private toProxyInfo(row: { ip: string; port: number; source: string }): ProxyInfo {
    return {
      ip: row.ip,
      port: String(row.port),
      source: row.source,
      timestamp: Date.now(),
    };
  }
}

/**
 * 内存存储策略
 * 使用内存数组存储代理
 */
export class MemoryStrategy implements IProxyStorageStrategy {
  readonly name = "memory";
  private proxies: ProxyInfo[] = [];
  private lastRefreshTime = 0;
  private refreshCount = 0;

  async initialize(): Promise<void> {
    logger.info("初始化内存代理策略", { module: 'MemoryStrategy' });
  }

  async getProxy(): Promise<ProxyInfo | null> {
    if (this.proxies.length === 0) {
      return null;
    }
    // 随机选择一个代理
    const index = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[index];
  }

  async getProxies(count: number): Promise<ProxyInfo[]> {
    if (this.proxies.length === 0) {
      return [];
    }
    // 随机选择多个代理
    const shuffled = [...this.proxies].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  async reportFailed(proxy: ProxyInfo): Promise<void> {
    // 从内存池中移除
    this.proxies = this.proxies.filter(
      (p) => !(p.ip === proxy.ip && p.port === proxy.port)
    );
    logger.debug(`代理失效，已从池中移除: ${proxy.ip}:***`, { module: 'MemoryStrategy' });
  }

  async reportSuccess(_proxy: ProxyInfo): Promise<void> {
    // 内存模式下不需要特殊处理
  }

  async getStatus(): Promise<PoolStatus> {
    return {
      available: this.proxies.length,
      total: this.proxies.length,
      lastRefreshTime: this.lastRefreshTime,
      refreshCount: this.refreshCount,
      isDatabaseMode: false,
    };
  }

  async refresh(): Promise<void> {
    this.lastRefreshTime = Date.now();
    this.refreshCount++;
    logger.debug(`内存代理池刷新 #${this.refreshCount}`, { module: 'MemoryStrategy' });
  }

  /**
   * 设置代理列表
   */
  setProxies(proxies: ProxyInfo[]): void {
    this.proxies = proxies;
  }

  /**
   * 添加代理
   */
  addProxy(proxy: ProxyInfo): void {
    if (!this.proxies.some((p) => p.ip === proxy.ip && p.port === proxy.port)) {
      this.proxies.push(proxy);
    }
  }
}
