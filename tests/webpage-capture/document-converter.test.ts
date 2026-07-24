/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * 结构化文档转换器测试
 *
 * 覆盖目标：
 * 1. HTML → Markdown 转换（defuddle 提取器）
 * 2. HTML → JSON/HTML 输出格式（含 format/contentFormat 契约）
 * 3. 图片提取（src、alt、相对路径解析、危险协议过滤）
 * 4. 链接提取（内部/外部分类、文本提取、协议白名单、前导空白绕过）
 * 5. 标签自动提取（含 maxTags<=0 边界）
 * 6. YAML frontmatter 生成（含特殊字符转义）
 * 7. 字数统计
 * 8. 错误处理（空输入、无效 HTML、错误消息脱敏）
 * 9. article-extractor 后备路径（含协议 sanitization）
 * 10. 选项控制（extractImages、extractLinks、extractTags 开关）
 * 11. 安全：标题注入 / Markdown 注入 / 协议绕过
 * 12. 性能基准（大文档处理耗时）
 * 13. extractImagesAndLinks 合并函数复用 DOM
 */

import { describe, it, expect, vi } from 'vitest';
import {
  convertToStructuredDocument,
  extractImages,
  extractLinks,
  extractImagesAndLinks,
  extractTags,
  generateFrontmatter,
  generateMarkdownOutput,
  generateJsonOutput,
} from '../../src/webpage-capture/document-converter.js';
import type { StructuredDocument } from '../../src/webpage-capture/types.js';

// 测试用 HTML 样本
const SAMPLE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>测试文章标题 - 测试站点</title>
  <meta name="description" content="这是一篇关于非遗保护的测试文章">
  <meta name="author" content="张三">
  <meta property="article:published_time" content="2025-06-15T10:30:00Z">
</head>
<body>
  <nav><a href="/home">首页</a> | <a href="/about">关于</a></nav>
  <article>
    <h1>测试文章标题</h1>
    <p>这是第一段正文内容，介绍<strong>传统技艺</strong>的历史渊源。</p>
    <p>第二段讨论<em>非遗保护</em>的重要意义。</p>
    <img src="/images/photo1.jpg" alt="传统技艺照片" width="800" height="600">
    <img src="https://cdn.example.com/external.png" alt="外部图片">
    <h2>子标题</h2>
    <p>更多内容请参考<a href="https://example.com/external-link">外部链接</a>。</p>
    <p>内部链接<a href="/internal-page">内部页面</a>。</p>
    <ul>
      <li>要点一</li>
      <li>要点二</li>
    </ul>
    <blockquote>这是一段引用文字。</blockquote>
  </article>
  <footer>版权所有 © 2025</footer>
</body>
</html>
`;

const SIMPLE_HTML = `
<html>
<head><title>简单页面</title></head>
<body>
  <h1>简单标题</h1>
  <p>这是一段简单的文本内容。</p>
  <a href="https://example.com">示例链接</a>
