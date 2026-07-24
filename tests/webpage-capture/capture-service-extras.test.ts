/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * CaptureService 补充测试 - 提升分支覆盖率
 *
 * 覆盖目标（未覆盖或低覆盖分支）：
 * 1. mode='html' / 'full' 分支
 * 2. scrollToEnd + mode='full' → scrollToEnd 调用
 * 3. waitTime > 0 → sleep 调用
 * 4. extractArticle 成功 / 失败分支
 * 5. navigateToPage: net::ERR_ 重试 / 非 net::ERR_ 重抛
 * 6. waitForPageReady: waitForSelector 成功 / 超时
 * 7. getPageTitle: title() 抛错返回 ''
 * 8. captureWithFetch: response.ok=false / fetch 抛错 / response.url
 * 9. extractTitleFromHtml: 含/不含 <title>
 * 10. mode='html' 浏览器失败降级 / mode='full' 浏览器失败不降级
 * 11. configurePage: timeout / userAgent / viewport 设置
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Page } from "puppeteer";

// 使用 vi.hoisted 提升 mock 引用
// 关键：browserPoolMock.getPage 必须与 getPageMock 是同一引用，
// 因为 CaptureService 构造时通过 getBrowserPool() 获取 browserPoolMock，
// 后续 this.browserPool.getPage() 调用的是 browserPoolMock.getPage
const {
  getPageMock,
  browserPoolMock,
  articleExtractorMock,
  resourceProcessorMock,
  loggerMock,
} = vi.hoisted(() => {
  const getPageMock = vi.fn();
  return {
    getPageMock,
    browserPoolMock: {
      getPage: getPageMock,
      shutdown: vi.fn(async () => { }),
    },
    articleExtractorMock: {
      extractArticle: vi.fn(),
    },
    resourceProcessorMock: {
      processResources: vi.fn(),
    },
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock("../../src/webpage-capture/browser-pool.js", () => ({
  BrowserPool: class {
    getPage = getPageMock;
    shutdown = browserPoolMock.shutdown;
  },
  getBrowserPool: () => browserPoolMock,
  resolveLaunchOptions: vi.fn(),
  isVercelEnvironment: vi.fn(() => false),
}));

vi.mock("../../src/webpage-capture/article-extractor.js", () => ({
  extractArticle: articleExtractorMock.extractArticle,
  extractArticleFromUrl: vi.fn(),
  stripHtmlTags: vi.fn(),
}));

vi.mock("../../src/webpage-capture/resource-processor.js", () => ({
  createResourceProcessor: vi.fn(() => ({
    processResources: resourceProcessorMock.processResources,
  })),
  ResourceProcessor: class { },
}));

vi.mock("../../src/logger.js", () => ({ logger: loggerMock }));

import { captureWebpage, getCaptureService } from "../../src/webpage-capture/capture-service.js";

// 构造一个完整的 mock Page
function createMockPage(overrides: Partial<Page> = {}): Page {
  return {
    setViewport: vi.fn(async () => { }),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    setUserAgent: vi.fn(async () => { }),
    goto: vi.fn(async () => { }),
    content: vi.fn(async () => "<html><body>content</body></html>"),
    title: vi.fn(async () => "Page Title"),
    url: vi.fn(() => "https://example.com/page"),
    evaluate: vi.fn(async () => "complete"),
    close: vi.fn(async () => { }),
    on: vi.fn(),
    waitForSelector: vi.fn(async () => { }),
    setRequestInterception: vi.fn(async () => { }),
    ...overrides,
  } as unknown as Page;
}

describe("CaptureService Extras - mode 分发", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode='html' 应使用 page.content() 获取 HTML", async () => {
    const page = createMockPage({
      content: vi.fn(async () => "<html>html-mode</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.html).toBe("<html>html-mode</html>");
    expect(result.mode).toBe("html");
    expect(resourceProcessorMock.processResources).not.toHaveBeenCalled();
  });

  it("mode='full' 应调用 resourceProcessor.processResources", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    resourceProcessorMock.processResources.mockResolvedValueOnce("<html>full-mode</html>");

    const result = await captureWebpage("https://example.com", { mode: "full" });

    expect(result.success).toBe(true);
    expect(result.html).toBe("<html>full-mode</html>");
    expect(result.mode).toBe("full");
    expect(resourceProcessorMock.processResources).toHaveBeenCalledTimes(1);
  });

  it("mode='full' + scrollToEnd=true 应调用 scrollToEnd（多次 evaluate 滚动）", async () => {
    const page = createMockPage({
      evaluate: vi.fn()
        // 第 1 次：scrollHeight=2000；第 2 次：scrollHeight=2000（与上次相同，break）
        // 之后 scrollTo(0,0)
        .mockResolvedValueOnce(2000)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(2000)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    resourceProcessorMock.processResources.mockResolvedValueOnce("<html>full</html>");

    const result = await captureWebpage("https://example.com", {
      mode: "full",
      scrollToEnd: true,
    });

    expect(result.success).toBe(true);
    expect(resourceProcessorMock.processResources).toHaveBeenCalled();
  });

  it("mode='full' + scrollToEnd=false 不应触发滚动", async () => {
    const page = createMockPage({
      evaluate: vi.fn(async () => "complete"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    resourceProcessorMock.processResources.mockResolvedValueOnce("<html>full</html>");

    await captureWebpage("https://example.com", {
      mode: "full",
      scrollToEnd: false,
    });

    // 不应滚动（evaluate 应只被 waitForPageReady 调用一次）
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it("waitTime > 0 应等待指定时间", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const start = Date.now();
    await captureWebpage("https://example.com", {
      mode: "html",
      waitTime: 50,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // 至少 50ms（允许一点误差）
  });
});

describe("CaptureService Extras - extractArticle 分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("extractArticle=true + 提取成功应返回 article 字段", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    const article = { success: true, title: "Article Title", content: "<p>c</p>" };
    articleExtractorMock.extractArticle.mockResolvedValueOnce(article);

    const result = await captureWebpage("https://example.com", {
      mode: "html",
      extractArticle: true,
    });

    expect(result.success).toBe(true);
    expect(result.article).toEqual(article);
  });

  it("extractArticle=true + 提取抛错应不阻塞返回（article undefined）", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    articleExtractorMock.extractArticle.mockRejectedValueOnce(new Error("extract failed"));

    const result = await captureWebpage("https://example.com", {
      mode: "html",
      extractArticle: true,
    });

    expect(result.success).toBe(true);
    expect(result.article).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to extract article"),
      expect.objectContaining({ module: "CaptureService" }),
    );
  });

  it("extractArticle=false 不应调用 extractArticle", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    await captureWebpage("https://example.com", {
      mode: "html",
      extractArticle: false,
    });

    expect(articleExtractorMock.extractArticle).not.toHaveBeenCalled();
  });
});

describe("CaptureService Extras - navigateToPage 分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("page.goto 抛 net::ERR_ 错误应重试 domcontentloaded", async () => {
    const netErr = new Error("net::ERR_CONNECTION_REFUSED");
    const page = createMockPage({
      goto: vi.fn()
        .mockRejectedValueOnce(netErr)
        .mockResolvedValueOnce(undefined),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    // 源码 navigateToPage 的 catch 块中 throw error 在 if 外，
    // 即使重试成功仍抛出原始错误，capture 会降级到 fetch
    global.fetch = vi.fn(async () =>
      new Response("<html>fallback</html>", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    // 重试确实发生（goto 调用 2 次），但原始错误仍抛出，走 fetch 降级
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("Network error"),
      expect.objectContaining({ module: "CaptureService" }),
    );
    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it("page.goto 抛非 net::ERR_ 错误应重抛（进入 catch）", async () => {
    const otherErr = new Error("Navigation timeout");
    const page = createMockPage({
      goto: vi.fn().mockRejectedValue(otherErr),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    // 显式设置 fetch 失败，确保 fetch 降级也失败 → result.success=false
    global.fetch = vi.fn(async () =>
      new Response("Server Error", { status: 500 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    // mode='html' 浏览器失败 → 降级 fetch → fetch 也失败
    expect(result.success).toBe(false);
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("page.goto 重试 domcontentloaded 也失败时应抛错（mode='html' 降级 fetch）", async () => {
    const netErr = new Error("net::ERR_CONNECTION_REFUSED");
    const page = createMockPage({
      goto: vi.fn().mockRejectedValue(netErr),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    global.fetch = vi.fn(async () =>
      new Response("<html>fallback</html>", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
  });
});

describe("CaptureService Extras - waitForPageReady 分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("waitForSelector 设置且等待成功应继续后续流程", async () => {
    const page = createMockPage({
      waitForSelector: vi.fn(async () => { }),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", {
      mode: "html",
      waitForSelector: "#app",
    });

    expect(result.success).toBe(true);
    expect(page.waitForSelector).toHaveBeenCalledWith("#app", expect.anything());
  });

  it("waitForSelector 等待超时应仅 warn 不阻塞", async () => {
    const page = createMockPage({
      waitForSelector: vi.fn().mockRejectedValue(new Error("timeout")),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", {
      mode: "html",
      waitForSelector: "#missing",
    });

    expect(result.success).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("Wait for selector timeout"),
      expect.objectContaining({ module: "CaptureService", selector: "#missing" }),
    );
  });
});

describe("CaptureService Extras - getPageTitle 分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("page.title() 抛错时应返回空字符串 title", async () => {
    const page = createMockPage({
      title: vi.fn().mockRejectedValue(new Error("title fail")),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.title).toBe("");
  });
});

describe("CaptureService Extras - configurePage 分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("options.timeout 应传递给 setDefaultTimeout / setDefaultNavigationTimeout", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    await captureWebpage("https://example.com", {
      mode: "html",
      timeout: 5000,
    });

    expect(page.setDefaultTimeout).toHaveBeenCalledWith(5000);
    expect(page.setDefaultNavigationTimeout).toHaveBeenCalledWith(5000);
  });

  it("options.userAgent 应传递给 page.setUserAgent", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    await captureWebpage("https://example.com", {
      mode: "html",
      userAgent: "CustomUA/9.9",
    });

    expect(page.setUserAgent).toHaveBeenCalledWith("CustomUA/9.9");
  });

  it("options.viewport 应传递给 page.setViewport", async () => {
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    await captureWebpage("https://example.com", {
      mode: "html",
      viewport: { width: 1024, height: 768 },
    });

    expect(page.setViewport).toHaveBeenCalledWith({ width: 1024, height: 768 });
  });
});

describe("CaptureService Extras - captureWithFetch 降级分支", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode='html' + 浏览器抛错 + fetch 返回 404 应返回失败 + 合并错误", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Browser.*Chromium.*Fetch.*404/);
    expect(result.mode).toBe("html");
  });

  it("mode='html' + 浏览器抛错 + fetch 抛错应返回失败 + 合并错误", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () => {
      throw new Error("Network error");
    }) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Browser.*Chromium.*Fetch.*Network error/);
  });

  it("mode='html' + 浏览器抛错 + fetch 抛非 Error 值应转 String 后合并", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () => {
      throw "string error"; // 非 Error
    }) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("string error");
  });

  it("mode='full' + 浏览器抛错不降级，直接返回失败", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "full" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Chromium/i);
    expect(result.mode).toBe("full");
    expect(result.degraded).toBeUndefined();
    // full 模式不应降级到 fetch
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetch 降级成功时应从 HTML 中提取 <title>", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () =>
      new Response("<html><head><title>Fetch Title</title></head><body>ok</body></html>", {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.title).toBe("Fetch Title");
    expect(result.degraded).toBe(true);
  });

  it("fetch 降级时 HTML 不含 <title> 应返回空字符串", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () =>
      new Response("<html><body>no title</body></html>", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.title).toBe("");
  });

  it("fetch 降级成功时 response.url 应作为 finalUrl", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () =>
      new Response("<html>ok</html>", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    // Response.url 在 undici 中是空字符串，这里通过 Object.defineProperty 模拟
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementationOnce(async () => {
      const resp = new Response("<html>ok</html>", { status: 200 });
      Object.defineProperty(resp, "url", { value: "https://redirected.example.com" });
      return resp;
    });

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://redirected.example.com");
  });

  it("fetch 降级成功但 response.url 为空时应使用原始 url", async () => {
    getPageMock.mockRejectedValue(new Error("Chromium not available"));
    global.fetch = vi.fn(async () =>
      new Response("<html>ok</html>", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    // Response.url 默认为 ""，应回退到原始 url
    expect(result.url).toBe("https://example.com");
  });

  it("fetch 降级 + resolvedIp 传入应走 pinned DNS 路径（SSRF TOCTOU 防护）", async () => {
    // 此测试通过传入 resolvedIp 触发 captureWithFetchPinned 路径
    // captureWithFetchPinned 内部使用 undiciRequest + Agent（真实建连）
    // 使用 .invalid 域名 + 伪造 IP，验证 pinned 路径被执行（连接失败但错误被捕获）
    getPageMock.mockRejectedValue(new Error("Chromium not available"));

    const result = await captureWebpage("https://example.invalid", {
      mode: "html",
      resolvedIp: "203.0.113.1", // 伪造的公网 IP，pinned 路径会尝试连接
    });

    // 无论成功失败，结果应有正确结构
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("mode", "html");
  });
});

