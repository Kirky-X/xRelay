/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 核心捕获服务
 * 
 * 功能：
 * - 接收捕获请求
 * - 协调浏览器池和资源处理器
 * - 支持两种模式：html（纯HTML）和 full（完整网页）
 * - 处理动态内容、懒加载等
 */

import type { Page } from 'puppeteer';
import type { CaptureOptions, CaptureResult, CaptureMode, ArticleResult } from './types.js';
import { mergeCaptureOptions, SCROLL_CONFIG } from './config.js';
import { BrowserPool, getBrowserPool } from './browser-pool.js';
import { createResourceProcessor } from './resource-processor.js';
import { extractArticle } from './article-extractor.js';
import { logger } from '../logger.js';

/**
 * 捕获服务类
 */
export class CaptureService {
  private browserPool: BrowserPool;

  constructor() {
    this.browserPool = getBrowserPool();
  }

  /**
   * 捕获网页
   */
  public async capture(url: string, options?: CaptureOptions): Promise<CaptureResult> {
    const startTime = Date.now();
    const mergedOptions = mergeCaptureOptions(options);
    const mode: CaptureMode = mergedOptions.mode;

    logger.info(`Starting capture: ${url}`, {
      module: 'CaptureService',
      mode,
      url
    });

    let page: Page | null = null;
    let release: (() => Promise<void>) | null = null;

    try {
      const pageInfo = await this.browserPool.getPage();
      page = pageInfo.page;
      release = pageInfo.release;

      await this.configurePage(page, mergedOptions);

      await this.navigateToPage(page, url, mergedOptions);

      await this.waitForPageReady(page, mergedOptions);

      if (mergedOptions.scrollToEnd && mode === 'full') {
        await this.scrollToEnd(page);
      }

      if (mergedOptions.waitTime > 0) {
        await this.sleep(mergedOptions.waitTime);
      }

      let html: string;

      if (mode === 'full') {
        const resourceProcessor = createResourceProcessor(mergedOptions);
        html = await resourceProcessor.processResources(page);
      } else {
        html = await page.content();
      }

      const title = await this.getPageTitle(page);
      const finalUrl = page.url();

      let article: ArticleResult | undefined;
      if (mergedOptions.extractArticle) {
        try {
          logger.info(`Extracting article content`, { module: 'CaptureService', url });
          article = await extractArticle(html, finalUrl);
        } catch (articleError) {
          logger.warn(`Failed to extract article: ${articleError}`, { module: 'CaptureService' });
        }
      }

      const duration = Date.now() - startTime;

      logger.info(`Capture complete: ${url}`, {
        module: 'CaptureService',
        duration,
        mode,
        articleExtracted: !!article,
      });

      return {
        success: true,
        html,
        title,
        url: finalUrl,
        mode,
        article,
        capturedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Capture failed: ${url}`, error instanceof Error ? error : undefined, {
        module: 'CaptureService',
        duration
      });

      return {
        success: false,
        error: errorMessage,
        url,
        mode: options?.mode || 'html',
        duration,
      };
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * 配置页面超时设置
   */
  private async configurePage(page: Page, options: Required<CaptureOptions>): Promise<void> {
    page.setDefaultTimeout(options.timeout);
    page.setDefaultNavigationTimeout(options.timeout);
  }

  /**
   * 导航到页面
   */
  private async navigateToPage(
    page: Page,
    url: string,
    options: Required<CaptureOptions>
  ): Promise<void> {
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: options.timeout,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('net::ERR_')) {
        logger.warn('Network error during navigation, trying without networkidle', {
          module: 'CaptureService',
          url
        });
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeout,
        });
      }
      throw error;
    }
  }

  /**
   * 等待页面就绪
   */
  private async waitForPageReady(
    page: Page,
    options: Required<CaptureOptions>
  ): Promise<void> {
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          timeout: options.timeout,
        });
      } catch {
        logger.warn('Wait for selector timeout', {
          module: 'CaptureService',
          selector: options.waitForSelector
        });
      }
    }

    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
          return;
        }
        window.addEventListener('load', () => resolve());
      });
    });
  }

  /**
   * 滚动到页面底部触发懒加载
   */
  private async scrollToEnd(page: Page): Promise<void> {
    logger.debug('Scrolling to end of page', { module: 'CaptureService' });

    let scrollCount = 0;
    let lastHeight = 0;
    const viewportHeight = SCROLL_CONFIG.scrollStep;

    while (scrollCount < SCROLL_CONFIG.maxScrolls) {
      const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

      if (currentHeight === lastHeight) {
        break;
      }

      await page.evaluate((height) => {
        window.scrollBy(0, height);
      }, viewportHeight);

      await this.sleep(SCROLL_CONFIG.scrollDelay);

      lastHeight = currentHeight;
      scrollCount++;
    }

    await this.sleep(SCROLL_CONFIG.afterScrollWait);

    await page.evaluate(() => window.scrollTo(0, 0));
  }

  /**
   * 获取页面标题
   */
  private async getPageTitle(page: Page): Promise<string> {
    try {
      return await page.title();
    } catch {
      return '';
    }
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 关闭服务
   */
  public async shutdown(): Promise<void> {
    await this.browserPool.shutdown();
  }
}

/**
 * 创建捕获服务
 */
let captureServiceInstance: CaptureService | null = null;

export function getCaptureService(): CaptureService {
  if (!captureServiceInstance) {
    captureServiceInstance = new CaptureService();
  }
  return captureServiceInstance;
}

/**
 * 便捷函数：捕获网页
 */
export async function captureWebpage(
  url: string,
  options?: CaptureOptions
): Promise<CaptureResult> {
  const service = getCaptureService();
  return service.capture(url, options);
}
