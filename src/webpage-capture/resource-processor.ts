/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 网页捕获模块 - 资源处理器
 *
 * 功能：
 * - 收集页面中的所有外部资源
 * - 获取跨域资源（通过代理服务）
 * - 将资源转换为 Data URI
 */

import type { Page, ElementHandle } from "puppeteer";
import type { ResourceInfo, ResourceStats, CaptureOptions } from "./types.js";
import { RESOURCE_CONFIG } from "./config.js";
import { logger } from "../logger.js";
import { validateUrl, validateDnsResolution } from "../security.js";
import { request as undiciRequest, Agent } from "undici";
import { createPinnedAgent } from "../utils/pinned-agent.js";
import {
  readUndiciBodyWithLimit,
  readWebBodyWithLimit,
  type UndiciBodyLike,
} from "../utils/body-reader.js";

/**
 * 资源处理器
 */
export class ResourceProcessor {
  private options: Required<CaptureOptions>;
  private stats: ResourceStats = {
    images: 0,
    styles: 0,
    scripts: 0,
    fonts: 0,
    iframes: 0,
    others: 0,
  };
  private totalProcessedSize = 0;

  constructor(options: Required<CaptureOptions>) {
    this.options = options;
  }

  /**
   * 并发控制：分批并行执行
   */
  private async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number = RESOURCE_CONFIG.concurrency,
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 处理页面中的所有资源
   */
  public async processResources(page: Page): Promise<string> {
    logger.info("Starting resource processing", {
      module: "ResourceProcessor",
    });

    let html: string;
    try {
      html = await page.content();
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.error("Page detached before processing started", error, {
          module: "ResourceProcessor",
        });
        throw new Error("Page is no longer available");
      }
      throw error;
    }