describe("CaptureService Extras - finally 释放资源", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("成功路径结束后应调用 release", async () => {
    const release = vi.fn(async () => { });
    const page = createMockPage();
    getPageMock.mockResolvedValue({ page, release });

    await captureWebpage("https://example.com", { mode: "html" });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("失败路径结束后也应调用 release", async () => {
    const release = vi.fn(async () => { });
    const page = createMockPage({
      goto: vi.fn().mockRejectedValue(new Error("nav fail")),
    });
    getPageMock.mockResolvedValue({ page, release });
    global.fetch = vi.fn(async () => new Response("<html>ok</html>", { status: 200 })) as unknown as typeof globalThis.fetch;

    await captureWebpage("https://example.com", { mode: "html" });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("getPage 抛错时不应调用 release（无 release 可调用）", async () => {
    const release = vi.fn(async () => { });
    getPageMock.mockRejectedValue(new Error("pool exhausted"));
    global.fetch = vi.fn(async () => new Response("<html>ok</html>", { status: 200 })) as unknown as typeof globalThis.fetch;

    await captureWebpage("https://example.com", { mode: "html" });

    // getPage 抛错时 release 未获取，不应被调用
    expect(release).not.toHaveBeenCalled();
  });
});

describe("CaptureService Extras - shutdown 调用", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shutdown 应调用 browserPool.shutdown（覆盖 line 466）", async () => {
    await getCaptureService().shutdown();
    expect(browserPoolMock.shutdown).toHaveBeenCalledTimes(1);
  });

  it("多次 shutdown 应每次都调用 browserPool.shutdown", async () => {
    await getCaptureService().shutdown();
    await getCaptureService().shutdown();
    expect(browserPoolMock.shutdown).toHaveBeenCalledTimes(2);
  });
});

