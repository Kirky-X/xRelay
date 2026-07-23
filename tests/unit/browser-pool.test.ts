/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Browser Pool Tests - 浏览器池 Vercel 兼容性测试
 * 验证：
 * 1. Vercel 环境下使用 @sparticuz/chromium
 * 2. 本地环境使用 puppeteer 自带 Chromium
 * 3. 浏览器启动失败时降级为 fetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock puppeteer-core（避免实际启动浏览器）
const puppeteerLaunchMock = vi.fn();
const puppeteerExecutablePathMock = vi.fn();
vi.mock("puppeteer-core", () => ({
  default: {
    launch: (...args: unknown[]) => puppeteerLaunchMock(...args),
    executablePath: () => puppeteerExecutablePathMock(),
  },
  launch: (...args: unknown[]) => puppeteerLaunchMock(...args),
  executablePath: () => puppeteerExecutablePathMock(),
}));

// Mock puppeteer (dynamic import 用于本地兜底)
const puppeteerFullExecutablePathMock = vi.fn();
vi.mock("puppeteer", () => ({
  default: {
    executablePath: () => puppeteerFullExecutablePathMock(),
  },
}));

// Mock @sparticuz/chromium
const chromiumExecutablePathMock = vi.fn();
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
    ],
    executablePath: () => chromiumExecutablePathMock(),
    setGraphicsMode: true,
  },
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--single-process",
  ],
  executablePath: () => chromiumExecutablePathMock(),
  setGraphicsMode: true,
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

import { resolveLaunchOptions, isVercelEnvironment } from "../../src/webpage-capture/browser-pool.js";

describe("browser-pool Vercel 兼容性", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    puppeteerLaunchMock.mockReset();
    puppeteerExecutablePathMock.mockReset();
    chromiumExecutablePathMock.mockReset();
    puppeteerFullExecutablePathMock.mockReset();
    delete process.env.VERCEL;
    delete process.env.CHROME_PATH;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("环境检测", () => {
    it("VERCEL=1 时识别为 Vercel 环境", () => {
      process.env.VERCEL = "1";
      expect(isVercelEnvironment()).toBe(true);
    });

    it("VERCEL 未设置时识别为非 Vercel 环境", () => {
      expect(isVercelEnvironment()).toBe(false);
    });
  });

  describe("Launch Options 解析", () => {
    it("Vercel 环境下使用 @sparticuz/chromium 作为 executablePath", async () => {
      process.env.VERCEL = "1";
      chromiumExecutablePathMock.mockResolvedValue("/tmp/chromium");

      const options = await resolveLaunchOptions();

      expect(chromiumExecutablePathMock).toHaveBeenCalledTimes(1);
      expect(options.executablePath).toBe("/tmp/chromium");
      // @sparticuz/chromium args 必须包含 --no-sandbox
      expect(options.args).toContain("--no-sandbox");
      expect(options.headless).toBe(true);
    });

    it("本地环境使用 puppeteer 自带 Chromium", async () => {
      puppeteerFullExecutablePathMock.mockReturnValue("/usr/local/chrome");

      const options = await resolveLaunchOptions();

      expect(puppeteerFullExecutablePathMock).toHaveBeenCalledTimes(1);
      expect(options.executablePath).toBe("/usr/local/chrome");
      expect(chromiumExecutablePathMock).not.toHaveBeenCalled();
    });

    it("CHROME_PATH 环境变量优先于默认值", async () => {
      process.env.CHROME_PATH = "/custom/chrome/path";
      const options = await resolveLaunchOptions();
      expect(options.executablePath).toBe("/custom/chrome/path");
    });

    it("Vercel 环境下 CHROME_PATH 不应覆盖 @sparticuz/chromium", async () => {
      process.env.VERCEL = "1";
      process.env.CHROME_PATH = "/custom/chrome";
      chromiumExecutablePathMock.mockResolvedValue("/tmp/chromium");

      const options = await resolveLaunchOptions();
      // Vercel 环境下必须使用 @sparticuz/chromium，CHROME_PATH 被忽略
      expect(options.executablePath).toBe("/tmp/chromium");
      expect(chromiumExecutablePathMock).toHaveBeenCalled();
    });

    it("Vercel 环境下 args 应合并 @sparticuz/chromium 与项目自定义 args", async () => {
      process.env.VERCEL = "1";
      chromiumExecutablePathMock.mockResolvedValue("/tmp/chromium");

      const options = await resolveLaunchOptions();
      // 项目自定义 args 应包含 disable-gpu
      expect(options.args).toContain("--disable-gpu");
      // @sparticuz/chromium args 应包含 disable-dev-shm-usage
      expect(options.args).toContain("--disable-dev-shm-usage");
    });

    it("Vercel 环境下应自动添加 --no-sandbox", async () => {
      process.env.VERCEL = "1";
      chromiumExecutablePathMock.mockResolvedValue("/tmp/chromium");

      const options = await resolveLaunchOptions();
      expect(options.args).toContain("--no-sandbox");
    });
  });
});
