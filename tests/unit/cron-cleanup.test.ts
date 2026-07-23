/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint Tests
 * 验证 /api/cron/cleanup 端点的鉴权、方法校验、清理执行与错误处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request as NodeRequest } from "undici";

// Mock runCleanup，避免依赖真实数据库
const runCleanupMock = vi.fn();
vi.mock("../../src/database/cleanup.js", () => ({
  runCleanup: (...args: unknown[]) => runCleanupMock(...args),
}));

// Mock logger（避免污染测试输出）
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import handler from "../../api/cron/cleanup.js";

function buildRequest(
  init: Partial<RequestInit> & {
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const method = init.method ?? "POST";
  const headers = new Headers(init.headers ?? {});
  return new Request("http://localhost/api/cron/cleanup", {
    method,
    headers,
    body: init.body,
  });
}

describe("api/cron/cleanup", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    runCleanupMock.mockReset();
    // 默认无 CRON_SECRET，使用 x-vercel-cron 标识
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("方法校验", () => {
    it("应该拒绝 PUT 请求（405）", async () => {
      const req = buildRequest({ method: "PUT" });
      const res = await handler(req);
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error).toMatch(/method/i);
    });

    it("应该拒绝 DELETE 请求（405）", async () => {
      const req = buildRequest({ method: "DELETE" });
      const res = await handler(req);
      expect(res.status).toBe(405);
    });

    it("应该接受 POST 请求（鉴权通过后）", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
    });

    it("应该接受 GET 请求（用于手动触发/调试）", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
      const req = buildRequest({
        method: "GET",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
    });
  });

  describe("鉴权 - 无 CRON_SECRET", () => {
    it("缺少 x-vercel-cron header 时应返回 401", async () => {
      const req = buildRequest({ method: "POST" });
      const res = await handler(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/unauthorized/i);
      expect(runCleanupMock).not.toHaveBeenCalled();
    });

    it("x-vercel-cron=false 时应返回 401", async () => {
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "false" },
      });
      const res = await handler(req);
      expect(res.status).toBe(401);
      expect(runCleanupMock).not.toHaveBeenCalled();
    });

    it("x-vercel-cron=true 时应通过并执行清理", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 5,
        stats: { total: 12, expired: 3, recent: 9 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(runCleanupMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("鉴权 - 配置了 CRON_SECRET", () => {
    beforeEach(() => {
      process.env.CRON_SECRET = "super-secret-token";
    });

    it("缺少 Authorization header 时应返回 401", async () => {
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" }, // 有 cron 标识但无 secret
      });
      const res = await handler(req);
      expect(res.status).toBe(401);
      expect(runCleanupMock).not.toHaveBeenCalled();
    });

    it("Authorization 不匹配时应返回 401", async () => {
      const req = buildRequest({
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      });
      const res = await handler(req);
      expect(res.status).toBe(401);
    });

    it("Authorization 匹配时应通过并执行清理", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 2,
        stats: { total: 5, expired: 2, recent: 3 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { authorization: "Bearer super-secret-token" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(runCleanupMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("清理结果", () => {
    it("成功时返回 200 + 清理统计", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 7,
        stats: { total: 20, expired: 7, recent: 13 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deletedCount).toBe(7);
      expect(body.stats).toEqual({ total: 20, expired: 7, recent: 13 });
      expect(body.timestamp).toBeTruthy();
    });

    it("runCleanup 返回 0 时仍返回 200（无可清理项是正常情况）", async () => {
      runCleanupMock.mockResolvedValue({
        deletedCount: 0,
        stats: { total: 0, expired: 0, recent: 0 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deletedCount).toBe(0);
    });
  });

  describe("错误处理", () => {
    it("runCleanup 抛错时返回 500 + 错误信息", async () => {
      runCleanupMock.mockRejectedValue(new Error("DB connection lost"));
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe("DB connection lost");
      expect(body.timestamp).toBeTruthy();
    });

    it("runCleanup 抛非 Error 对象时返回 500 + Unknown error", async () => {
      runCleanupMock.mockRejectedValue("string error");
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = await handler(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Unknown error");
    });
  });
});
