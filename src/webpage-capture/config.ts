/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 配置
 */

import type {
  BrowserConfig,
  PageConfig,
  ResourceConfig,
  BrowserPoolConfig,
  CaptureOptions,
} from './types.js';

/**
 * 检测是否在容器环境中运行
 * 容器环境通常需要禁用沙箱
 */
function isContainerEnvironment(): boolean {
  // 检查环境变量
  if (process.env.CONTAINER_ENV === 'true' || process.env.DOCKER_ENV === 'true') {
    return true;
  }

  // 检查是否在 Vercel 环境中
  if (process.env.VERCEL === '1') {
    return true;
  }

  // 检查 /.dockerenv 文件存在性（同步检查，仅在 Node.js 环境可用）
  try {
    require('fs').existsSync('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取浏览器启动参数
 * 根据环境动态配置安全参数
 */
function getBrowserArgs(): string[] {
  const isInContainer = isContainerEnvironment();

  const args: string[] = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-dev-tools',
    '--no-zygote',
    '--single-process',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-translate',
    '--disable-sync',
    '--metrics-recording-only',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];

  // 仅在容器环境中禁用沙箱
  // 警告：禁用沙箱会降低安全性，仅在必要时使用
  if (isInContainer) {
    args.unshift('--no-sandbox', '--disable-setuid-sandbox');
  }

  return args;
}

/**
 * 浏览器配置
 */
export const BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  args: getBrowserArgs(),
  executablePath: process.env.CHROME_PATH || undefined,
};

/**
 * 页面配置
 */
export const PAGE_CONFIG: PageConfig = {
  defaultViewport: { width: 1920, height: 1080 },
  defaultUserAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  defaultTimeout: 30000,
};

/**
 * 资源处理配置
 */
export const RESOURCE_CONFIG: ResourceConfig = {
  maxImageSize: 5 * 1024 * 1024,
  maxTotalSize: 50 * 1024 * 1024,
  imageQuality: 80,
  fetchTimeout: 10000,
  maxRetries: 3,
  concurrency: 10,
};

/**
 * 浏览器池配置
 */
export const POOL_CONFIG: BrowserPoolConfig = {
  maxInstances: 3,
  maxPagesPerInstance: 10,
  idleTimeout: 60000,
};

/**
 * 默认捕获选项
 */
export const DEFAULT_CAPTURE_OPTIONS: Omit<Required<CaptureOptions>, 'maxImageSize' | 'compressImages'> & { maxImageSize: number } = {
  mode: 'html',
  extractArticle: false,
  waitTime: 0,
  waitForSelector: '',
  scrollToEnd: false,
  removeScripts: false,
  removeComments: false,
  maxImageSize: RESOURCE_CONFIG.maxImageSize,
  timeout: 30000,
  userAgent: PAGE_CONFIG.defaultUserAgent,
  viewport: PAGE_CONFIG.defaultViewport,
  preserveLinks: false,
  processIframes: false,
};

/**
 * 合并捕获选项
 */
export function mergeCaptureOptions(
  options?: CaptureOptions
): Required<CaptureOptions> {
  if (!options) {
    return { ...DEFAULT_CAPTURE_OPTIONS };
  }

  return {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...options,
    viewport: {
      ...DEFAULT_CAPTURE_OPTIONS.viewport,
      ...options.viewport,
    },
  };
}

/**
 * 滚动配置
 */
export const SCROLL_CONFIG = {
  /** 每次滚动的距离 */
  scrollStep: 500,
  /** 滚动间隔（毫秒） */
  scrollDelay: 100,
  /** 最大滚动次数 */
  maxScrolls: 100,
  /** 滚动到底部后的额外等待时间 */
  afterScrollWait: 1000,
};

/**
 * 完整的捕获配置（聚合导出）
 */
export const CAPTURE_CONFIG = {
  browser: BROWSER_CONFIG,
  page: PAGE_CONFIG,
  resources: RESOURCE_CONFIG,
  pool: POOL_CONFIG,
  defaults: DEFAULT_CAPTURE_OPTIONS,
  scroll: SCROLL_CONFIG,
};
