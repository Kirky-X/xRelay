/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 类型定义
 */

/**
 * 捕获模式
 * - 'html': 仅获取渲染后的 HTML，不处理外部资源（快速）
 * - 'full': 获取完整网页，所有资源内联为 Data URI（较慢）
 */
export type CaptureMode = 'html' | 'full';

/**
 * 文章解析结果
 */
export interface ArticleResult {
  /** 是否成功 */
  success: boolean;

  /** 文章标题 */
  title?: string;

  /** 文章描述 */
  description?: string;

  /** 文章内容（HTML） */
  content?: string;

  /** 纯文本内容 */
  textContent?: string;

  /** 作者 */
  author?: string;

  /** 发布时间 */
  publishedTime?: string;

  /** 来源域名 */
  source?: string;

  /** 文章 URL */
  url?: string;

  /** 封面图片 */
  image?: string;

  /** 错误信息 */
  error?: string;
}

/**
 * 捕获选项
 */
export interface CaptureOptions {
  /** 捕获模式: 'html' 仅获取HTML, 'full' 获取完整网页(含资源内联) */
  mode?: CaptureMode;

  /** 是否启用文章解析（使用 article-extractor） */
  extractArticle?: boolean;

  /** 额外等待时间（毫秒），用于动态内容加载 */
  waitTime?: number;

  /** 等待特定选择器出现 */
  waitForSelector?: string;

  /** 是否滚动到底部触发懒加载 */
  scrollToEnd?: boolean;

  /** 是否移除脚本标签（仅 full 模式有效） */
  removeScripts?: boolean;

  /** 是否移除 HTML 注释 */
  removeComments?: boolean;

  /** 最大图片大小（字节），超过则跳过内联 */
  maxImageSize?: number;

  /** 总超时时间（毫秒） */
  timeout?: number;

  /** 自定义 User-Agent */
  userAgent?: string;

  /** 视口配置 */
  viewport?: {
    width: number;
    height: number;
  };

  /** 是否保留链接的原始 href（仅 full 模式有效） */
  preserveLinks?: boolean;

  /** 是否处理 iframe 内容（仅 full 模式有效） */
  processIframes?: boolean;
}

/**
 * 捕获结果
 */
export interface CaptureResult {
  /** 是否成功 */
  success: boolean;

  /** HTML 内容 */
  html?: string;

  /** 页面标题 */
  title?: string;

  /** 最终 URL（处理重定向后） */
  url?: string;

  /** 使用的捕获模式 */
  mode?: CaptureMode;

  /** 资源统计（仅 full 模式） */
  resources?: ResourceStats;

  /** 文章解析结果（仅当 extractArticle=true 时） */
  article?: ArticleResult;

  /** 捕获时间 */
  capturedAt?: string;

  /** 处理耗时（毫秒） */
  duration?: number;

  /** 错误信息 */
  error?: string;
}

/**
 * 资源统计
 */
export interface ResourceStats {
  images: number;
  styles: number;
  scripts: number;
  fonts: number;
  iframes: number;
  others: number;
}

/**
 * 资源信息
 */
export interface ResourceInfo {
  /** 资源类型 */
  type: 'image' | 'style' | 'script' | 'font' | 'iframe' | 'other';

  /** 原始 URL */
  url: string;

  /** 资源内容（Base64 或文本） */
  content?: string;

  /** MIME 类型 */
  mimeType?: string;

  /** 是否成功获取 */
  success: boolean;

  /** 错误信息 */
  error?: string;
}

/**
 * 捕获请求
 */
export interface CaptureRequest {
  /** 目标 URL（必填） */
  url: string;

  /** 捕获选项 */
  options?: CaptureOptions;
}

/**
 * 捕获响应
 */
export interface CaptureResponse {
  /** 是否成功 */
  success: boolean;

  /** 捕获数据 */
  data?: {
    html: string;
    title: string;
    url: string;
    mode: CaptureMode;
    resources?: ResourceStats;
    capturedAt: string;
    duration: number;
  };

  /** 错误信息 */
  error?: string;

  /** 请求 ID */
  requestId: string;
}

/**
 * 浏览器池配置
 */
export interface BrowserPoolConfig {
  /** 最大浏览器实例数 */
  maxInstances: number;

  /** 每个实例最大页面数 */
  maxPagesPerInstance: number;

  /** 空闲超时时间（毫秒） */
  idleTimeout: number;
}

/**
 * 浏览器配置
 */
export interface BrowserConfig {
  /** 是否无头模式 */
  headless: boolean;

  /** 启动参数 */
  args: string[];

  /** 可执行文件路径 */
  executablePath?: string;
}

/**
 * 页面配置
 */
export interface PageConfig {
  /** 默认视口 */
  defaultViewport: {
    width: number;
    height: number;
  };

  /** 默认 User-Agent */
  defaultUserAgent: string;

  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
}

/**
 * 资源处理配置
 */
export interface ResourceConfig {
  /** 最大图片大小（字节） */
  maxImageSize: number;

  /** 最大总大小（字节） */
  maxTotalSize: number;

  /** 图片压缩质量 (1-100) */
  imageQuality: number;

  /** 获取超时时间（毫秒） */
  fetchTimeout: number;

  /** 最大重试次数 */
  maxRetries: number;

  /** 并发获取数量 */
  concurrency: number;
}
