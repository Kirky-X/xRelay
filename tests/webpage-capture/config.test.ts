/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Webpage Capture Config 测试 - 提升分支覆盖率
 *
 * 覆盖目标（未覆盖分支）：
 * 1. isContainerEnvironment: CONTAINER_ENV / DOCKER_ENV / VERCEL / /.dockerenv 分支
 * 2. getBrowserArgs: 容器环境添加 --no-sandbox
 * 3. mergeCaptureOptions: 无参数 / 有参数 / 部分 viewport 分支
 *
 * 关键约束：BROWSER_CONFIG 在模块加载时计算，需 vi.resetModules + 动态 import
 * 才能在不同环境变量下重新评估 isContainerEnvironment。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 可变的 userAgent mock，便于在不同测试中验证
const { userAgentMock } = vi.hoisted(() => ({
  userAgentMock: {
    getRandomUserAgent: vi.fn(() => "TestUA/1.0"),
  },
}));

vi.mock("../../src/utils/user-agent.js", () => userAgentMock);

// Node.js Module 系统：vi.mock 无法拦截内置模块的 require('fs')，
// 需通过 Module._load 补丁实现。require 在 Vitest Node 环境可用但非 globalThis.require。
// @ts-ignore - require 在 Vitest Node 环境 CJS interop 下可用
const NodeModule = require("module");
type ModuleLoadFn = (request: string, parent: unknown, isMain: boolean) => unknown;
const originalModuleLoad = NodeModule._load as ModuleLoadFn;

describe("webpage-capture/config - mergeCaptureOptions 分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.CONTAINER_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.VERCEL;
  });

  it("无参数时应返回默认值并使用随机 UA（覆盖 line 147）", async () => {
    userAgentMock.getRandomUserAgent.mockReturnValue("RandomUA/2.0");
    const { mergeCaptureOptions } = await import("../../src/webpage-capture/config.js");
    const result = mergeCaptureOptions();
    expect(result.userAgent).toBe("RandomUA/2.0");
    expect(result.mode).toBe("html");
    expect(result.timeout).toBe(30000);
    expect(result.scrollToEnd).toBe(false);
    expect(result.extractArticle).toBe(false);
    expect(userAgentMock.getRandomUserAgent).toHaveBeenCalledTimes(1);
  });

  it("有参数时应合并选项，未指定 userAgent 时使用随机 UA", async () => {
    userAgentMock.getRandomUserAgent.mockReturnValue("RandomUA/3.0");
    const { mergeCaptureOptions } = await import("../../src/webpage-capture/config.js");
    const result = mergeCaptureOptions({
      mode: "full",
      timeout: 5000,
      waitTime: 100,
    });
    expect(result.mode).toBe("full");
    expect(result.timeout).toBe(5000);
    expect(result.waitTime).toBe(100);
    expect(result.userAgent).toBe("RandomUA/3.0");
  });

  it("有参数且指定 userAgent 时不应调用 getRandomUserAgent", async () => {
    userAgentMock.getRandomUserAgent.mockReturnValue("RandomUA/4.0");
    const { mergeCaptureOptions } = await import("../../src/webpage-capture/config.js");
    const result = mergeCaptureOptions({
      userAgent: "CustomUA/9.9",
    });
    expect(result.userAgent).toBe("CustomUA/9.9");
    expect(userAgentMock.getRandomUserAgent).not.toHaveBeenCalled();
  });

  it("viewport 部分提供时应与默认 viewport 合并", async () => {
    const { mergeCaptureOptions } = await import("../../src/webpage-capture/config.js");
    const result = mergeCaptureOptions({
      viewport: { width: 1024 },
    });
    expect(result.viewport.width).toBe(1024);
    // height 应保留默认值 1080
    expect(result.viewport.height).toBe(1080);
  });

  it("viewport 完整提供时应覆盖默认值", async () => {
    const { mergeCaptureOptions } = await import("../../src/webpage-capture/config.js");
    const result = mergeCaptureOptions({
      viewport: { width: 800, height: 600 },
    });
    expect(result.viewport).toEqual({ width: 800, height: 600 });
  });
});

