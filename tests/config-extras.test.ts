/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Config 模块补充测试 - enforceProductionConfigOrExit
 *
 * 验证 fail-closed 行为：生产环境配置缺失时调用 process.exit(1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Config - enforceProductionConfigOrExit", () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // mock process.exit 防止真实退出
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code}) called`);
    }) as never;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
  });

  it("非生产环境（NODE_ENV != production 且无 VERCEL）应直接返回不退出", async () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    // 不应抛错
    expect(() => enforceProductionConfigOrExit()).not.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("生产环境 + 缺失 API_KEYS 应调用 process.exit(1)", async () => {
    process.env.VERCEL = "1";
    delete process.env.API_KEYS;
    delete process.env.ENABLE_API_KEY;
    delete process.env.CRON_SECRET;
    delete process.env.CORS_ORIGINS;

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).toThrow("process.exit(1) called");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("生产环境 + 完整配置应不退出", async () => {
    process.env.VERCEL = "1";
    process.env.API_KEYS = "strong-key-32-chars-min-random-string";
    process.env.ENABLE_API_KEY = "true";
    process.env.CRON_SECRET = "strong-cron-secret-32-chars-min-random";
    process.env.CORS_ORIGINS = "https://example.com";

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).not.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("生产环境 + NODE_ENV=production 应识别为生产", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.API_KEYS;
    delete process.env.ENABLE_API_KEY;
    delete process.env.CRON_SECRET;
    delete process.env.CORS_ORIGINS;

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).toThrow("process.exit(1) called");
  });

  it("生产环境 + 仅缺失 CRON_SECRET 应 exit(1)", async () => {
    process.env.VERCEL = "1";
    process.env.API_KEYS = "valid-key";
    process.env.ENABLE_API_KEY = "true";
    delete process.env.CRON_SECRET;
    process.env.CORS_ORIGINS = "https://example.com";

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).toThrow("process.exit(1) called");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("生产环境 + 仅缺失 CORS_ORIGINS 应 exit(1)", async () => {
    process.env.VERCEL = "1";
    process.env.API_KEYS = "valid-key";
    process.env.ENABLE_API_KEY = "true";
    process.env.CRON_SECRET = "valid-cron-secret";
    delete process.env.CORS_ORIGINS;

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).toThrow("process.exit(1) called");
  });

  it("生产环境 + ENABLE_API_KEY != 'true' 应 exit(1)", async () => {
    process.env.VERCEL = "1";
    process.env.API_KEYS = "valid-key";
    process.env.ENABLE_API_KEY = "false"; // 未启用
    process.env.CRON_SECRET = "valid-cron-secret";
    process.env.CORS_ORIGINS = "https://example.com";

    const { enforceProductionConfigOrExit } = await import("../../src/config.js");

    expect(() => enforceProductionConfigOrExit()).toThrow("process.exit(1) called");
  });
});
