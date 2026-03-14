/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 入口
 * 
 * 提供完整的网页捕获功能，支持两种模式：
 * - html 模式：快速获取渲染后的 HTML 结构
 * - full 模式：获取完整网页，所有资源内联为 Data URI
 * 
 * @example
 * ```typescript
 * import { captureWebpage, getCaptureService } from './webpage-capture';
 * 
 * // 快速获取纯 HTML（默认）
 * const result = await captureWebpage('https://example.com', { mode: 'html' });
 * 
 * // 获取完整网页（含资源内联）
 * const fullResult = await captureWebpage('https://example.com', { 
 *   mode: 'full',
 *   scrollToEnd: true,
 *   removeScripts: true
 * });
 * ```
 */

export {
  type CaptureOptions,
  type CaptureResult,
  type CaptureMode,
  type CaptureRequest,
  type CaptureResponse,
  type ResourceStats,
  type ResourceInfo,
  type ArticleResult,
} from './types.js';

export {
  CaptureService,
  getCaptureService,
  captureWebpage,
} from './capture-service.js';

export {
  BrowserPool,
  getBrowserPool,
} from './browser-pool.js';

export {
  ResourceProcessor,
  createResourceProcessor,
} from './resource-processor.js';

export {
  extractArticle,
  extractArticleFromUrl,
  stripHtmlTags,
} from './article-extractor.js';

export {
  CAPTURE_CONFIG,
  BROWSER_CONFIG,
  PAGE_CONFIG,
  RESOURCE_CONFIG,
  POOL_CONFIG,
  DEFAULT_CAPTURE_OPTIONS,
  mergeCaptureOptions,
  SCROLL_CONFIG,
} from './config.js';