describe("webpage-capture/config - isContainerEnvironment (通过 BROWSER_CONFIG.args 间接验证)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CONTAINER_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.CONTAINER_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.VERCEL;
  });

  it("默认环境（无容器标志）不应添加 --no-sandbox", async () => {
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).not.toContain("--no-sandbox");
    expect(BROWSER_CONFIG.args).not.toContain("--disable-setuid-sandbox");
    // 但应包含基础参数
    expect(BROWSER_CONFIG.args).toContain("--disable-dev-shm-usage");
    expect(BROWSER_CONFIG.args).toContain("--disable-gpu");
  });

  it("CONTAINER_ENV=true 时应添加 --no-sandbox 和 --disable-setuid-sandbox（覆盖 line 26, 71）", async () => {
    process.env.CONTAINER_ENV = "true";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).toContain("--no-sandbox");
    expect(BROWSER_CONFIG.args).toContain("--disable-setuid-sandbox");
  });

  it("DOCKER_ENV=true 时应添加 --no-sandbox（覆盖 line 26）", async () => {
    process.env.DOCKER_ENV = "true";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).toContain("--no-sandbox");
  });

  it("VERCEL=1 时应添加 --no-sandbox（覆盖 line 31）", async () => {
    process.env.VERCEL = "1";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).toContain("--no-sandbox");
  });

  it("CONTAINER_ENV=false 时不应添加 --no-sandbox", async () => {
    process.env.CONTAINER_ENV = "false";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).not.toContain("--no-sandbox");
  });

  it("--no-sandbox 应通过 unshift 放在 args 数组开头", async () => {
    process.env.CONTAINER_ENV = "true";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    // unshift 会把元素放到开头
    expect(BROWSER_CONFIG.args[0]).toBe("--no-sandbox");
    expect(BROWSER_CONFIG.args[1]).toBe("--disable-setuid-sandbox");
  });
});

describe("webpage-capture/config - /.dockerenv 文件检测分支", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CONTAINER_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    // 恢复 Module._load，避免影响后续测试
    NodeModule._load = originalModuleLoad;
    vi.resetModules();
  });

  it("存在 /.dockerenv 文件时应添加 --no-sandbox（覆盖 line 37）", async () => {
    // 通过 Module._load 补丁让 require('fs').existsSync('/.dockerenv') 返回 true
    NodeModule._load = ((request: string, ...args: unknown[]) => {
      if (request === "fs") {
        return { existsSync: (path: string) => path === "/.dockerenv" };
      }
      return originalModuleLoad(request, ...args);
    }) as ModuleLoadFn;
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).toContain("--no-sandbox");
    expect(BROWSER_CONFIG.args).toContain("--disable-setuid-sandbox");
  });

  it("fs.existsSync 抛错时应跳过 dockerenv 检查（catch 分支）", async () => {
    NodeModule._load = ((request: string, ...args: unknown[]) => {
      if (request === "fs") {
        return {
          existsSync: () => {
            throw new Error("fs unavailable");
          },
        };
      }
      return originalModuleLoad(request, ...args);
    }) as ModuleLoadFn;
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    // 应跳过 dockerenv 检查，不添加 --no-sandbox
    expect(BROWSER_CONFIG.args).not.toContain("--no-sandbox");
  });

  it("无 /.dockerenv 文件时不应添加 --no-sandbox", async () => {
    NodeModule._load = ((request: string, ...args: unknown[]) => {
      if (request === "fs") {
        return { existsSync: () => false };
      }
      return originalModuleLoad(request, ...args);
    }) as ModuleLoadFn;
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.args).not.toContain("--no-sandbox");
  });
});

