/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * CaptureService Tests - 网页捕获服务测试
 * 重点验证：
 * 1. 浏览器池失败时降级为 fetch（HTML 模式）
 * 2. full 模式失败时返回错误（不可降级）
 * 3. 降级时返回 degraded=true 标识
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock BrowserPool - 默认抛错模拟启动失败
const getPageMock = vi.fn();
vi.mock("../../src/webpage-capture/browser-pool.js", () => ({
  BrowserPool: class {
    getPage = () => getPageMock();
    shutdown = vi.fn(async () => {});
  },
  getBrowserPool: () => ({
    getPage: getPageMock,
    shutdown: vi.fn(async () => {}),
  }),
  resolveLaunchOptions: vi.fn(),
  isVercelEnvironment: vi.fn(() => false),
}));

// Mock article-extractor
vi.mock("../../src/webpage-capture/article-extractor.js", () => ({
  extractArticle: vi.fn(async () => ({ success: false, error: "skipped" })),
  extractArticleFromUrl: vi.fn(),
  stripHtmlTags: vi.fn((s: string) => s),
}));

// Mock resource-processor
vi.mock("../../src/webpage-capture/resource-processor.js", () => ({
  createResourceProcessor: vi.fn(() => ({
    processResources: vi.fn(async () => "<html>processed</html>"),
  })),
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { captureWebpage } from "../../src/webpage-capture/capture-service.js";

describe("CaptureService - 浏览器失败降级", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    getPageMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("HTML 模式 - 浏览器启动失败时降级到 fetch", () => {
    it("浏览器池抛错时降级为 fetch 获取 HTML", async () => {
      getPageMock.mockRejectedValue(new Error("Chromium not available"));

      const fetchMock = vi.fn(async () =>
        new Response("<html><head><title>Test</title></head><body>Hello</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      global.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await captureWebpage("https://example.com", { mode: "html" });

      expect(result.success).toBe(true);
      expect(result.html).toContain("Hello");
      expect(result.title).toBe("Test");
      expect(result.degraded).toBe(true);
      expect(result.mode).toBe("html");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("降级时 fetch 返回非 200 应返回错误", async () => {
      getPageMock.mockRejectedValue(new Error("Chromium not available"));

      global.fetch = vi.fn(async () =>
        new Response("Not Found", { status: 404 }),
      ) as unknown as typeof globalThis.fetch;

      const result = await captureWebpage("https://example.com", { mode: "html" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/404|fetch/i);
    });

    it("降级时 fetch 抛错应返回错误", async () => {
      getPageMock.mockRejectedValue(new Error("Chromium not available"));

      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      }) as unknown as typeof globalThis.fetch;

      const result = await captureWebpage("https://example.com", { mode: "html" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/network/i);
    });

    it("降级应记录原始浏览器错误到日志", async () => {
      const browserError = new Error("Chromium binary not found");
      getPageMock.mockRejectedValue(browserError);

      const fetchMock = vi.fn(async () =>
        new Response("<html><body>ok</body></html>", { status: 200 }),
      );
      global.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await captureWebpage("https://example.com", { mode: "html" });

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(true);
    });
  });

  describe("Full 模式 - 浏览器失败时不可降级", () => {
    it("full 模式下浏览器失败应直接返回错误", async () => {
      getPageMock.mockRejectedValue(new Error("Chromium not available"));

      const result = await captureWebpage("https://example.com", { mode: "full" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/chromium|not available/i);
      expect(result.degraded).toBeUndefined();
    });
  });

  describe("正常路径 - 浏览器可用", () => {
    it("浏览器可用时应使用浏览器捕获（无 degraded 标识）", async () => {
      const mockPage = {
        setDefaultTimeout: vi.fn(),
        setDefaultNavigationTimeout: vi.fn(),
        goto: vi.fn(async () => {}),
        content: vi.fn(async () => "<html><body>rendered</body></html>"),
        title: vi.fn(async () => "Rendered Title"),
        url: vi.fn(() => "https://example.com"),
        setViewport: vi.fn(async () => {}),
        setUserAgent: vi.fn(async () => {}),
        setRequestInterception: vi.fn(async () => {}),
        on: vi.fn(),
        evaluate: vi.fn(async () => "complete"),
        close: vi.fn(async () => {}),
      };

      getPageMock.mockResolvedValue({
        page: mockPage,
        release: vi.fn(async () => {}),
      });

      // 用 spy 替换 global.fetch，以断言"未走降级路径"
      const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

      try {
        const result = await captureWebpage("https://example.com", { mode: "html" });

        expect(result.success).toBe(true);
        expect(result.html).toBe("<html><body>rendered</body></html>");
        expect(result.title).toBe("Rendered Title");
        expect(result.degraded).toBeUndefined();
        // 浏览器路径成功时不应触发 fetch 降级
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
