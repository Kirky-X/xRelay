/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 结构化文档转换器
 *
 * 参考 obsidian-clipper 的实现思路，使用 defuddle 作为主提取器，
 * @extractus/article-extractor 作为后备。将网页 HTML 转换为结构化文档，
 * 支持提取标题、正文、图片、链接、标签等关键信息，并输出为 Markdown/JSON/HTML。
 */

import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import TurndownService from 'turndown';
import { extractArticle } from './article-extractor.js';
import { extractTitleFromHtml } from './html-utils.js';
import { logger } from '../logger.js';
import type {
  StructuredDocument,
  StructuredDocumentOptions,
  ImageInfo,
  LinkInfo,
  ContentFormat,
  ExtractorType,
} from './types.js';

/**
 * 中文停用词集合
 * 单字停用词用于过滤 N-gram 首尾；双字及以上的停用词整体过滤
 */
const STOP_WORDS = new Set<string>([
  // 单字常用虚词
  '的', '了', '是', '在', '和', '与', '这', '那', '一', '个',
  '我', '你', '他', '她', '它', '们', '就', '也', '都', '还',
  '又', '再', '已', '才', '只', '刚', '正', '将', '曾', '被',
  '把', '对', '向', '为', '以', '于', '用', '给', '跟', '同',
  '比', '由', '从', '至', '到', '上', '下', '中', '里', '外',
  '前', '后', '左', '右', '内', '不', '无', '有', '之', '其',
  '此', '彼', '若', '如', '或', '且', '则', '故', '即', '便',
  // 双字停用词
  '我们', '你们', '他们', '她们', '它们', '这是', '那是', '一个',
  '一些', '可以', '应该', '需要', '的话', '因为', '所以', '但是',
  '而且', '以及', '并且', '或者', '如果', '虽然', '尽管', '已经',
  '正在', '这个', '那个', '这些', '那些', '什么', '怎么', '为何',
  '如何', '为了', '由于', '于是', '然而', '此外', '另外', '例如',
  '比如', '总之', '其中', '其他', '其它', '某种', '某些',
]);

/**
 * 默认选项
 *
 * 显式标注 Required<StructuredDocumentOptions> 以让 TypeScript 编译期
 * 校验所有字段都已提供，避免未来新增字段时遗漏默认值。
 */
const DEFAULT_OPTIONS: Required<StructuredDocumentOptions> = {
  extractor: 'defuddle',
  format: 'markdown',
  extractImages: true,
  extractLinks: true,
  extractTags: true,
  generateFrontmatter: true,
  maxTags: 5,
  baseUrl: '',
};

/**
 * Turndown 实例（复用，避免重复创建）
 */
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  preformattedCode: true,
});

/**
 * 允许的图片协议白名单
 * 仅允许 HTTP(S) 和内联 data:image/* 图片
 */
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

function isSafeImageUrl(url: URL): boolean {
  if (SAFE_IMAGE_PROTOCOLS.has(url.protocol)) return true;
  // data:image/* 允许（SVG 除外，因 SVG 可内嵌脚本）
  if (url.protocol === 'data:') {
    const raw = url.href;
    return /^data:image\/(?!svg)/i.test(raw);
  }
  return false;
}

/**
 * 允许的链接协议白名单
 * 仅允许 HTTP(S)，其他（javascript:、mailto:、tel:、data:、blob:、file: 等）全部拒绝
 */
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 从 HTML 中提取所有图片信息
 *
 * @param html HTML 内容
 * @param baseUrl 基础 URL（用于解析相对路径）
 * @returns 图片信息数组
 */
export function extractImages(html: string, baseUrl: string): ImageInfo[] {
  return extractImagesAndLinks(html, baseUrl).images;
}

/**
 * 从 HTML 中提取所有链接信息并分类
 *
 * @param html HTML 内容
 * @param baseUrl 基础 URL（用于解析相对路径和判定内/外部链接）
 * @returns 链接信息数组
 */
export function extractLinks(html: string, baseUrl: string): LinkInfo[] {
  return extractImagesAndLinks(html, baseUrl).links;
}

/**
 * 一次性提取图片和链接（复用同一份 DOM，避免重复 parseHTML）
 *
 * 导出此合并函数，让需要同时提取图片和链接的外部调用方也能复用同一份 DOM 解析，
 * 避免分别调用 extractImages + extractLinks 触发两次 parseHTML。
 *
 * @param html HTML 内容
 * @param baseUrl 基础 URL
 * @returns 图片和链接数组
 */
