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
import { request as undiciRequest } from 'undici';
import { createPinnedAgent } from '../utils/pinned-agent.js';
import {
  readUndiciBodyWithLimit,
  readWebBodyWithLimit,
  type UndiciBodyLike,
} from '../utils/body-reader.js';
import { SECURITY_CONFIG } from '../config.js';
import { validateUrl } from '../security.js';
import { isIP as netIsIP } from 'node:net';

/**
 * 降级 fetch 响应体最大字节数
 *
 * 保护降级路径不被恶意/异常目标网站的大响应体触发 OOM。
 * 与 request-handler.ts 共享 SECURITY_CONFIG.maxResponseSize，保持一致。
 * 向后兼容：未配置时回退到 10 * 1024 * 1024 (10MB)。
 */
const MAX_FETCH_RESPONSE_SIZE =
  SECURITY_CONFIG.maxResponseSize ?? 10 * 1024 * 1024;

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

    // SSRF 防护：URL 静态验证（在 URL 进入浏览器导航/fetch 之前）
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      logger.warn(`URL validation failed: ${urlValidation.error}`, {
        module: 'CaptureService',
        url,
      });
      return {
        success: false,
        error: `URL validation failed: ${urlValidation.error}`,
        url,
        mode,
        duration: Date.now() - startTime,
      };
    }

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

      // 降级路径：仅 HTML 模式可降级为 fetch（无 JS 渲染）
      // full 模式需要资源内联，无法降级
      if (mode === 'html') {
        logger.warn(`Browser unavailable, falling back to fetch: ${url}`, {
          module: 'CaptureService',
          originalError: errorMessage,
        });

        return await this.captureWithFetch(url, mergedOptions, errorMessage, startTime);
      }

      return {
        success: false,
        error: errorMessage,
        url,
        mode,
        duration,
      };
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Fetch 降级捕获 - 无浏览器时直接 fetch HTML
   * 仅返回静态 HTML，不渲染 JS、不处理动态内容
   *
   * SSRF TOCTOU 防护：当 options.resolvedIp 提供时，使用 pinned DNS
   * 将域名固定到已验证的 IP，防止第二次 DNS 解析返回内网地址。
   *
   * 错误处理策略：浏览器失败 + fetch 失败 → 合并错误信息，便于排查
   *
   * @param browserError 原始浏览器错误（用于合并错误信息）
   * @param startTime 整体开始时间
   */
  private async captureWithFetch(
    url: string,
    options: Required<CaptureOptions>,
    browserError: string,
    startTime: number,
  ): Promise<CaptureResult> {
    try {
      // SSRF TOCTOU 防护：仅当 resolvedIp 是有效 IP 地址时才使用 pinned DNS
      const isValidIp = typeof netIsIP === 'function' && netIsIP(options.resolvedIp) !== 0;
      if (options.resolvedIp && isValidIp) {
        return await this.captureWithFetchPinned(url, options, browserError, startTime);
      }

      // resolvedIp 无效或未提供时，走标准 fetch 路径（向后兼容）
      if (options.resolvedIp && !isValidIp) {
        logger.warn(`resolvedIp 值无效（${options.resolvedIp}），回退到标准 fetch 路径`, {
          module: 'CaptureService',
          url,
        });
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        const duration = Date.now() - startTime;
        const fetchError = `Fetch fallback failed: HTTP ${response.status}`;
        logger.warn(fetchError, { module: 'CaptureService', url });

        return {
          success: false,
          error: `Browser: ${browserError}; Fetch: HTTP ${response.status}`,
          url,
          mode: 'html',
          duration,
        };
      }

      const html = await readWebBodyWithLimit(response.body, MAX_FETCH_RESPONSE_SIZE);
      const title = this.extractTitleFromHtml(html);
      const finalUrl = response.url || url;
      const duration = Date.now() - startTime;

      logger.info(`Fetch fallback completed: ${url}`, {
        module: 'CaptureService',
        duration,
        htmlLength: html.length,
      });

      return {
        success: true,
        html,
        title,
        url: finalUrl,
        mode: 'html',
        degraded: true,
        capturedAt: new Date().toISOString(),
        duration,
      };
    } catch (fetchError) {
      const duration = Date.now() - startTime;
      const fetchErrorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);

      logger.error(`Fetch fallback failed: ${url}`, fetchError instanceof Error ? fetchError : undefined, {
        module: 'CaptureService',
      });

      return {
        success: false,
        error: `Browser: ${browserError}; Fetch: ${fetchErrorMessage}`,
        url,
        mode: 'html',
        duration,
      };
    }
  }

  /**
   * 使用 pinned DNS 的 fetch 降级捕获（SSRF TOCTOU 防护）
   *
   * 当上层已通过 validateDnsResolution 验证 IP 为公网地址时，
   * 使用此路径将 DNS 固定到已验证的 IP，防止 DNS 重绑定攻击。
   */
  private async captureWithFetchPinned(
    url: string,
    options: Required<CaptureOptions>,
    browserError: string,
    startTime: number,
  ): Promise<CaptureResult> {
    logger.debug(`使用 pinned DNS fetch 降级: ${options.resolvedIp}`, {
      module: 'CaptureService',
      url,
    });

    // 创建一次性 pinned Agent（降级路径，不池化）
    // 使用统一的 pinned DNS Agent 工厂创建（SSRF TOCTOU 防护）
    const agent = createPinnedAgent(options.resolvedIp);

    try {
      const response = await undiciRequest(url, {
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        dispatcher: agent,
        maxRedirections: 5,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const duration = Date.now() - startTime;
        const fetchError = `Fetch fallback failed: HTTP ${response.statusCode}`;
        logger.warn(fetchError, { module: 'CaptureService', url });

        return {
          success: false,
          error: `Browser: ${browserError}; Fetch: HTTP ${response.statusCode}`,
          url,
          mode: 'html',
          duration,
        };
      }

      const html = await readUndiciBodyWithLimit(
        response.body as unknown as UndiciBodyLike | null,
        MAX_FETCH_RESPONSE_SIZE,
      );
      const title = this.extractTitleFromHtml(html);
      const duration = Date.now() - startTime;

      logger.info(`Pinned fetch fallback completed: ${url}`, {
        module: 'CaptureService',
        duration,
        htmlLength: html.length,
      });

      return {
        success: true,
        html,
        title,
        url,
        mode: 'html',
        degraded: true,
        capturedAt: new Date().toISOString(),
        duration,
      };
    } catch (fetchError) {
      const duration = Date.now() - startTime;
      const fetchErrorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);

      logger.error(`Pinned fetch fallback failed: ${url}`, fetchError instanceof Error ? fetchError : undefined, {
        module: 'CaptureService',
      });

      return {
        success: false,
        error: `Browser: ${browserError}; Fetch: ${fetchErrorMessage}`,
        url,
        mode: 'html',
        duration,
      };
    } finally {
      try {
        // Agent.close() 返回 Promise，必须 await 避免未处理 rejection
        // （规则12：失败显性化）
        await agent.close();
      } catch (err) {
        logger.debug(
          `关闭 pinned Agent 时出错: ${err instanceof Error ? err.message : String(err)}`,
          { module: 'CaptureService' },
        );
      }
    }
  }

  /**
   * 从 HTML 中提取 <title> 标签内容（fetch 降级用）
   */
  private extractTitleFromHtml(html: string): string {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match?.[1]?.trim() ?? '';
  }

  /**
   * 配置页面（业务层）
   * 职责：设置 viewport / timeout / UA（per-capture 配置）
   * BrowserPool.configurePage 已注入 stealth 脚本（基础设施层），此处不重复
   */
  private async configurePage(page: Page, options: Required<CaptureOptions>): Promise<void> {
    await page.setViewport(options.viewport);
    page.setDefaultTimeout(options.timeout);
    page.setDefaultNavigationTimeout(options.timeout);
    // 应用 per-capture 的随机/自定义 UA（覆盖默认 UA 兜底）
    await page.setUserAgent(options.userAgent);
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