describe("webpage-capture/config - 配置常量导出", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CONTAINER_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.VERCEL;
    delete process.env.CHROME_PATH;
  });

  afterEach(() => {
    delete process.env.CHROME_PATH;
  });

  it("BROWSER_CONFIG 应包含 headless 与 args", async () => {
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.headless).toBe(true);
    expect(Array.isArray(BROWSER_CONFIG.args)).toBe(true);
    expect(BROWSER_CONFIG.args.length).toBeGreaterThan(0);
  });

  it("PAGE_CONFIG 应包含默认 viewport 与 UA", async () => {
    const { PAGE_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(PAGE_CONFIG.defaultViewport.width).toBe(1920);
    expect(PAGE_CONFIG.defaultViewport.height).toBe(1080);
    expect(PAGE_CONFIG.defaultTimeout).toBe(30000);
    expect(PAGE_CONFIG.defaultUserAgent).toMatch(/Mozilla/);
  });

  it("SCROLL_CONFIG 应包含滚动配置常量", async () => {
    const { SCROLL_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(SCROLL_CONFIG.scrollStep).toBe(500);
    expect(SCROLL_CONFIG.scrollDelay).toBe(100);
    expect(SCROLL_CONFIG.maxScrolls).toBe(100);
    expect(SCROLL_CONFIG.afterScrollWait).toBe(1000);
  });

  it("RESOURCE_CONFIG 应包含资源限制配置", async () => {
    const { RESOURCE_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(RESOURCE_CONFIG.maxImageSize).toBe(5 * 1024 * 1024);
    expect(RESOURCE_CONFIG.maxTotalSize).toBe(50 * 1024 * 1024);
    expect(RESOURCE_CONFIG.concurrency).toBe(10);
  });

  it("POOL_CONFIG 应包含浏览器池配置", async () => {
    const { POOL_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(POOL_CONFIG.maxInstances).toBe(3);
    expect(POOL_CONFIG.maxPagesPerInstance).toBe(10);
  });

  it("BROWSER_CONFIG.executablePath 应读取 CHROME_PATH 环境变量", async () => {
    process.env.CHROME_PATH = "/usr/bin/chromium";
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.executablePath).toBe("/usr/bin/chromium");
  });

  it("BROWSER_CONFIG.executablePath 未设置 CHROME_PATH 时应为 undefined", async () => {
    const { BROWSER_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(BROWSER_CONFIG.executablePath).toBeUndefined();
  });

  it("CAPTURE_CONFIG 应聚合所有子配置", async () => {
    const { CAPTURE_CONFIG } = await import("../../src/webpage-capture/config.js");
    expect(CAPTURE_CONFIG.browser).toBeDefined();
    expect(CAPTURE_CONFIG.page).toBeDefined();
    expect(CAPTURE_CONFIG.resources).toBeDefined();
    expect(CAPTURE_CONFIG.pool).toBeDefined();
    expect(CAPTURE_CONFIG.defaults).toBeDefined();
    expect(CAPTURE_CONFIG.scroll).toBeDefined();
  });

  it("DEFAULT_CAPTURE_OPTIONS 应包含所有必需字段", async () => {
    const { DEFAULT_CAPTURE_OPTIONS } = await import("../../src/webpage-capture/config.js");
    expect(DEFAULT_CAPTURE_OPTIONS.mode).toBe("html");
    expect(DEFAULT_CAPTURE_OPTIONS.extractArticle).toBe(false);
    expect(DEFAULT_CAPTURE_OPTIONS.waitTime).toBe(0);
    expect(DEFAULT_CAPTURE_OPTIONS.waitForSelector).toBe("");
    expect(DEFAULT_CAPTURE_OPTIONS.scrollToEnd).toBe(false);
    expect(DEFAULT_CAPTURE_OPTIONS.timeout).toBe(30000);
    expect(DEFAULT_CAPTURE_OPTIONS.resolvedIp).toBe("");
  });
});
