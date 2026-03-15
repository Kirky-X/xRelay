/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 文章解析器
 * 
 * 使用 @extractus/article-extractor 从网页中提取文章内容
 * 通过请求参数 extractArticle 控制是否启用
 */

import { extractFromHtml } from '@extractus/article-extractor';
import type { ArticleResult } from './types.js';
import { logger } from '../logger.js';

/**
 * 清理 HTML 标签，转换为纯文本
 * 保留段落结构，添加换行符
 * 
 * @param html HTML 内容
 * @returns 纯文本内容
 */
export function stripHtmlTags(html: string): string {
  if (!html) return '';

  let text = html;

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<h[1-6][^>]*>/gi, '');

  text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi, '$2');
  text = text.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '[$1]');
  text = text.replace(/<strong[^>]*>([^<]*)<\/strong>/gi, '$1');
  text = text.replace(/<b[^>]*>([^<]*)<\/b>/gi, '$1');
  text = text.replace(/<em[^>]*>([^<]*)<\/em>/gi, '$1');
  text = text.replace(/<i[^>]*>([^<]*)<\/i>/gi, '$1');

  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  text = text.replace(/<[^>]+>/g, '');

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'");

  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * 从 HTML 内容中提取文章信息
 * 
 * @param html HTML 内容
 * @param url 原始 URL（用于解析相对链接）
 * @returns 文章解析结果
 */
export async function extractArticle(
  html: string,
  url: string
): Promise<ArticleResult> {
  const startTime = Date.now();

  try {
    logger.info(`Extracting article from: ${url}`, { module: 'ArticleExtractor' });

    const result = await extractFromHtml(html, url);

    if (!result) {
      logger.warn(`No article content extracted from: ${url}`, { module: 'ArticleExtractor' });
      return {
        success: false,
        error: 'No article content found',
        url,
      };
    }

    const rawContent = result.content || '';
    const rawTextContent = (result as any).textContent || '';

    const cleanTextContent = rawTextContent
      ? stripHtmlTags(rawTextContent)
      : stripHtmlTags(rawContent);

    const duration = Date.now() - startTime;
    logger.info(`Article extracted successfully`, {
      module: 'ArticleExtractor',
      url,
      title: result.title,
      duration,
      contentLength: cleanTextContent.length,
    });

    return {
      success: true,
      title: result.title || undefined,
      description: result.description || undefined,
      content: rawContent || undefined,
      textContent: cleanTextContent || undefined,
      author: result.author || undefined,
      publishedTime: result.published || undefined,
      source: result.source || undefined,
      url: result.url || url,
      image: result.image || undefined,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(`Failed to extract article: ${url}`, error instanceof Error ? error : undefined, {
      module: 'ArticleExtractor',
      duration,
    });

    return {
      success: false,
      error: errorMessage,
      url,
    };
  }
}

/**
 * 从 URL 直接提取文章（不使用浏览器）
 * 
 * @param url 目标 URL
 * @returns 文章解析结果
 */
export async function extractArticleFromUrl(url: string): Promise<ArticleResult> {
  const startTime = Date.now();

  try {
    logger.info(`Extracting article directly from URL: ${url}`, { module: 'ArticleExtractor' });

    const { extract } = await import('@extractus/article-extractor');
    const result = await extract(url);

    if (!result) {
      logger.warn(`No article content extracted from URL: ${url}`, { module: 'ArticleExtractor' });
      return {
        success: false,
        error: 'No article content found',
        url,
      };
    }

    const rawContent = result.content || '';
    const rawTextContent = (result as any).textContent || '';

    const cleanTextContent = rawTextContent
      ? stripHtmlTags(rawTextContent)
      : stripHtmlTags(rawContent);

    const duration = Date.now() - startTime;
    logger.info(`Article extracted from URL successfully`, {
      module: 'ArticleExtractor',
      url,
      title: result.title,
      duration,
      contentLength: cleanTextContent.length,
    });

    return {
      success: true,
      title: result.title || undefined,
      description: result.description || undefined,
      content: rawContent || undefined,
      textContent: cleanTextContent || undefined,
      author: result.author || undefined,
      publishedTime: result.published || undefined,
      source: result.source || undefined,
      url: result.url || url,
      image: result.image || undefined,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(`Failed to extract article from URL: ${url}`, error instanceof Error ? error : undefined, {
      module: 'ArticleExtractor',
      duration,
    });

    return {
      success: false,
      error: errorMessage,
      url,
    };
  }
}