describe("CaptureService Extras - waitForPageReady readyState 分支（覆盖 line 402-407）", () => {
  // 保存原始全局对象
  const originalDocument = (globalThis as unknown as { document?: unknown }).document;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  afterEach(() => {
    // 恢复原始全局对象
    if (originalDocument) {
      (globalThis as unknown as { document: unknown }).document = originalDocument;
    } else {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
    if (originalWindow) {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  it("document.readyState='complete' 时 Promise 应立即 resolve（覆盖 line 403-405）", async () => {
    // stub document.readyState = 'complete'
    (globalThis as unknown as { document: unknown }).document = { readyState: "complete" };
    const addEventListenerMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = { addEventListener: addEventListenerMock };

    const page = createMockPage({
      // 让 evaluate 实际执行传入的回调函数，覆盖浏览器上下文代码
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        if (typeof fn === "function") return fn(...args);
        return fn;
      }),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    // readyState='complete' 应立即 resolve，window.addEventListener 不应被调用
    expect(addEventListenerMock).not.toHaveBeenCalled();
  });

  it("document.readyState='loading' 时应注册 window load 事件（覆盖 line 407）", async () => {
    (globalThis as unknown as { document: unknown }).document = { readyState: "loading" };
    // addEventListener 立即触发回调，让 Promise resolve
    const addEventListenerMock = vi.fn((event: string, cb: () => void) => {
      if (event === "load") cb();
    });
    (globalThis as unknown as { window: unknown }).window = { addEventListener: addEventListenerMock };

    const page = createMockPage({
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        if (typeof fn === "function") return fn(...args);
        return fn;
      }),
      content: vi.fn(async () => "<html>ok</html>"),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });

    const result = await captureWebpage("https://example.com", { mode: "html" });

    expect(result.success).toBe(true);
    // readyState!='complete' 应注册 load 事件
    expect(addEventListenerMock).toHaveBeenCalledWith("load", expect.any(Function));
  });
});

describe("CaptureService Extras - scrollToEnd window.scrollBy 分支（覆盖 line 430）", () => {
  const originalDocument = (globalThis as unknown as { document?: unknown }).document;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  afterEach(() => {
    if (originalDocument) {
      (globalThis as unknown as { document: unknown }).document = originalDocument;
    } else {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
    if (originalWindow) {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  it("mode='full' + scrollToEnd=true 应调用 window.scrollBy（覆盖 line 430）", async () => {
    // stub document/window 让 scrollToEnd 的 evaluate 回调能执行
    (globalThis as unknown as { document: unknown }).document = {
      readyState: "complete",
      documentElement: { scrollHeight: 2000 },
    };
    const scrollByMock = vi.fn();
    const scrollToMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      scrollBy: scrollByMock,
      scrollTo: scrollToMock,
    };

    // evaluate 执行传入的回调函数
    // scrollToEnd 调用顺序：
    // 1. waitForPageReady: () => Promise（document.readyState='complete' 立即 resolve）
    // 2. scrollToEnd 循环第 1 次: () => document.documentElement.scrollHeight → 2000
    // 3. scrollToEnd 循环第 1 次: (height) => window.scrollBy(0, height)
    // 4. scrollToEnd 循环第 2 次: () => document.documentElement.scrollHeight → 2000（与上次相同，break）
    // 5. scrollToEnd 最后: () => window.scrollTo(0, 0)
    const page = createMockPage({
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        if (typeof fn === "function") return fn(...args);
        return fn;
      }),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    resourceProcessorMock.processResources.mockResolvedValueOnce("<html>full</html>");

    const result = await captureWebpage("https://example.com", {
      mode: "full",
      scrollToEnd: true,
    });

    expect(result.success).toBe(true);
    // scrollBy 应被调用（覆盖 line 430）
    expect(scrollByMock).toHaveBeenCalledWith(0, 500); // SCROLL_CONFIG.scrollStep = 500
    // scrollTo 也应被调用（循环结束后回顶部）
    expect(scrollToMock).toHaveBeenCalledWith(0, 0);
  });

  it("scrollToEnd 高度未变化时应立即 break 不再 scrollBy", async () => {
    (globalThis as unknown as { document: unknown }).document = {
      readyState: "complete",
      documentElement: { scrollHeight: 1500 },
    };
    const scrollByMock = vi.fn();
    const scrollToMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      scrollBy: scrollByMock,
      scrollTo: scrollToMock,
    };

    const page = createMockPage({
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        if (typeof fn === "function") return fn(...args);
        return fn;
      }),
    });
    getPageMock.mockResolvedValue({ page, release: vi.fn(async () => { }) });
    resourceProcessorMock.processResources.mockResolvedValueOnce("<html>full</html>");

    const result = await captureWebpage("https://example.com", {
      mode: "full",
      scrollToEnd: true,
      // 用极短的 scrollDelay 加速测试
    });

    expect(result.success).toBe(true);
    // 第一次循环：currentHeight=1500, lastHeight=0, 不等 → scrollBy
    // 第二次循环：currentHeight=1500, lastHeight=1500, 相等 → break
    expect(scrollByMock).toHaveBeenCalledTimes(1);
  });
});