export function extractImagesAndLinks(
  html: string,
  baseUrl: string
): { images: ImageInfo[]; links: LinkInfo[] } {
  const result = { images: [] as ImageInfo[], links: [] as LinkInfo[] };
  if (!html) return result;

  let document: Document;
  try {
    document = parseHTML(html).document;
  } catch (error) {
    // parseHTML 失败时记 warn 便于运维排查（与 defuddle 失败、顶层 catch 的日志策略一致）
    logger.warn('parseHTML failed in extractImagesAndLinks', {
      module: 'DocumentConverter',
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  let baseHost: string | null = null;
  try {
    baseHost = new URL(baseUrl).host;
  } catch {
    // 无效 baseUrl，所有链接归为 internal
  }

  // 提取图片
  const imgs = document.querySelectorAll('img');
  imgs.forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;

    try {
      const absoluteUrl = new URL(src, baseUrl);
      if (!isSafeImageUrl(absoluteUrl)) return;

      const alt = img.getAttribute('alt') || undefined;
      const widthAttr = img.getAttribute('width');
      const heightAttr = img.getAttribute('height');
      const width = widthAttr ? Number.parseInt(widthAttr, 10) : undefined;
      const height = heightAttr ? Number.parseInt(heightAttr, 10) : undefined;

      result.images.push({
        url: absoluteUrl.href,
        alt: alt || undefined,
        width: Number.isFinite(width) ? width : undefined,
        height: Number.isFinite(height) ? height : undefined,
      });
    } catch {
      // 无效 URL 跳过
    }
  });

  // 提取链接
  const anchors = document.querySelectorAll('a[href]');
  anchors.forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;

    try {
      // new URL 会自动去除前导空白，避免协议过滤被绕过
      const absoluteUrl = new URL(href, baseUrl);
      // 协议白名单校验（基于解析后的 protocol 属性，更稳健）
      if (!SAFE_LINK_PROTOCOLS.has(absoluteUrl.protocol)) return;

      const text = (a.textContent || '').trim();

      let type: 'internal' | 'external' = 'internal';
      if (baseHost) {
        type = absoluteUrl.host === baseHost ? 'internal' : 'external';
      }

      result.links.push({ url: absoluteUrl.href, text, type });
    } catch {
      // 无效 URL 跳过
    }
  });

  return result;
}

/**
 * 对 HTML 片段做链接协议 sanitization
 *
 * 用途：article-extractor 后备路径中，对返回的 HTML 进行清理，
 * 移除 a[href]、img[src]、source[src]、iframe[src] 等元素上危险协议的属性值，
 * 避免 turndown 将 javascript:/vbscript:/data:image/svg+xml 等危险 URL
 * 原样保留到 Markdown 链接中。
 *
 * 注意：此函数仅清理属性，不删除元素本身；返回处理后的 HTML 字符串。
 *
 * @param html 原始 HTML 片段
 * @returns 清理后的 HTML 字符串
 */
function sanitizeHtmlLinks(html: string): string {
  if (!html) return '';

  let document: Document;
  try {
    document = parseHTML(html).document;
  } catch (error) {
    logger.warn('parseHTML failed in sanitizeHtmlLinks, returning empty', {
      module: 'DocumentConverter',
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }

  // 清理 a[href]
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    try {
      const u = new URL(href);
      if (!SAFE_LINK_PROTOCOLS.has(u.protocol)) {
        a.removeAttribute('href');
      }
    } catch {
      // 相对 URL 或无效 URL：保留（相对 URL 不会构成 javascript: 协议攻击）
    }
  });

  // 清理 img[src]、source[src]、iframe[src]、video[src]、audio[src]、track[src]、embed[src]
  const srcElements = document.querySelectorAll('img[src], source[src], iframe[src], video[src], audio[src], track[src], embed[src]');
  srcElements.forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;
    try {
      const u = new URL(src);
      if (!isSafeImageUrl(u)) {
        el.removeAttribute('src');
      }
    } catch {
      // 相对 URL 保留
    }
  });

  return document.toString();
}

/**
 * 从文本内容中提取关键词作为标签
 *
 * 采用中文 N-gram (2-4 字) + 英文单词提取，结合停用词过滤和频率统计。
 * 优先选择更长且出现频率高的词组。
 *
 * @param content 文本内容
 * @param maxTags 最大标签数
 * @returns 标签数组
 */
