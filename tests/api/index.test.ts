/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * API 入口层 IO 适配测试
 * 覆盖 api/index.ts 的 buildContext / applyResponse / handler
 *
 * 全部依赖 mock，不调用真实 dispatchRequest / getClientIp / generateRequestId / logger：
 * - 验证 VercelRequest → RequestContext 的适配逻辑（路径剥离、headers 合并、method 默认值）
 * - 验证 ResponseSpec → VercelResponse 的应用逻辑（body null/undefined 走 end，非空走 json）
 * - 验证错误兜底分支（dispatchRequest 抛错 / headersSent / Error vs 非 Error）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted 提升 mock 引用，避免 vi.mock 的 TDZ 问题
const { mockDispatch, mockGetClientIp, mockGenerateRequestId, mockLogger } =
  vi.hoisted(() => ({
    mockDispatch: vi.fn(),
    mockGetClientIp: vi.fn(),
    mockGenerateRequestId: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

// Mock 共享核心处理器（不调用真实业务逻辑）
vi.mock("../../src/server/handlers.js", () => ({
  dispatchRequest: mockDispatch,
}));

// Mock 限流模块（handler 仅使用 getClientIp）
vi.mock("../../src/middleware/rate-limit.js", () => ({
  getClientIp: mockGetClientIp,
}));

// Mock 请求 ID 生成
vi.mock("../../src/utils/crypto.js", () => ({
  generateRequestId: mockGenerateRequestId,
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: mockLogger,
}));

import handler from "../../api/index.js";

// 简化的 VercelRequest mock
interface MockRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  ip?: string;
}

// 简化的 VercelResponse mock（含 headersSent 标志）
interface MockResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  ended: boolean;
  headersSent: boolean;
  status(code: number): MockResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string | string[]): void;
  end(): void;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: "GET",
    url: "/api",
    headers: {},
    body: {},
    ...overrides,
  };
}

function createMockRes(
  opts: Partial<{ headersSent: boolean }> = {},
): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    headersSent: opts.headersSent ?? false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      this.ended = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    end() {
      this.ended = true;
    },
  };
  return res;
}

async function callHandler(req: MockRequest, res: MockResponse): Promise<void> {
  await handler(req as unknown as never, res as unknown as never);
}