</body>
</html>
`;

// 构造 StructuredDocument 的工厂，集中默认值，避免每个测试重复
function makeDoc(overrides: Partial<StructuredDocument> = {}): StructuredDocument {
  return {
    success: true,
    title: '',
    url: '',
    content: '',
    format: 'markdown',
    contentFormat: 'markdown',
    images: [],
    links: [],
    tags: [],
    wordCount: 0,
    extractedAt: '2025-07-25T10:00:00Z',
    extractor: 'defuddle',
    ...overrides,
  };
}

describe('DocumentConverter - extractImages', () => {
  it('应从 HTML 中提取所有图片', () => {
    const images = extractImages(SAMPLE_HTML, 'https://test.example.com/article/1');
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe('https://test.example.com/images/photo1.jpg');
    expect(images[0].alt).toBe('传统技艺照片');
    expect(images[0].width).toBe(800);
    expect(images[0].height).toBe(600);
  });

  it('应解析相对 URL 为绝对 URL', () => {
    const html = '<img src="/img/a.png" alt="A"><img src="https://cdn.com/b.png" alt="B">';
    const images = extractImages(html, 'https://example.com/page');
    expect(images[0].url).toBe('https://example.com/img/a.png');
    expect(images[1].url).toBe('https://cdn.com/b.png');
  });

  it('应忽略无 src 的图片', () => {
    const html = '<img alt="No src"><img src="" alt="Empty src"><img src="valid.png" alt="Valid">';
    const images = extractImages(html, 'https://example.com/');
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('Valid');
  });

  it('应过滤危险协议图片（javascript:、data:image/svg+xml）', () => {
    const html = `
      <img src="javascript:alert(1)" alt="JS">
      <img src="data:image/svg+xml;base64,PHN2Zz4=" alt="SVG">
      <img src="data:image/png;base64,iVBORw0KG=" alt="PNG">
      <img src="vbscript:msgbox(1)" alt="VBS">
      <img src="https://example.com/safe.png" alt="Safe">
    `;
    const images = extractImages(html, 'https://example.com/');
    // 仅 https 和 data:image/png 应保留
    expect(images).toHaveLength(2);
    const alts = images.map(i => i.alt);
    expect(alts).toContain('PNG');
    expect(alts).toContain('Safe');
    expect(alts).not.toContain('JS');
    expect(alts).not.toContain('SVG');
    expect(alts).not.toContain('VBS');
  });

  it('应处理空 HTML 输入', () => {
    const images = extractImages('', 'https://example.com/');
    expect(images).toEqual([]);
  });
});

describe('DocumentConverter - extractLinks', () => {
  it('应从 HTML 中提取所有链接并分类', () => {
    const links = extractLinks(SAMPLE_HTML, 'https://test.example.com/article/1');
    // 页面中的链接：/home, /about, https://example.com/external-link, /internal-page
    expect(links.length).toBeGreaterThanOrEqual(4);

    const internal = links.filter(l => l.type === 'internal');
    const external = links.filter(l => l.type === 'external');
    expect(internal.length).toBeGreaterThanOrEqual(3); // /home, /about, /internal-page
    expect(external.length).toBeGreaterThanOrEqual(1);  // https://example.com/external-link
  });

  it('应提取链接文本', () => {
    const html = '<a href="/page">页面文本</a>';
    const links = extractLinks(html, 'https://example.com/');
    expect(links[0].text).toBe('页面文本');
  });

  it('应解析相对 URL 为绝对 URL', () => {
    const html = '<a href="/relative">相对</a><a href="https://other.com/abs">绝对</a>';
    const links = extractLinks(html, 'https://example.com/page');
    expect(links[0].url).toBe('https://example.com/relative');
    expect(links[1].url).toBe('https://other.com/abs');
    expect(links[0].type).toBe('internal');
    expect(links[1].type).toBe('external');
  });

  it('应忽略无 href 或空 href 的链接', () => {
    const html = '<a name="anchor">无href</a><a href="">空href</a><a href="/valid">有效</a>';
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('有效');
  });

  it('应过滤 javascript: 和 mailto: 链接', () => {
    const html = '<a href="javascript:void(0)">JS</a><a href="mailto:test@test.com">邮件</a><a href="/valid">有效</a>';
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toHaveLength(1);
  });

  it('应过滤前导空白绕过协议白名单', () => {
    // 攻击者用前导空白尝试绕过协议过滤：' javascript:' 应被 new URL 规范化并拦截
    const html = '<a href=" javascript:alert(1)">JS</a><a href="/valid">有效</a>';
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('有效');
  });

  it('应处理空 HTML 输入', () => {
    expect(extractLinks('', 'https://example.com/')).toEqual([]);
  });
});

describe('DocumentConverter - extractImagesAndLinks', () => {
  it('应一次性返回图片和链接（复用同一份 DOM）', () => {
    const html = `
      <img src="/img.png" alt="图片">
      <a href="/link">链接</a>
    `;
    const { images, links } = extractImagesAndLinks(html, 'https://example.com/');
    expect(images).toHaveLength(1);
    expect(links).toHaveLength(1);
    expect(images[0].url).toBe('https://example.com/img.png');
    expect(links[0].url).toBe('https://example.com/link');
  });

  it('应处理空输入', () => {
    const { images, links } = extractImagesAndLinks('', 'https://example.com/');
    expect(images).toEqual([]);
    expect(links).toEqual([]);
  });
});

describe('DocumentConverter - extractTags', () => {
  it('应从内容中提取高频关键词作为标签', () => {
    const content = '传统技艺是非物质文化遗产的重要组成部分。传统技艺包括陶瓷、编织、木雕等多种工艺。保护传统技艺对于文化传承至关重要。';
    const tags = extractTags(content, 5);
    expect(tags).toContain('传统技艺');
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it('应尊重 maxTags 限制', () => {
    const content = '苹果 香蕉 橘子 葡萄 西瓜 草莓 蓝莓 樱桃 芒果 菠萝';
    const tags = extractTags(content, 3);
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it('应处理空内容', () => {
    expect(extractTags('', 5)).toEqual([]);
  });

  it('应处理 maxTags <= 0 边界', () => {
    const content = '传统技艺需要保护';
    expect(extractTags(content, 0)).toEqual([]);
    expect(extractTags(content, -1)).toEqual([]);
  });

  it('应过滤停用词', () => {
    const content = '这是 一个 的 我们 在 和 与 了 的 是';
    const tags = extractTags(content, 5);
    // 停用词不应出现在标签中
    expect(tags).not.toContain('的');
    expect(tags).not.toContain('了');
    expect(tags).not.toContain('是');
  });
});

describe('DocumentConverter - generateFrontmatter', () => {
  it('应生成有效的 YAML frontmatter', () => {
    const doc = makeDoc({
      title: '测试标题',
      url: 'https://example.com/article',
      author: '张三',
      publishedDate: '2025-06-15T10:30:00Z',
      description: '测试描述',
      tags: ['标签1', '标签2'],
      wordCount: 100,
    });

    const fm = generateFrontmatter(doc);
    expect(fm).toContain('---');
    expect(fm).toContain('title: "测试标题"');
    expect(fm).toContain('url: "https://example.com/article"');
    expect(fm).toContain('author: "张三"');
    expect(fm).toContain('tags:');
    expect(fm).toContain('- "标签1"');
  });

  it('应跳过 undefined 字段', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '内容',
      wordCount: 10,
    });

    const fm = generateFrontmatter(doc);
    expect(fm).not.toContain('author:');
    expect(fm).not.toContain('publishedDate:');
    expect(fm).not.toContain('description:');
  });

  it('应处理空标签列表', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '内容',
      wordCount: 10,
    });

    const fm = generateFrontmatter(doc);
    expect(fm).not.toContain('tags:');
  });

  it('应转义 YAML 字符串中的双引号和反斜杠', () => {
    const doc = makeDoc({
      title: '含"双引号"和\\反斜杠',
      url: 'https://example.com/',
    });
    const fm = generateFrontmatter(doc);
    // 双引号应被转义为 \"，反斜杠转义为 \\
    expect(fm).toContain('title: "含\\"双引号\\"和\\\\反斜杠"');
  });
});

describe('DocumentConverter - generateMarkdownOutput', () => {
  it('应生成包含 frontmatter 的完整 Markdown', () => {
    const doc = makeDoc({
      title: '测试标题',
      url: 'https://example.com/article',
      author: '张三',
      content: '这是正文内容。',
      tags: ['标签'],
      wordCount: 5,
    });

    const md = generateMarkdownOutput(doc, true);
    expect(md.startsWith('---')).toBe(true);
    expect(md).toContain('title: "测试标题"');
    expect(md).toContain('这是正文内容。');
  });

  it('应支持不生成 frontmatter', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '内容',
      wordCount: 2,
    });

    const md = generateMarkdownOutput(doc, false);
    expect(md.startsWith('---')).toBe(false);
    expect(md).toContain('内容');
  });

  it('应转义标题中的 Markdown 注入字符', () => {
    // 标题含 [link](javascript:...) 尝试 Markdown 注入
    const doc = makeDoc({
      title: 'Hello [click](javascript:alert(1))',
      url: 'https://example.com/',
      content: '',
    });
    const md = generateMarkdownOutput(doc, false);
    // 注入的链接语法应被破坏（[ ] 被转义为 \[ \]），不会渲染为可点击链接
    expect(md).not.toMatch(/\[click\]\(javascript:alert\(1\)\)/);
    expect(md).toContain('\\[');
  });

  it('应转义标题中的 HTML 特殊字符', () => {
    const doc = makeDoc({
      title: '含 <script>alert(1)</script> 标签',
      url: 'https://example.com/',
      content: '',
    });
    const md = generateMarkdownOutput(doc, false);
    // < > 应被转义为 &lt; &gt;，避免被朴素渲染器解析为 HTML
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;script&gt;');
  });

  it('应转义 alt 文本中的特殊字符', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '',
      images: [{ url: 'https://example.com/img.png', alt: 'alt"onerror="alert(1)' }],
    });
    const md = generateMarkdownOutput(doc, false);
    // alt 中的双引号应被转义为 &quot;
    expect(md).not.toContain('alt"onerror');
    expect(md).toContain('&quot;');
  });

  it('应转义链接文本中的特殊字符', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '',
      links: [{ url: 'https://example.com/link', text: '文本[注入]', type: 'internal' }],
    });
    const md = generateMarkdownOutput(doc, false);
    // 链接文本中的 [ ] 应被转义
    expect(md).toContain('\\[');
    expect(md).not.toMatch(/\[文本\[注入\]\]/);
  });

  it('应移除标题中的换行符', () => {
    const doc = makeDoc({
      title: '第一行\n第二行',
      url: 'https://example.com/',
      content: '',
    });
    const md = generateMarkdownOutput(doc, false);
    // # 标题行不应被换行符截断为多段 Markdown
    expect(md).not.toMatch(/^# 第一行\n第二行$/m);
    expect(md).toMatch(/^# 第一行 第二行$/m);
  });
});

describe('DocumentConverter - generateJsonOutput', () => {
  it('应生成有效的 JSON 字符串', () => {
    const doc = makeDoc({
      title: '标题',
      url: 'https://example.com/',
      content: '内容',
      images: [{ url: 'https://example.com/img.png', alt: '图' }],
      links: [{ url: 'https://example.com/link', text: '链接', type: 'internal' }],
      tags: ['标签'],
      wordCount: 2,
    });

    const json = generateJsonOutput(doc);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('标题');
    expect(parsed.images[0].url).toBe('https://example.com/img.png');
    expect(parsed.links[0].type).toBe('internal');
    expect(parsed.tags).toContain('标签');
  });
});

describe('DocumentConverter - convertToStructuredDocument', () => {
  it('应使用 defuddle 提取器转换 HTML 为结构化文档', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractor: 'defuddle', format: 'markdown' }
    );

    expect(doc.success).toBe(true);
    expect(doc.url).toBe('https://test.example.com/article/1');
    expect(doc.extractor).toBe('defuddle');
    expect(doc.content).toBeTruthy();
    expect(doc.wordCount).toBeGreaterThan(0);
    expect(doc.extractedAt).toBeTruthy();
    // format 契约：format='markdown' → contentFormat 必为 'markdown'
    expect(doc.format).toBe('markdown');
    expect(doc.contentFormat).toBe('markdown');
  });

  it('应提取 description 字段', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractor: 'defuddle' }
    );
    // SAMPLE_HTML 中 <meta name="description" content="这是一篇关于非遗保护的测试文章">
    expect(doc.description).toBeTruthy();
    expect(doc.description).toContain('非遗保护');
  });

  it('应提取图片和链接', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractImages: true, extractLinks: true }
    );

    expect(doc.images.length).toBeGreaterThanOrEqual(2);
    expect(doc.links.length).toBeGreaterThanOrEqual(4);
  });

  it('应尊重 extractImages: false 选项', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractImages: false }
    );
    expect(doc.images).toEqual([]);
  });

  it('应尊重 extractLinks: false 选项', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractLinks: false }
    );
    expect(doc.links).toEqual([]);
  });

  it('应自动提取标签', async () => {
    const html = '<html><body><article><h1>传统技艺</h1><p>传统技艺是非遗的重要部分。传统技艺需要保护和传承。</p></article></body></html>';
    const doc = await convertToStructuredDocument(
      html,
      'https://example.com/',
      { extractTags: true, maxTags: 5 }
    );
    expect(doc.tags.length).toBeGreaterThan(0);
    expect(doc.tags.length).toBeLessThanOrEqual(5);
  });

  it('应使用 article-extractor 后备路径', async () => {
    const doc = await convertToStructuredDocument(
      SAMPLE_HTML,
      'https://test.example.com/article/1',
      { extractor: 'article-extractor' }
    );

    expect(doc.extractor).toBe('article-extractor');
    // article-extractor 对 SAMPLE_HTML（简短测试 HTML）返回 success=false，
    // 因为 @extractus/article-extractor 对内容过短的页面会返回 null。
    // 修复 MED-003 后，convertToStructuredDocument 会正确传播失败状态，
    // 不再用空值构造 success=true 的文档谎报成功。
    expect(doc.success).toBe(false);
    expect(doc.error).toBe('All extractors failed to extract content');
    expect(doc.content).toBe('');
  });

  it('两个提取器都失败时应返回失败结果（规则12：失败必须显性化）', async () => {
    // Mock extractArticle 返回失败，验证 defuddle 失败降级后 article-extractor 也失败时
    // 不会用空值构造 success=true 的文档谎报成功
    const articleExtractorModule = await import('../../src/webpage-capture/article-extractor.js');
    const extractArticleSpy = vi
      .spyOn(articleExtractorModule, 'extractArticle')
      .mockResolvedValue({
        success: false,
        error: 'No article content found',
        url: 'https://example.com/',
      });

    // 构造一个让 defuddle 也失败的 HTML（损坏的结构）
    // 注意：defuddle 对简单 HTML 可能不抛错，所以用 article-extractor 显式失败 + 强制走后备路径
    const doc = await convertToStructuredDocument(
      '<html><body>some content</body></html>',
      'https://example.com/',
      { extractor: 'article-extractor' }
    );

    expect(doc.success).toBe(false);
    expect(doc.error).toBeTruthy();
    expect(doc.error).toBe('All extractors failed to extract content');
    expect(doc.content).toBe('');
    expect(doc.images).toEqual([]);
    expect(doc.links).toEqual([]);
    expect(doc.tags).toEqual([]);
    // 错误消息不应包含内部细节
    expect(doc.error).not.toMatch(/No article content found/);

    extractArticleSpy.mockRestore();
  });

  it('空 HTML 输入应返回失败', async () => {
    const doc = await convertToStructuredDocument('', 'https://example.com/', {});
    expect(doc.success).toBe(false);
    expect(doc.error).toBeTruthy();
    // 空输入也应设置 format/contentFormat
    expect(doc.format).toBe('markdown');
    expect(doc.contentFormat).toBe('markdown');
  });

  it('应处理无效 HTML 输入', async () => {
    const doc = await convertToStructuredDocument(
      '<html><body>无结构文本</body></html>',
      'https://example.com/',
      {}
    );
    // 即使 HTML 不完整，也应返回结果（不报错）
    expect(doc).toBeDefined();
    expect(doc.url).toBe('https://example.com/');
  });

  it('应计算正文字数', async () => {
    const html = '<html><body><article><p>这 是 五 个 词 的 句子</p></article></body></html>';
    const doc = await convertToStructuredDocument(html, 'https://example.com/', {});
    expect(doc.wordCount).toBeGreaterThan(0);
  });

  it('应记录处理耗时', async () => {
    const doc = await convertToStructuredDocument(SIMPLE_HTML, 'https://example.com/', {});
    expect(doc.duration).toBeGreaterThanOrEqual(0);
  });

  it('format="html" 时 content 应为 HTML，contentFormat 应为 html', async () => {
    const doc = await convertToStructuredDocument(
      SIMPLE_HTML,
      'https://example.com/',
      { format: 'html' }
    );
    expect(doc.format).toBe('html');
    expect(doc.contentFormat).toBe('html');
    // content 应包含 HTML 标签（raw HTML 形式）
    expect(doc.content).toContain('<');
  });

  it('format="json" 时 content 仍为 Markdown（不自指），调用方用 generateJsonOutput 生成 JSON', async () => {
    const doc = await convertToStructuredDocument(
      SIMPLE_HTML,
      'https://example.com/',
      { format: 'json' }
    );
    expect(doc.format).toBe('json');
    // content 仍是 markdown，不是整个文档的 JSON 字符串
    expect(doc.contentFormat).toBe('markdown');
    expect(doc.content).not.toMatch(/^\{$/m); // 不是 JSON 起始
    // generateJsonOutput 可正确序列化为 JSON
    const json = generateJsonOutput(doc);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe(doc.title);
  });

  it('错误消息应通用化，不泄露内部错误细节', async () => {
    // 触发 defuddle 失败并 article-extractor 失败的极端场景难以构造，
    // 此处验证空输入路径的 error 字段不包含内部路径或 stack 信息
    const doc = await convertToStructuredDocument('', 'https://example.com/', {});
    expect(doc.error).toBe('Empty HTML content');
    // error 不应包含文件路径、行号、stack trace
    expect(doc.error).not.toMatch(/\/src\//);
    expect(doc.error).not.toMatch(/\.ts:\d+/);
    expect(doc.error).not.toMatch(/at\s+\w+/);
  });

  it('大文档处理应在合理时间内完成（性能基准）', async () => {
    // 构造 100KB HTML（约 1000 段重复内容）
    const paragraph = '<p>传统技艺是非物质文化遗产的重要组成部分，需要保护和传承。</p>';
    const bigHtml = `<html><head><title>大文档测试</title></head><body><article>${paragraph.repeat(2000)}</article></body></html>`;
    // 100KB+

    const start = Date.now();
    const doc = await convertToStructuredDocument(bigHtml, 'https://example.com/', {
      extractTags: true,
      maxTags: 10,
    });
    const duration = Date.now() - start;

    expect(doc.success).toBe(true);
    expect(doc.wordCount).toBeGreaterThan(0);
    // 性能基准：100KB 文档处理应在 1 秒内完成（含 defuddle 解析 + N-gram 提取）
    // 实测 ~207ms，留 5 倍 buffer 防止 CI 环境抖动；原阈值 5000ms 过松无法捕获回归
    expect(duration).toBeLessThan(1000);
  });

  it('恶意超长中文字符串不应触发 OOM（DoS 防御）', async () => {
    // 构造 100KB 连续中文字符串（无标点切分），攻击 N-gram 提取的 token 长度无上限漏洞
    // 修复前：N-gram 数量 ≈ 3 × len = 900K entries，~90MB 内存
    // 修复后：token 截断到 200 字，N-gram 数量上限 600 entries
    const maliciousContent = '非遗保护'.repeat(25000); // 100KB 连续中文
    const bigHtml = `<html><head><title>恶意测试</title></head><body><article><p>${maliciousContent}</p></article></body></html>`;

    const start = Date.now();
    const startHeap = process.memoryUsage().heapUsed;
    const doc = await convertToStructuredDocument(bigHtml, 'https://example.com/', {
      extractTags: true,
      maxTags: 10,
    });
    const duration = Date.now() - start;
    const heapGrowth = process.memoryUsage().heapUsed - startHeap;

    expect(doc.success).toBe(true);
    // 处理时间应在 2 秒内（防止 N-gram 数量爆炸导致超时）
    expect(duration).toBeLessThan(2000);
    // 堆内存增长不应超过 100MB（防止 OOM）
    expect(heapGrowth).toBeLessThan(100 * 1024 * 1024);
  });

  it('extractTags 应对超长中文 token 截断后仍能提取有效标签', () => {
    // 构造 500 字连续中文（无标点），验证 token 截断不破坏标签提取
    const longToken = '传统技艺保护传承发展非物质文化遗产'.repeat(20); // 500 字
    const tags = extractTags(longToken, 5);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(5);
    // 应能提取到合理的中文词组
    expect(tags.some(t => t.includes('传统') || t.includes('技艺') || t.includes('非遗'))).toBe(true);
  });
});