export function extractTags(content: string, maxTags: number): string[] {
  if (!content || maxTags <= 0) return [];

  // 标点替换为空格，保留中文、英文、数字
  const text = content.replace(
    /[，。！？；：、""''（）【】《》—…·\.\,\!\?\;\:\"\'\(\)\[\]\<\>\/\\]/g,
    ' '
  );

  const freq = new Map<string, number>();
  // 匹配连续中文段或英文单词或数字
  const tokenRegex = /[\u4e00-\u9fff]+|[a-zA-Z][a-zA-Z0-9]+|\d+/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];

    if (/^[a-zA-Z]/.test(token)) {
      // 英文/数字词
      const word = token.toLowerCase();
      if (STOP_WORDS.has(word)) continue;
      if (word.length < 2) continue;
      freq.set(word, (freq.get(word) || 0) + 1);
    } else {
      // 中文段：生成 2-4 字 N-gram
      for (let len = 2; len <= Math.min(4, token.length); len++) {
        for (let i = 0; i <= token.length - len; i++) {
          const ngram = token.substring(i, i + len);
          // 首尾是停用词的 N-gram 过滤
          if (STOP_WORDS.has(ngram[0])) continue;
          if (STOP_WORDS.has(ngram[ngram.length - 1])) continue;
          // 整体是停用词的过滤
          if (STOP_WORDS.has(ngram)) continue;
          freq.set(ngram, (freq.get(ngram) || 0) + 1);
        }
      }
    }
  }

  // 大文档下分级提升最小频率阈值，避免 N-gram 数量爆炸
  // - <=5K 字：minFreq=1（小文档保留低频词，提高召回）
  // - 5K~50K 字：minFreq=2（中等文档，平衡召回与噪声）
  // - >50K 字：minFreq=3（大文档强制更高频率，控制 O(N log N) 排序规模）
  const minFreq = text.length > 50000 ? 3 : text.length > 5000 ? 2 : 1;

  // 排序：频率降序 → 长度降序（更长优先）
  const sorted = Array.from(freq.entries())
    .filter(([, count]) => count >= minFreq)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].length - a[0].length;
    });

  // 去重：若短词是已选更长词的子串且频率不更高，跳过
  const result: string[] = [];
  for (const [word, count] of sorted) {
    if (result.length >= maxTags) break;
    const isSubstringOfLonger = result.some(
      (selected) =>
        selected.length > word.length &&
        selected.includes(word) &&
        (freq.get(selected) || 0) >= count
    );
    if (!isSubstringOfLonger) {
      result.push(word);
    }
  }

  return result.slice(0, maxTags);
}

/**
 * 生成 YAML frontmatter
 *
 * @param doc 结构化文档
 * @returns YAML frontmatter 字符串（含 --- 边界）
 */
export function generateFrontmatter(doc: StructuredDocument): string {
  const lines: string[] = ['---'];

  const addField = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.length === 0) return;

    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`${key}:`);
      value.forEach((item) => {
        lines.push(`- ${escapeYamlValue(item)}`);
      });
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${escapeYamlValue(value)}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    }
  };

  addField('title', doc.title);
  addField('url', doc.url);
  addField('author', doc.author);
  addField('publishedDate', doc.publishedDate);
  addField('description', doc.description);
  addField('tags', doc.tags);
  addField('wordCount', doc.wordCount);
  addField('extractedAt', doc.extractedAt);
  addField('extractor', doc.extractor);

  lines.push('---');
  return lines.join('\n');
}

/**
 * 转义 YAML 字符串值
 * 所有字符串值统一用双引号包裹，内部双引号和反斜杠转义
 */
function escapeYamlValue(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 转义 Markdown 文本中的特殊字符
 *
 * 防护范围：
 * - HTML 特殊字符（& < > "）：避免朴素 Markdown 渲染器将其解析为 HTML 标签/属性，
 *   造成 XSS 或属性注入（防御纵深，主流 CommonMark 渲染器会自动转义但不可依赖）
 * - Markdown 元字符（[ ] \）：防止链接语法注入
 * - 换行符：标题/alt 文本中不允许换行，避免被截断为多段 Markdown
 *
 * 用于 alt 文本、链接文本、标题文本等会被拼入 Markdown 语法的位置
 */
function escapeMarkdownText(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/([[\]\\])/g, '\\$1');
}

