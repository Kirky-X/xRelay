/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - HTML 通用工具
 *
 * 提供 HTML 文本提取等基础能力，供 capture-service、document-contractor 等复用。
 */

/**
 * 从 HTML 中提取 <title> 标签内容
 *
 * @param html HTML 内容
 * @returns 标题文本（去除首尾空白），未找到返回空字符串
 */
export function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? (match[1]?.trim() ?? '') : '';
}
