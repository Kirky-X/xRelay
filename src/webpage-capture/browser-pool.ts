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
 *
 * 部署兼容：
 * - Vercel 环境：使用 @sparticuz/chromium 作为 Chromium 二进制源（serverless 优化）
 * - 本地/容器环境：使用 puppeteer 自带 Chromium 或 CHROME_PATH 环境变量
 */

import puppeteer, { Browser, Page, LaunchOptions } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { BROWSER_CONFIG, PAGE_CONFIG, POOL_CONFIG } from './config.js';
import { getStealthScriptCode } from './stealth-scripts.js';
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
 * 检测是否为 Vercel 无服务器环境
 */
export function isVercelEnvironment(): boolean {
  return process.env.VERCEL === '1';
}

/**
 * 解析浏览器启动参数（跨环境兼容）
 *
 * - Vercel：使用 @sparticuz/chromium 提供的 executablePath 与 args
 * - 本地：优先使用 CHROME_PATH，其次使用 puppeteer 默认（自带 Chromium）
 *
 * 安全考虑：
 * - Vercel 环境强制使用 @sparticuz/chromium，CHROME_PATH 被忽略（防止误用容器内 Chrome）
 * - 容器环境（Docker）自动启用 --no-sandbox
 */
export async function resolveLaunchOptions(): Promise<LaunchOptions> {
  const args = BROWSER_CONFIG.args;
  const isVercel = isVercelEnvironment();

  if (isVercel) {
    // Vercel：@sparticuz/chromium 提供 serverless 优化的 Chromium
    const executablePath = await chromium.executablePath();
    logger.info('Using @sparticuz/chromium for Vercel environment', {
      module: 'BrowserPool',
      executablePath,
    });

    return {
      headless: BROWSER_CONFIG.headless,
      args: [...chromium.args, ...args],
      executablePath,
    };
  }

  // 本地环境：优先 CHROME_PATH（运行时读取，便于测试与动态配置）
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    return {
      headless: BROWSER_CONFIG.headless,
      args,
      executablePath: chromePath,
    };
  }

  // 兜底：puppeteer 默认（开发依赖中 puppeteer 提供 Chromium 路径）
  // 使用 dynamic import 避免在生产环境加载完整 puppeteer 包
  try {
    const puppeteerFull = (await import('puppeteer')).default;
    return {
      headless: BROWSER_CONFIG.headless,
      args,
      executablePath: await puppeteerFull.executablePath(),
    };
  } catch (error) {
    throw new Error(
      'Unable to resolve Chromium executable path. ' +
      'Set CHROME_PATH env var or install puppeteer as devDependency. ' +
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

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
   * 配置页面（基础设施层）
   * 职责：仅设置 viewport 和注入 stealth 脚本
   * 注意：UA / timeout 由 CaptureService.configurePage 显式设置（per-capture 配置）
   * stealth 脚本是反检测的核心，必须在所有页面创建时注入
   */
  private async configurePage(page: Page): Promise<void> {
    await page.setViewport(PAGE_CONFIG.defaultViewport);

    // 合并注入全部 stealth 脚本为单次 CDP 调用（减少 serverless 30-120ms 延迟）
    const stealthCode = getStealthScriptCode();
    await page.evaluateOnNewDocument(stealthCode);
    logger.debug('已注入 stealth 脚本', { module: 'BrowserPool' });
  }

  /**
   * 创建新的浏览器实例
   */
  private async createInstance(): Promise<BrowserInstance> {
    const launchOptions = await resolveLaunchOptions();

    logger.info('Creating new browser instance', {
      module: 'BrowserPool',
      environment: isVercelEnvironment() ? 'vercel' : 'local',
    });

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