/**
 * 转义 Markdown URL 中的左右括号
 * 防止 URL 中的括号破坏 Markdown 链接语法 `[text](url)`
 */
function escapeMarkdownUrl(url: string): string {
  return url.replace(/([()])/g, '\\$1');
}

/**
 * 生成 Markdown 输出
 *
 * @param doc 结构化文档
 * @param withFrontmatter 是否包含 YAML frontmatter
 * @returns Markdown 字符串
 */
export function generateMarkdownOutput(
  doc: StructuredDocument,
  withFrontmatter: boolean
): string {
  const parts: string[] = [];

  if (withFrontmatter) {
    parts.push(generateFrontmatter(doc));
    parts.push(''); // frontmatter 后空行
  }

  if (doc.title) {
    // 标题来自攻击者可控的 HTML，需转义防 XSS / Markdown 注入
    parts.push(`# ${escapeMarkdownText(doc.title)}`);
    parts.push('');
  }

  if (doc.content) {
    parts.push(doc.content);
    parts.push('');
  }

  if (doc.images.length > 0) {
    parts.push('## 图片');
    parts.push('');
    doc.images.forEach((img) => {
      const alt = escapeMarkdownText(img.alt || '图片');
      const url = escapeMarkdownUrl(img.url);
      parts.push(`![${alt}](${url})`);
    });
    parts.push('');
  }

  if (doc.links.length > 0) {
    parts.push('## 链接');
    parts.push('');
    doc.links.forEach((link) => {
      const text = escapeMarkdownText(link.text || link.url);
      const url = escapeMarkdownUrl(link.url);
      parts.push(`- [${text}](${url}) (${link.type})`);
    });
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 生成 JSON 输出
 *
 * @param doc 结构化文档
 * @returns JSON 字符串
 */
export function generateJsonOutput(doc: StructuredDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * 将 HTML 转换为结构化文档
 *
 * @param html HTML 内容
 * @param url 页面 URL
 * @param options 提取选项
 * @returns 结构化文档
 */
export async function convertToStructuredDocument(
  html: string,
  url: string,
  options: StructuredDocumentOptions = {}
): Promise<StructuredDocument> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 空输入快速失败
  if (!html || html.trim().length === 0) {
    logger.warn('Empty HTML content, skipping conversion', {
      module: 'DocumentConverter',
      url,
    });
    return {
      success: false,
      title: '',
      url,
      content: '',
      format: opts.format,
      contentFormat: 'markdown',
      images: [],
      links: [],
      tags: [],
      wordCount: 0,
      extractedAt: new Date().toISOString(),
      extractor: opts.extractor,
      duration: Date.now() - startTime,
      error: 'Empty HTML content',
    };
  }

  const baseUrl = opts.baseUrl || url;

  // 计算实际 content 格式：
  // - opts.format='html' → content 必为 html
  // - opts.format='markdown'/'json' → content 为 markdown（默认）
  const contentFormat: ContentFormat = opts.format === 'html' ? 'html' : 'markdown';

  try {
    let extractor: ExtractorType = opts.extractor;
    let title = '';
    let author: string | undefined;
    let publishedDate: string | undefined;
    let description: string | undefined;
    let content = '';
    let rawHtml: string | undefined;
    let wordCount = 0;

    // 主提取器：defuddle
    // 使用 separateMarkdown 同时保留原 HTML (content) 和 Markdown (contentMarkdown)
    if (opts.extractor === 'defuddle') {
      try {
        // defuddle 需要 markdown 输出时启用 separateMarkdown
        const needMarkdown = contentFormat === 'markdown';
        const result = await Defuddle(html, baseUrl, {
          separateMarkdown: needMarkdown,
          url: baseUrl,
        });

        title = result.title || extractTitleFromHtml(html) || '';
        author = result.author || undefined;
        publishedDate = result.published || undefined;
        description = result.description || undefined;
        rawHtml = result.content || undefined;

        if (needMarkdown) {
          // 优先使用 contentMarkdown（defuddle 转换的 Markdown）
          content = result.contentMarkdown || result.content || '';
        } else {
          content = result.content || '';
        }

        // defuddle 已返回 wordCount 时直接复用；否则稍后统一计算
        wordCount = result.wordCount || 0;
      } catch (defuddleError) {
        logger.warn('Defuddle extraction failed, falling back to article-extractor', {
          module: 'DocumentConverter',
          url,
          error: defuddleError instanceof Error ? defuddleError.message : String(defuddleError),
        });
        extractor = 'article-extractor';
      }
    }

    // 后备提取器：article-extractor
    if (extractor === 'article-extractor') {
      const article = await extractArticle(html, baseUrl);

      title = article.title || extractTitleFromHtml(html) || '';
      author = article.author;
      publishedDate = article.publishedTime;
      description = article.description;
      rawHtml = article.content;

      if (contentFormat === 'markdown' && article.content) {
        // article-extractor 返回的 HTML 可能含危险协议（javascript:/vbscript: 等），
        // 经 turndown 转换后仍会原样保留在 Markdown 链接中。
        // 在此处对 rawHtml 做 DOM sanitization：移除危险协议的 href/src
        const sanitizedHtml = sanitizeHtmlLinks(article.content);
        content = turndownService.turndown(sanitizedHtml);
      } else {
        content = contentFormat === 'html'
          ? sanitizeHtmlLinks(article.content || '')
          : (article.content || article.textContent || '');
      }

      // article-extractor 不返回 wordCount，稍后统一计算
      wordCount = 0;
    }

    // 一次性提取图片和链接（复用同一份 DOM，避免重复 parseHTML）
    const needExtract = opts.extractImages || opts.extractLinks;
    const { images, links } = needExtract
      ? extractImagesAndLinks(html, baseUrl)
      : { images: [] as ImageInfo[], links: [] as LinkInfo[] };
    const finalImages = opts.extractImages ? images : [];
    const finalLinks = opts.extractLinks ? links : [];

    // 性能优化：复用同一份 plainText，避免 stripMarkdown 被调用 2 次（countWords + extractTags 各一次）
    // stripMarkdown 含 13 趟 .replace 全量扫描，对大文档是显著开销
    const plainText = stripMarkdown(content);
    if (wordCount === 0) {
      wordCount = countWordsFromPlain(plainText);
    }

    // 提取标签（基于标题和正文）：复用 plainText
    const tags = opts.extractTags
      ? extractTags(`${title} ${plainText}`, opts.maxTags)
      : [];

    const doc: StructuredDocument = {
      success: true,
      title,
      url,
      author,
      publishedDate,
      description,
      content,
      format: opts.format,
      contentFormat,
      html: rawHtml,
      images: finalImages,
      links: finalLinks,
      tags,
      wordCount,
      extractedAt: new Date().toISOString(),
      extractor,
      duration: Date.now() - startTime,
    };

    logger.info('Structured document converted', {
      module: 'DocumentConverter',
      url,
      extractor,
      title,
      wordCount,
      duration: doc.duration,
    });

    return doc;
  } catch (error) {
    // 详细错误仅入日志，不外泄给调用方
    logger.error('Failed to convert structured document', error instanceof Error ? error : undefined, {
      module: 'DocumentConverter',
      url,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      title: '',
      url,
      content: '',
      format: opts.format,
      contentFormat,
      images: [],
      links: [],
      tags: [],
      wordCount: 0,
      extractedAt: new Date().toISOString(),
      extractor: opts.extractor,
      duration: Date.now() - startTime,
      // 对外返回通用错误消息，避免敏感信息泄露；详细错误仅入日志
      error: 'Failed to convert document',
    };
  }
}

/**
 * 统计纯文本字数（中文按字符计，英文按单词计）
 *
 * 注意：传入的 plain 必须是已 stripMarkdown 的纯文本，
 * 避免在调用方已经 stripMarkdown 后又重复执行一次。
 */
function countWordsFromPlain(plain: string): number {
  if (!plain) return 0;
  // 中文字符数
  const chineseChars = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  // 英文单词数
  const englishWords = (plain.match(/[a-zA-Z][a-zA-Z0-9]*/g) || []).length;
  return chineseChars + englishWords;
}

/**
 * 移除 Markdown 标记，返回纯文本
 */
function stripMarkdown(markdown: string): string {
  if (!markdown) return '';

  return markdown
    // 移除标题标记
    .replace(/^#{1,6}\s+/gm, '')
    // 移除链接，保留文本
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 移除图片
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // 移除粗体/斜体
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // 移除引用
    .replace(/^>\s+/gm, '')
    // 移除列表标记
    .replace(/^[\-\*\+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // 移除水平线
    .replace(/^---+$/gm, '')
    // 压缩空白
    .replace(/\s+/g, ' ')
    .trim();
}