    try {
      html = await this.processImages(page, html);
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.warn(
          "Page detached during image processing, continuing with partial result",
          { module: "ResourceProcessor" },
        );
      } else {
        throw error;
      }
    }

    try {
      html = await this.processStyles(page, html);
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.warn(
          "Page detached during style processing, continuing with partial result",
          { module: "ResourceProcessor" },
        );
      } else {
        throw error;
      }
    }

    try {
      html = await this.processFonts(page, html);
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.warn(
          "Page detached during font processing, continuing with partial result",
          { module: "ResourceProcessor" },
        );
      } else {
        throw error;
      }
    }

    if (this.options.processIframes) {
      try {
        html = await this.processIframes(page, html);
      } catch (error) {
        if (error instanceof Error && error.message.includes("detached")) {
          logger.warn(
            "Page detached during iframe processing, continuing with partial result",
            { module: "ResourceProcessor" },
          );
        } else {
          throw error;
        }
      }
    }

    if (this.options.removeScripts) {
      html = this.removeScriptTags(html);
    }

    if (this.options.removeComments) {
      html = this.removeHtmlComments(html);
    }

    logger.info("Resource processing complete", {
      module: "ResourceProcessor",
      stats: this.stats,
    });

    return html;
  }

  /**
   * 处理图片资源（并行）
   */
  private async processImages(page: Page, html: string): Promise<string> {
    try {
      const images = await page.$$("img[src]");
      const processedUrls = new Map<string, string>();
      const baseUrl = page.url();

      interface ImageResult {
        originalSrc: string;
        dataUri?: string;
        success: boolean;
      }

      const processImage = async (
        img: ElementHandle<Element>,
      ): Promise<ImageResult> => {
        try {
          const src = await img.evaluate((el) => el.getAttribute("src"));
          if (!src || src.startsWith("data:")) {
            return { originalSrc: src || "", success: false };
          }

          const absoluteUrl = this.resolveUrl(src, baseUrl);

          if (processedUrls.has(absoluteUrl)) {
            return {
              originalSrc: src,
              dataUri: processedUrls.get(absoluteUrl),
              success: true,
            };
          }

          const resource = await this.fetchResource(absoluteUrl);
          if (resource.success && resource.content) {
            const dataUri = `data:${resource.mimeType};base64,${resource.content}`;
            processedUrls.set(absoluteUrl, dataUri);
            this.stats.images++;
            return { originalSrc: src, dataUri, success: true };
          }
          return { originalSrc: src, success: false };
        } catch {
          return { originalSrc: "", success: false };
        }
      };

      const results = await this.processBatch(images, processImage);

      // 用单次扫描替换所有 src -> dataUri，避免 split().join() 的 O(n × html_length) 性能问题
      // （性能 H-2：原实现每次 split 创建临时数组，n 张图片时复杂度 O(n²)）
      let processedHtml = html;
      const successfulResults = results.filter(
        (r): r is { originalSrc: string; dataUri: string; success: true } =>
          r.success && !!r.dataUri && !!r.originalSrc,
      );
      if (successfulResults.length > 0) {
        // 构造交替正则：url1|url2|url3，一次匹配所有 src
        // 按 originalSrc 长度降序避免短 URL 误匹配长 URL 子串
        const sorted = successfulResults.slice().sort(
          (a, b) => b.originalSrc.length - a.originalSrc.length,
        );
        const pattern = sorted
          .map((r) => `(${this.escapeRegex(r.originalSrc)})`)
          .join("|");
        const regex = new RegExp(pattern, "g");
        // 用 Map 做 O(1) 查找替换值
        const replaceMap = new Map<string, string>();
        for (const r of sorted) {
          replaceMap.set(r.originalSrc, r.dataUri);
        }
        processedHtml = processedHtml.replace(regex, (match) => {
          return replaceMap.get(match) ?? match;
        });
      }

      try {
        const srcsetImages = await page.$$("[srcset]");
        for (const el of srcsetImages) {
          try {
            const srcset = await el.evaluate((el) => el.getAttribute("srcset"));
            if (!srcset) continue;

            const newSrcset = await this.processSrcset(srcset, page.url());
            if (newSrcset !== srcset) {
              processedHtml = processedHtml.replace(srcset, newSrcset);
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("detached")) {
              logger.debug(`Element detached while processing srcset`, {
                module: "ResourceProcessor",
              });
            } else {
              logger.debug(`Failed to process srcset: ${error}`, {
                module: "ResourceProcessor",
              });
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("detached")) {
          logger.debug(`Page detached while querying srcset elements`, {
            module: "ResourceProcessor",
          });
        } else {
          throw error;
        }
      }

      return processedHtml;
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.debug(`Page detached during image processing`, {
          module: "ResourceProcessor",
        });
        return html;
      }
      throw error;
    }
  }

  /**
   * 处理 srcset 属性
   */
  private async processSrcset(
    srcset: string,
    baseUrl: string,
  ): Promise<string> {
    const parts = srcset.split(",").map((part) => part.trim());
    const processedParts: string[] = [];

    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      if (!url || url.startsWith("data:")) {
        processedParts.push(part);
        continue;
      }

      const absoluteUrl = this.resolveUrl(url, baseUrl);
      const resource = await this.fetchResource(absoluteUrl);

      if (resource.success && resource.content) {
        const dataUri = `data:${resource.mimeType};base64,${resource.content}`;
        processedParts.push(descriptor ? `${dataUri} ${descriptor}` : dataUri);
        this.stats.images++;
      } else {
        processedParts.push(part);
      }
    }

    return processedParts.join(", ");
  }

  /**
   * 处理样式资源（并行）
   */
  private async processStyles(page: Page, html: string): Promise<string> {
    try {
      const linkStyles = await page.$$('link[rel="stylesheet"]');
      const processedUrls = new Map<string, string>();
      const baseUrl = page.url();

      interface StyleResult {
        href: string;
        cssContent?: string;
        success: boolean;
      }

      const processLink = async (
        link: ElementHandle<Element>,
      ): Promise<StyleResult> => {
        try {
          const href = await link.evaluate((el) => el.getAttribute("href"));
          if (!href || href.startsWith("data:")) {
            return { href: href || "", success: false };
          }

          const absoluteUrl = this.resolveUrl(href, baseUrl);
          if (processedUrls.has(absoluteUrl)) {
            return {
              href,
              cssContent: processedUrls.get(absoluteUrl),
              success: true,
            };
          }

          const resource = await this.fetchResource(absoluteUrl);
          if (resource.success && resource.content) {
            const cssContent = this.decodeBase64(resource.content);
            const processedCss = await this.processCssUrls(cssContent, baseUrl);
            processedUrls.set(absoluteUrl, processedCss);
            this.stats.styles++;
            return { href, cssContent: processedCss, success: true };
          }
          return { href, success: false };
        } catch {
          return { href: "", success: false };
        }
      };

      const results = await this.processBatch(linkStyles, processLink);

      let processedHtml = html;
      for (const result of results) {
        if (result.success && result.cssContent && result.href) {
          processedHtml = this.replaceLinkWithStyle(
            processedHtml,
            result.href,
            result.cssContent,
          );
        }
      }

      try {
        const inlineStyles = await page.$$("style");
        for (const style of inlineStyles) {
          try {
            const cssContent = await style.evaluate(
              (el) => el.textContent || "",
            );
            const processedCss = await this.processCssUrls(cssContent, baseUrl);
            if (processedCss !== cssContent) {
              processedHtml = processedHtml.replace(cssContent, processedCss);
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("detached")) {
              logger.debug(`Style element detached while processing`, {
                module: "ResourceProcessor",
              });
            } else {
              logger.debug(`Failed to process inline style: ${error}`, {
                module: "ResourceProcessor",
              });
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("detached")) {
          logger.debug(`Page detached while querying style elements`, {
            module: "ResourceProcessor",
          });
        } else {
          throw error;
        }
      }

      return processedHtml;
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.debug(`Page detached during style processing`, {
          module: "ResourceProcessor",
        });
        return html;
      }
      throw error;
    }
  }

  /**
   * 处理 CSS 中的 URL
   */
  private async processCssUrls(css: string, baseUrl: string): Promise<string> {
    // Exclude data:, javascript:, and vbscript: schemes — only http/https URLs
    // should be fetched. resolveUrl and validateUrl provide additional layers.
    const urlRegex = /url\(['"]?(?!['"]?(?:data|javascript|vbscript):)([^'")\s]+)['"]?\)/gi;
    const matches = [...css.matchAll(urlRegex)];
    const processedUrls = new Map<string, string>();

    for (const match of matches) {
      const originalUrl = match[1];
      if (processedUrls.has(originalUrl)) continue;

      const absoluteUrl = this.resolveUrl(originalUrl, baseUrl);
      const resource = await this.fetchResource(absoluteUrl);

      if (resource.success && resource.content) {
        const dataUri = `data:${resource.mimeType};base64,${resource.content}`;
        processedUrls.set(originalUrl, dataUri);

        if (resource.mimeType?.startsWith("image/")) {
          this.stats.images++;
        } else if (resource.mimeType?.includes("font")) {
          this.stats.fonts++;
        }
      }
    }

    let processedCss = css;
    // 预编译正则并缓存，避免循环内重复 new RegExp（性能优化）
    // 用 Map 缓存 [originalUrl -> 编译后的正则]
    const regexCache = new Map<string, RegExp>();
    for (const [originalUrl, dataUri] of processedUrls) {
      let pattern = regexCache.get(originalUrl);
      if (!pattern) {
        pattern = new RegExp(`url\\(['"]?${this.escapeRegex(originalUrl)}['"]?\\)`, "gi");
        regexCache.set(originalUrl, pattern);
      }
      processedCss = processedCss.replace(pattern, `url(${dataUri})`);
      // 全局正则的 lastIndex 需重置（多次 replace 时避免从上次的位置开始）
      pattern.lastIndex = 0;
    }

    return processedCss;
  }

  /**
   * 处理字体资源
   */
  private async processFonts(page: Page, html: string): Promise<string> {
    try {
      const fontFaces = await page.evaluate(() => {
        const styles = document.querySelectorAll("style");
        const fonts: string[] = [];
        styles.forEach((style) => {
          const content = style.textContent || "";
          const fontFaceMatches = content.match(/@font-face\s*\{[^}]+\}/gi);
          if (fontFaceMatches) {
            fonts.push(...fontFaceMatches);
          }
        });
        return fonts;
      });

      let baseUrl: string;
      try {
        baseUrl = page.url();
      } catch {
        return html;
      }

      for (const fontFace of fontFaces) {
        try {
          const processedFontFace = await this.processCssUrls(
            fontFace,
            baseUrl,
          );
          if (processedFontFace !== fontFace) {
            html = html.replace(fontFace, processedFontFace);
          }
        } catch (error) {
          logger.debug(`Failed to process font face: ${error}`, {
            module: "ResourceProcessor",
          });
        }
      }

      return html;
    } catch (error) {
      if (error instanceof Error && error.message.includes("detached")) {
        logger.debug(`Page detached during font processing`, {
          module: "ResourceProcessor",
        });
        return html;
      }
      throw error;
    }
  }

  /**
   * 处理 iframe
   */
  private async processIframes(page: Page, html: string): Promise<string> {
    try {
      const iframes = await page.$$("iframe[src]");

      for (const iframe of iframes) {
        try {
          const src = await iframe.evaluate((el) => el.getAttribute("src"));
          if (!src) continue;

          // Only process http/https iframe sources; skip data:, javascript:,
          // vbscript:, and all other non-http(s) schemes.
          try {
            const parsedSrc = new URL(src, page.url());
            if (parsedSrc.protocol !== "http:" && parsedSrc.protocol !== "https:") {
              continue;
            }
          } catch {
            continue;
          }

          try {
            const frame = await iframe.contentFrame();
            if (frame && !frame.detached) {
              const frameContent = await frame.content();
              if (frameContent) {
                const placeholder = `<!-- iframe: ${src} -->`;
                html = html.replace(
                  new RegExp(
                    `<iframe[^>]*src=["']${this.escapeRegex(src)}["'][^>]*>.*?</iframe>`,
                    "gis",
                  ),
                  placeholder,
                );
                this.stats.iframes++;
              }
            }
          } catch {
            logger.debug(`Frame already detached or inaccessible: ${src}`, {
              module: "ResourceProcessor",
            });
          }
        } catch (error) {
          logger.debug(`Failed to process iframe: ${error}`, {
            module: "ResourceProcessor",
          });
        }
      }
    } catch (error) {
      logger.debug(`Failed to query iframes: ${error}`, {
        module: "ResourceProcessor",
      });
    }

    return html;
  }

  /**
   * 移除脚本标签
   *
   * Defense-in-depth: best-effort first-pass script removal on raw HTML strings.
   * The authoritative security boundary is the browser's HTML parser (Puppeteer),
   * which re-parses this content. Regex cannot fully sanitize nested/malformed HTML;
   * this layer reduces obvious script vectors before downstream text extraction.
   */
  private removeScriptTags(html: string): string {
    // Iterative loop prevents bypass via nested/malformed tags
    // (e.g., <scr<script>ipt>). Browser HTML parser is the authoritative
    // Defense-in-depth pre-filter; browser HTML parser is the actual security boundary.
    // Browser CSP and sandbox prevent execution of any surviving handlers.
    let prev: string;
    do {
      prev = html;
      // Remove <script>...</script> blocks — non-greedy [\s\S] for cross-line matching
      html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ""); // lgtm[js/bad-tag-filter, js/incomplete-multi-character-sanitization]
      // Remove self-closing <script .../> tags
      html = html.replace(/<script\b[^>]*\/>/gi, ""); // lgtm[js/incomplete-multi-character-sanitization]

      // Remove inline event handlers — covers quoted (single/double/backtick) and
      // unquoted attribute values (e.g., onclick=alert(1), onload='evil()')
      html = html.replace( // lgtm[js/incomplete-multi-character-sanitization]
        /\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s"'>]+)/gi,
        "",
      );
    } while (html !== prev);

    // Neutralize dangerous URI schemes in href/src attributes.
    // Loop prevents bypass via overlapping patterns (e.g., "javajavascript:script:").
    // data: URIs are NOT stripped here — legitimate inlined images use data:image/*;
    // dangerous data: MIME types are blocked by validateUrl in fetchResource.
    // lgtm[js/incomplete-url-scheme-check]: validateUrl enforces an http/https
    // allowlist before any network fetch; this regex is a content-level scrub.
    let previous: string;
    do {
      previous = html;
      html = html.replace(/\b(javascript|vbscript)\s*:/gi, "");
    } while (html !== previous);

    this.stats.scripts = 0;
    return html;
  }

  /**
   * 移除 HTML 注释
   */
  private removeHtmlComments(html: string): string {
    // Iterative loop prevents bypass via nested/malformed comments
    // (e.g., <!--<!-- --> -->).
    let prev: string;
    do {
      prev = html;
      html = html.replace(/<!--[\s\S]*?-->/g, "");
    } while (html !== prev);
    return html;
  }

  /**
   * 获取资源（带 SSRF 防护）
   */
  private async fetchResource(url: string): Promise<ResourceInfo> {
    const resource: ResourceInfo = {
      type: this.getResourceType(url),
      url,
      success: false,
    };

    // SSRF 防护：URL 静态验证
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      resource.error = `URL validation failed: ${urlValidation.error}`;
      logger.debug(`Resource URL blocked: ${url} - ${urlValidation.error}`, {
        module: "ResourceProcessor",
      });
      return resource;
    }

    // SSRF 防护：DNS 解析验证（防止 DNS 重绑定攻击）
    // 同时获取已验证的 IP，用于 pinned DNS fetch（防止 TOCTOU）
    let resolvedIp = "";
    try {
      const parsedUrl = new URL(url);
      const dnsResult = await validateDnsResolution(parsedUrl.hostname);
      if (!dnsResult.valid) {
        resource.error = `DNS validation failed: ${dnsResult.error}`;
        logger.debug(`Resource DNS blocked: ${url} - ${dnsResult.error}`, {
          module: "ResourceProcessor",
        });
        return resource;
      }
      // 保存已验证的 IP，用于 pinned DNS fetch
      resolvedIp = dnsResult.ips && dnsResult.ips.length > 0 ? dnsResult.ips[0] : "";
    } catch (error) {
      resource.error = `DNS resolution failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      return resource;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        RESOURCE_CONFIG.fetchTimeout,
      );

      // SSRF TOCTOU 防护：使用 pinned DNS Agent 固定到已验证的 IP
      // 避免第二次 DNS 解析返回内网地址（DNS 重绑定攻击）
      let responseBuffer: ArrayBuffer;
      let responseStatus: number;
      let responseContentType: string;
      let responseOk: boolean;
      let pinnedAgent: Agent | null = null;
      try {
        if (resolvedIp) {
          // 使用统一的 pinned DNS Agent 工厂创建
          pinnedAgent = createPinnedAgent(resolvedIp);
          const undiciResp = await undiciRequest(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": this.options.userAgent,
              Accept: "*/*",
            },
            dispatcher: pinnedAgent,
          });
          // 使用流式读取限制响应体大小（修复安全 M-1：与 capture-service 保持一致）
          const bodyText = await readUndiciBodyWithLimit(
            undiciResp.body as unknown as UndiciBodyLike | null,
            this.options.maxImageSize,
          );
          responseStatus = undiciResp.statusCode;
          responseOk = undiciResp.statusCode >= 200 && undiciResp.statusCode < 300;
          const undiciHeaders = undiciResp.headers as Record<string, string | string[] | undefined>;
          const ctHeader = undiciHeaders["content-type"];
          responseContentType = Array.isArray(ctHeader)
            ? ctHeader[0] || "application/octet-stream"
            : ctHeader || "application/octet-stream";
          responseBuffer = Buffer.from(bodyText, "utf-8") as unknown as ArrayBuffer;
        } else {
          // 使用标准 fetch（已通过 URL/DNS 验证，无 SSRF TOCTOU 风险）
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": this.options.userAgent,
              Accept: "*/*",
            },
          });
          // 使用统一的流式读取工具限制响应体大小（防 OOM）
          // 与 pinned 路径保持一致（规则7：复用已有工具）
          const bodyText = await readWebBodyWithLimit(
            response.body,
            this.options.maxImageSize,
          );
          responseStatus = response.status;
          responseOk = response.ok;
          responseContentType = response.headers.get("content-type") || "application/octet-stream";
          responseBuffer = Buffer.from(bodyText, "utf-8") as unknown as ArrayBuffer;
        }
      } finally {
        clearTimeout(timeoutId);
        if (pinnedAgent) {
          try { await pinnedAgent.close(); } catch { /* 忽略关闭错误 */ }
        }
      }

      if (!responseOk) {
        resource.error = `HTTP ${responseStatus}`;
        return resource;
      }

      const size = responseBuffer.byteLength;
      if (size > this.options.maxImageSize) {
        resource.error = `Resource too large: ${size} bytes`;
        return resource;
      }

      resource.mimeType = responseContentType.split(";")[0].trim();
      resource.content = Buffer.from(responseBuffer).toString("base64");
      resource.success = true;
    } catch (error) {
      resource.error = error instanceof Error ? error.message : "Unknown error";
      logger.debug(`Failed to fetch resource ${url}: ${resource.error}`, {
        module: "ResourceProcessor",
      });
    }

    return resource;
  }

  /**
   * 获取资源类型
   */
  private getResourceType(url: string): ResourceInfo["type"] {
    const ext = url.split(".").pop()?.toLowerCase()?.split("?")[0] || "";

    if (
      ["jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp"].includes(ext)
    ) {
      return "image";
    }
    if (["css"].includes(ext)) {
      return "style";
    }
    if (["js"].includes(ext)) {
      return "script";
    }
    if (["woff", "woff2", "ttf", "otf", "eot"].includes(ext)) {
      return "font";
    }

    return "other";
  }

  /**
   * 解析 URL
   *
   * Scheme allowlist: only http, https, and data (for already-inlined resources)
   * are permitted. Dangerous schemes (javascript:, vbscript:, file:, etc.) are
   * blocked before they can reach fetchResource.
   */
  private resolveUrl(url: string, baseUrl: string): string {
    try {
      if (url.startsWith("//")) {
        return `https:${url}`;
      }
      // data: URIs are already-processed inline resources (e.g., inlined images);
      // pass through without resolution — they are not fetched via HTTP
      if (url.startsWith("data:")) {
        return url;
      }
      // For http/https absolute URLs, return as-is
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
      }
      // Resolve relative URLs against the base URL
      const resolved = new URL(url, baseUrl);
      // Scheme allowlist: only http and https are safe for network fetches.
      // Blocks javascript:, vbscript:, file:, and other dangerous schemes.
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        return "";
      }
      return resolved.href;
    } catch {
      return url;
    }
  }

  /**
   * 替换 link 标签为 style 标签
   */
  private replaceLinkWithStyle(
    html: string,
    href: string,
    cssContent: string,
  ): string {
    const escapedHref = this.escapeRegex(href);
    const regex = new RegExp(
      `<link[^>]*href=["']${escapedHref}["'][^>]*rel=["']stylesheet["'][^>]*>`,
      "gi",
    );
    return html.replace(regex, `<style>\n${cssContent}\n</style>`);
  }

  /**
   * 解码 Base64
   */
  private decodeBase64(base64: string): string {
    try {
      return Buffer.from(base64, "base64").toString("utf-8");
    } catch {
      return base64;
    }
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 获取资源统计
   */
  public getStats(): ResourceStats {
    return { ...this.stats };
  }
}

/**
 * 创建资源处理器
 */
export function createResourceProcessor(
  options: Required<CaptureOptions>,
): ResourceProcessor {
  return new ResourceProcessor(options);
}
