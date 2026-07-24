/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint Tests
 * 验证 /api/cron/cleanup 端点的鉴权、方法校验、清理执行与错误处理
 *
 * cleanup.ts 使用 @vercel/node (req, res) 签名，测试构造 mock req/res。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/**
 * 构造 mock VercelRequest（仅包含 handler 用到的字段：method + headers）
 */
function buildRequest(
  init: { method?: string; headers?: Record<string, string> } = {},
): { method: string; headers: Record<string, string> } {
  return {
    method: init.method ?? "POST",
    headers: init.headers ?? {},
  };
}

/**
 * 构造 mock VercelResponse（捕获 status/json/setHeader 调用）
 * 模拟 @vercel/node 的 res 链式 API：res.status(code).json(body)
 */
interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function buildResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status: vi.fn(function (this: MockResponse, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: MockResponse, body: unknown) {
      this.body = body;
      this.headers["content-type"] = "application/json";
    }),
    setHeader: vi.fn(function (this: MockResponse, k: string, v: string) {
      this.headers[k] = v;
    }),
    end: vi.fn(),
  };
  return res;
}

/** 从 mock res 提取首次 res.json(body) 的 body */
function responseBody(res: MockResponse): {
  error?: string;
  success?: boolean;
  deletedCount?: number;
  stats?: unknown;
  timestamp?: string;
} {
  return res.json.mock.calls[0]?.[0] as ReturnType<typeof responseBody>;
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(405);
      expect(responseBody(res).error).toMatch(/method/i);
    });

    it("应该拒绝 DELETE 请求（405）", async () => {
      const req = buildRequest({ method: "DELETE" });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(405);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
    });
  });

  describe("鉴权 - 无 CRON_SECRET", () => {
    it("缺少 x-vercel-cron header 时应返回 401", async () => {
      const req = buildRequest({ method: "POST" });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(401);
      expect(responseBody(res).error).toMatch(/unauthorized/i);
      expect(runCleanupMock).not.toHaveBeenCalled();
    });

    it("x-vercel-cron=false 时应返回 401", async () => {
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "false" },
      });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(401);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
      expect(runCleanupMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("鉴权 - 配置了 CRON_SECRET", () => {
    beforeEach(() => {
      process.env.CRON_SECRET = "super-secret-token";
    });

    it("外部调用缺少 Authorization header 时应返回 401", async () => {
      // 不带 x-vercel-cron（非 Vercel 平台调用）+ 无 Bearer → 拒绝
      const req = buildRequest({ method: "POST" });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(401);
      expect(runCleanupMock).not.toHaveBeenCalled();
    });

    it("Vercel 平台 cron (x-vercel-cron: true) 即使无 Bearer 也应通过", async () => {
      // Vercel 定时任务无法携带 Authorization，必须信任 x-vercel-cron 才能让每日清理生效
      runCleanupMock.mockResolvedValue({
        deletedCount: 1,
        stats: { total: 3, expired: 1, recent: 2 },
      });
      const req = buildRequest({
        method: "POST",
        headers: { "x-vercel-cron": "true" },
      });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
      expect(runCleanupMock).toHaveBeenCalledTimes(1);
    });

    it("Authorization 不匹配时应返回 401", async () => {
      const req = buildRequest({
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      });
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(401);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);

      const body = responseBody(res);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(200);
      const body = responseBody(res);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(500);
      const body = responseBody(res);
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
      const res = buildResponse();
      await handler(req as never, res as never);
      expect(res.statusCode).toBe(500);
      const body = responseBody(res);
      expect(body.error).toBe("Unknown error");
    });
  });
});
