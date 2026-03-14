/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 浏览器实例池管理
 * 
 * 功能：
 * - 单例模式管理浏览器实例
 * - 支持并发请求的页面复用
 * - 自动清理空闲页面
 * - 错误处理和重连机制
 */

import puppeteer, { Browser, Page, LaunchOptions } from 'puppeteer';
import { BROWSER_CONFIG, PAGE_CONFIG, POOL_CONFIG } from './config.js';
import { logger } from '../logger.js';

/**
 * 浏览器实例信息
 */
interface BrowserInstance {
  id: number;
  browser: Browser;
  pageCount: number;
  lastUsed: number;
}

/**
 * 等待队列项
 */
interface WaitQueueItem {
  resolve: (instance: BrowserInstance) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let instanceIdCounter = 0;

/**
 * 浏览器池管理器
 * 单例模式，管理多个浏览器实例
 */
export class BrowserPool {
  private static instance: BrowserPool | null = null;
  private instances: BrowserInstance[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private waitQueue: WaitQueueItem[] = [];
  private createPromise: Promise<BrowserInstance> | null = null;
  private static readonly ACQUIRE_TIMEOUT = 30000;

  private constructor() {
    this.startCleanupTimer();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  /**
   * 获取一个可用的页面
   */
  public async getPage(): Promise<{ page: Page; release: () => Promise<void> }> {
    if (this.isShuttingDown) {
      throw new Error('BrowserPool is shutting down');
    }

    let instance = this.findAvailableInstance();

    if (!instance) {
      if (this.instances.length >= POOL_CONFIG.maxInstances) {
        instance = await this.waitForAvailableInstance();
      } else {
        instance = await this.getOrCreateInstance();
      }
    }

    const page = await instance.browser.newPage();
    instance.pageCount++;
    instance.lastUsed = Date.now();
    const instanceId = instance.id;

    await this.configurePage(page);

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;

      try {
        await page.close();
      } catch {
        logger.debug('Failed to close page', { module: 'BrowserPool' });
      }

      const inst = this.instances.find((i) => i.id === instanceId);
      if (inst) {
        inst.pageCount--;
        inst.lastUsed = Date.now();
        this.notifyWaiters();
      }
    };

    return { page, release };
  }

  /**
   * 查找可用实例
   */
  private findAvailableInstance(): BrowserInstance | undefined {
    return this.instances.find(
      (inst) => inst.pageCount < POOL_CONFIG.maxPagesPerInstance
    );
  }

  /**
   * 获取或创建实例（带创建锁防止竞态）
   */
  private async getOrCreateInstance(): Promise<BrowserInstance> {
    if (this.createPromise) {
      return this.createPromise;
    }

    this.createPromise = this.createInstance();
    try {
      return await this.createPromise;
    } finally {
      this.createPromise = null;
    }
  }

  /**
   * 通知等待队列
   */
  private notifyWaiters(): void {
    while (this.waitQueue.length > 0) {
      const instance = this.findAvailableInstance();
      if (!instance) break;

      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timeoutId);
      waiter.resolve(instance);
    }
  }

  /**
   * 配置页面
   */
  private async configurePage(page: Page): Promise<void> {
    await page.setViewport(PAGE_CONFIG.defaultViewport);
    page.setDefaultTimeout(PAGE_CONFIG.defaultTimeout);
    page.setDefaultNavigationTimeout(PAGE_CONFIG.defaultTimeout);
    await page.setUserAgent(PAGE_CONFIG.defaultUserAgent);

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      request.continue();
    });
  }

  /**
   * 创建新的浏览器实例
   */
  private async createInstance(): Promise<BrowserInstance> {
    const launchOptions: LaunchOptions = {
      headless: BROWSER_CONFIG.headless,
      args: BROWSER_CONFIG.args,
    };

    if (BROWSER_CONFIG.executablePath) {
      launchOptions.executablePath = BROWSER_CONFIG.executablePath;
    }

    logger.info('Creating new browser instance', { module: 'BrowserPool' });

    const browser = await puppeteer.launch(launchOptions);

    const instance: BrowserInstance = {
      id: ++instanceIdCounter,
      browser,
      pageCount: 0,
      lastUsed: Date.now(),
    };

    this.instances.push(instance);

    browser.on('disconnected', () => {
      logger.warn('Browser instance disconnected', { module: 'BrowserPool' });
      this.removeInstance(instance);
    });

    return instance;
  }

  /**
   * 等待有可用实例（使用队列替代忙等待）
   */
  private async waitForAvailableInstance(): Promise<BrowserInstance> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error('Timeout waiting for available browser instance'));
      }, BrowserPool.ACQUIRE_TIMEOUT);

      this.waitQueue.push({ resolve, reject, timeoutId });
    });
  }

  /**
   * 移除实例
   */
  private removeInstance(instance: BrowserInstance): void {
    const index = this.instances.indexOf(instance);
    if (index > -1) {
      this.instances.splice(index, 1);
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleInstances();
    }, POOL_CONFIG.idleTimeout / 2);
  }

  /**
   * 清理空闲实例
   */
  private async cleanupIdleInstances(): Promise<void> {
    const now = Date.now();

    for (const instance of [...this.instances]) {
      if (
        instance.pageCount === 0 &&
        now - instance.lastUsed > POOL_CONFIG.idleTimeout
      ) {
        logger.info('Cleaning up idle browser instance', { module: 'BrowserPool' });
        try {
          await instance.browser.close();
        } catch {
          logger.debug('Failed to close idle browser', { module: 'BrowserPool' });
        }
        this.removeInstance(instance);
      }
    }
  }

  /**
   * 关闭所有实例
   */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = this.instances.map(async (instance) => {
      try {
        await instance.browser.close();
      } catch {
        logger.debug('Failed to close browser during shutdown', { module: 'BrowserPool' });
      }
    });

    await Promise.all(closePromises);
    this.instances = [];

    logger.info('Browser pool shutdown complete', { module: 'BrowserPool' });
  }

  /**
   * 获取池状态
   */
  public getStats(): {
    instanceCount: number;
    totalPages: number;
    instances: Array<{ pageCount: number; lastUsed: number }>;
  } {
    return {
      instanceCount: this.instances.length,
      totalPages: this.instances.reduce((sum, inst) => sum + inst.pageCount, 0),
      instances: this.instances.map((inst) => ({
        pageCount: inst.pageCount,
        lastUsed: inst.lastUsed,
      })),
    };
  }
}

/**
 * 导出便捷函数
 */
export function getBrowserPool(): BrowserPool {
  return BrowserPool.getInstance();
}