describe("API IO 适配层", () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockGetClientIp.mockReset();
    mockGenerateRequestId.mockReset();
    mockLogger.error.mockReset();
    // 默认返回值
    mockGetClientIp.mockReturnValue("1.2.3.4");
    mockGenerateRequestId.mockReturnValue("req_test_123");
  });

  describe("applyResponse - 响应规格应用", () => {
    it("body 为 null 时应调用 res.end() 而非 res.json()", async () => {
      mockDispatch.mockResolvedValue({
        status: 204,
        headers: { "X-Custom": "val" },
        body: null,
      });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
      expect(res.headers["X-Custom"]).toBe("val");
      expect(res.body).toBeUndefined(); // end() 不设置 body
    });

    it("body 为 undefined 时应调用 res.end()", async () => {
      mockDispatch.mockResolvedValue({
        status: 204,
        headers: {},
        body: undefined,
      });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.ended).toBe(true);
      expect(res.body).toBeUndefined();
    });

    it("body 非空时应调用 res.json()", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { ok: true },
      });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(res.headers["Content-Type"]).toBe("application/json");
    });

    it("应设置所有 spec.headers 到 res", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: {
          "X-Header-1": "a",
          "X-Header-2": "b",
        },
        body: {},
      });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.headers["X-Header-1"]).toBe("a");
      expect(res.headers["X-Header-2"]).toBe("b");
    });

    it("应先 setHeader 再 status 再 end/json（顺序正确）", async () => {
      mockDispatch.mockResolvedValue({
        status: 201,
        headers: { Location: "/api/1" },
        body: { id: 1 },
      });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.headers["Location"]).toBe("/api/1");
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ id: 1 });
    });
  });

  describe("buildContext - 上下文构造", () => {
    it("应调用 generateRequestId 生成请求 ID", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(mockGenerateRequestId).toHaveBeenCalledTimes(1);
    });

    it("应调用 getClientIp 并传入 req", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(mockGetClientIp).toHaveBeenCalledTimes(1);
      expect(mockGetClientIp).toHaveBeenCalledWith(req);
    });

    it("应将 getClientIp 返回值作为 clientIp 传入 context", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      mockGetClientIp.mockReturnValue("9.8.7.6");
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.clientIp).toBe("9.8.7.6");
    });

    it("应将 generateRequestId 返回值作为 requestId 传入 context", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      mockGenerateRequestId.mockReturnValue("req_abc");
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.requestId).toBe("req_abc");
    });

    it("path 应剥离 query string", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ url: "/api?foo=bar&baz=qux" });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("/api");
    });

    it("url 仅含 query string 时 path 应为空", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ url: "?foo=bar" });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("");
    });

    it("url 为 undefined 时 path 应为空字符串", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ url: undefined });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("");
    });

    it("method 为 undefined 时应默认 GET", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ method: undefined });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.method).toBe("GET");
    });

    it("headers 为 undefined 时应构造空 Headers 对象", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq();
      req.headers = undefined as unknown as Record<string, string>;
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.headers).toBeInstanceOf(Headers);
      // 空 Headers：entries 迭代器立即 done
      expect(ctx.headers.entries().next().done).toBe(true);
    });

    it("headers 含字符串值时应 set 到 Headers", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({
        headers: { "x-custom": "value", "x-api-key": "secret" },
      });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.headers.get("x-custom")).toBe("value");
      expect(ctx.headers.get("x-api-key")).toBe("secret");
    });

    it("headers 含数组值时应 append 每个元素", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({
        headers: { "x-multi": ["a", "b", "c"] },
      });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      // Headers.get 对多值返回逗号空格连接
      expect(ctx.headers.get("x-multi")).toBe("a, b, c");
    });

    it("headers 含 undefined 值时应跳过", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({
        headers: { "x-defined": "ok", "x-undef": undefined },
      });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.headers.get("x-defined")).toBe("ok");
      expect(ctx.headers.has("x-undef")).toBe(false);
    });

    it("body 应原样传入 context", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ body: { url: "https://example.com" } });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.body).toEqual({ url: "https://example.com" });
    });

    it("body 为 null 时应原样传入 context", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq({ body: null });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.body).toBeNull();
    });

    it("startTime 应为不超过当前时间的数字", async () => {
      mockDispatch.mockResolvedValue({ status: 200, headers: {}, body: {} });
      const req = createMockReq();
      const res = createMockRes();
      const before = Date.now();
      await callHandler(req, res);
      const after = Date.now();

      const ctx = mockDispatch.mock.calls[0][0];
      expect(typeof ctx.startTime).toBe("number");
      expect(ctx.startTime).toBeGreaterThanOrEqual(before);
      expect(ctx.startTime).toBeLessThanOrEqual(after);
    });
  });

  describe("handler - 错误兜底处理", () => {
    it("dispatchRequest 抛 Error 时应返回 500 并记录错误", async () => {
      const error = new Error("dispatch failed");
      mockDispatch.mockRejectedValue(error);
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
      });
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[0]).toContain("Unhandled error in Vercel handler");
      expect(logCall[0]).toContain("dispatch failed");
      expect(logCall[1]).toBe(error);
    });

    it("dispatchRequest 抛非 Error 时应使用 'Unknown error' 消息", async () => {
      mockDispatch.mockRejectedValue("string error");
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(500);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[0]).toContain("Unknown error");
      expect(logCall[1]).toBeUndefined(); // 非 Error 时第二参数为 undefined
    });

    it("dispatchRequest 抛 null 时应使用 'Unknown error' 消息", async () => {
      mockDispatch.mockRejectedValue(null);
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(500);
      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[0]).toContain("Unknown error");
    });

    it("res.headersSent 为 true 时不应重复设置 status/json", async () => {
      mockDispatch.mockRejectedValue(new Error("late error"));
      const req = createMockReq();
      const res = createMockRes({ headersSent: true });
      await callHandler(req, res);

      // headersSent 时不应调用 res.status 或 res.json
      expect(res.statusCode).toBe(200); // 默认值未改变
      expect(res.body).toBeUndefined();
      expect(res.ended).toBe(false);
      // 但应记录日志
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it("抛错时 logger.error 应包含 module: VercelHandler 上下文", async () => {
      mockDispatch.mockRejectedValue(new Error("boom"));
      const req = createMockReq();
      const res = createMockRes();
      await callHandler(req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[2]).toEqual({ module: "VercelHandler" });
    });
  });

  describe("handler - 端到端 IO 流（全 mock）", () => {
    it("OPTIONS 请求应通过 dispatchRequest 返回 204 + CORS 头", async () => {
      mockDispatch.mockResolvedValue({
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key",
        },
        body: null,
      });
      const req = createMockReq({ method: "OPTIONS", url: "/api" });
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
      expect(res.headers["Access-Control-Allow-Methods"]).toBe(
        "POST, OPTIONS",
      );
      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.method).toBe("OPTIONS");
    });

    it("GET /api/health 应通过 dispatchRequest 返回 200 healthy", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { status: "healthy", version: "0.2.0" },
      });
      const req = createMockReq({ method: "GET", url: "/api/health" });
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ status: "healthy", version: "0.2.0" });
      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("/api/health");
    });

    it("POST /api 应转发 body 到 dispatchRequest", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { success: true },
      });
      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: { url: "https://example.com", method: "GET" },
      });
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.method).toBe("POST");
      expect(ctx.body).toEqual({ url: "https://example.com", method: "GET" });
    });

    it("POST /api/capture 应正确路由到 dispatchRequest", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: {},
        body: { success: true, data: { html: "<p>test</p>" } },
      });
      const req = createMockReq({
        method: "POST",
        url: "/api/capture",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();
      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { html: "<p>test</p>" },
      });
      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("/api/capture");
    });

    it("POST /api 带 query string 应剥离 query 后传 path", async () => {
      mockDispatch.mockResolvedValue({
        status: 200,
        headers: {},
        body: {},
      });
      const req = createMockReq({
        method: "POST",
        url: "/api?trace=1",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();
      await callHandler(req, res);

      const ctx = mockDispatch.mock.calls[0][0];
      expect(ctx.path).toBe("/api");
    });
  });
});
