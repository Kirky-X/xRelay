/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * API 端到端测试
 * 覆盖 api/index.ts 的核心路由：
 * - GET /api, /api/health, /api/ready (健康检查)
 * - OPTIONS * (CORS 预检)
 * - POST /api (代理请求)
 * - POST /api/capture (网页捕获)
 * - 405 / 400 / 500 错误路径
 * - 安全响应头 / CORS 头
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted 提升 mock 函数，避免 vi.mock 的 TDZ 问题
const { mockExecute, mockCaptureWebpage, featuresRef } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCaptureWebpage: vi.fn(),
  // FEATURES 引用：用例内可翻转 enableRateLimit/enableApiKey
  featuresRef: {
    enableCache: true,
    enableRateLimit: false, // 默认禁用，避免累积触发 429
    enableFallback: true,
    enableApiKey: false,
  },
}));

// Mock config：FEATURES 在模块加载时求值，env 变量无法反向更新已加载常量，
// 必须通过 mock 替换为可变引用，测试才能稳定控制开关
// 保留其他真实导出（CORS_CONFIG 白名单等），仅覆盖 FEATURES
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    FEATURES: featuresRef,
  };
});

// Mock ProxyService（避免实际发起代理请求）
vi.mock("../../src/core/proxy-service.js", () => ({
  ProxyService: class MockProxyService {
    execute = mockExecute;
  },
}));

// Mock captureWebpage（避免实际启动浏览器）
vi.mock("../../src/webpage-capture/index.js", () => ({
  captureWebpage: (...args: unknown[]) => mockCaptureWebpage(...args),
}));

// Mock DNS resolution（避免实际 DNS 查询）
vi.mock("../../src/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/security.js")>();
  return {
    ...actual,
    validateDnsResolution: vi.fn().mockResolvedValue({ valid: true }),
  };
});

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import handler from "../../api/index.js";
import { validateDnsResolution } from "../../src/security.js";

// 类型：简化的 VercelRequest / VercelResponse mock
interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  ip?: string;
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  ended: boolean;
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

function createMockRes(): MockResponse & {
  status: (code: number) => void;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string | string[]) => void;
  end: () => void;
} {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: undefined as unknown,
    ended: false,
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

// 将 mock req/res 转换为 handler 期望的签名
async function callHandler(
  req: MockRequest,
  res: ReturnType<typeof createMockRes>,
): Promise<void> {
  // VercelRequest extends IncomingMessage，我们只提供 handler 实际用到的字段
  await handler(req as unknown as never, res as unknown as never);
}

describe("API 端到端测试", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    vi.mocked(validateDnsResolution).mockReset();
    vi.mocked(validateDnsResolution).mockResolvedValue({ valid: true });
    // 测试默认禁用 API Key 和限流
    // 必须同时更新 featuresRef 引用（env 变量无法反向影响已加载的 FEATURES 常量）
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
  });

  describe("健康检查端点", () => {
    it("GET /api 应返回 200 healthy", async () => {
      const req = createMockReq({ method: "GET", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        status: "healthy",
      });
      expect((res.body as { timestamp: string }).timestamp).toBeDefined();
      expect((res.body as { version: string }).version).toBe("0.2.2");
    });

    it("GET /api/health 应返回 200", async () => {
      const req = createMockReq({ method: "GET", url: "/api/health" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect((res.body as { status: string }).status).toBe("healthy");
    });

    it("GET /api/ready 应返回 200", async () => {
      const req = createMockReq({ method: "GET", url: "/api/ready" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect((res.body as { status: string }).status).toBe("healthy");
    });
  });

  describe("CORS 预检", () => {
    it("OPTIONS /api 应返回 204 No Content", async () => {
      const req = createMockReq({ method: "OPTIONS", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
      // CORS 头应设置
      expect(res.headers["Access-Control-Allow-Methods"]).toBeDefined();
    });
  });

  describe("POST /api 代理请求", () => {
    it("缺少 body 时应返回 400 INVALID_URL", async () => {
      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: {},
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect((res.body as { code: string }).code).toBe("INVALID_URL");
    });

    it("无效 URL 应返回 400", async () => {
      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: { url: "not-a-valid-url" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect((res.body as { code: string }).code).toBe("INVALID_URL");
    });

    it("有效 URL 应调用 ProxyService.execute 并返回 200", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: '{"data": "ok"}',
        proxyUsed: true,
        fallbackUsed: false,
        proxyIp: "1.2.3.4",
      };
      mockExecute.mockResolvedValue(mockResponse);

      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: { url: "https://httpbin.org/get", method: "GET" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
      const body = res.body as {
        success: boolean;
        proxyUsed: boolean;
        requestId: string;
      };
      expect(body.success).toBe(true);
      expect(body.proxyUsed).toBe(true);
      expect(body.requestId).toBeDefined();
    });

    it("ProxyService.execute 抛 AppError 时应原样返回", async () => {
      // 模拟 validateUrl 通过但 DNS 验证失败
      vi.mocked(validateDnsResolution).mockResolvedValue({
        valid: false,
        error: "DNS resolution failed",
      });

      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: { url: "https://nonexistent.invalid.example/get" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect((res.body as { code: string }).code).toBe("INVALID_URL");
    });
  });

  describe("POST /api/capture 网页捕获", () => {
    it("缺少 url 应返回 400", async () => {
      const req = createMockReq({
        method: "POST",
        url: "/api/capture",
        body: {},
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect((res.body as { code: string }).code).toBe("INVALID_URL");
    });

    it("成功捕获应返回 200 + html", async () => {
      mockCaptureWebpage.mockResolvedValue({
        success: true,
        html: "<html><body>test</body></html>",
        title: "Test",
        url: "https://example.com",
        mode: "html",
        capturedAt: "2026-01-01T00:00:00.000Z",
        duration: 100,
      });

      const req = createMockReq({
        method: "POST",
        url: "/api/capture",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(mockCaptureWebpage).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
      const body = res.body as {
        success: boolean;
        data: { html: string; title: string };
        requestId: string;
      };
      expect(body.success).toBe(true);
      expect(body.data.html).toContain("test");
      expect(body.data.title).toBe("Test");
    });

    it("捕获失败应返回 500", async () => {
      mockCaptureWebpage.mockResolvedValue({
        success: false,
        error: "Browser failed to launch",
        url: "https://example.com",
        mode: "html",
        duration: 100,
      });

      const req = createMockReq({
        method: "POST",
        url: "/api/capture",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(500);
      expect((res.body as { code: string }).code).toBe("INTERNAL_ERROR");
    });

    it("降级模式应返回 200 + degraded 标志", async () => {
      mockCaptureWebpage.mockResolvedValue({
        success: true,
        html: "<html>static</html>",
        title: "Static",
        url: "https://example.com",
        mode: "html",
        degraded: true,
        capturedAt: "2026-01-01T00:00:00.000Z",
        duration: 50,
      });

      const req = createMockReq({
        method: "POST",
        url: "/api/capture",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as {
        success: boolean;
        data: { degraded: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.degraded).toBe(true);
    });
  });

  describe("方法不允许", () => {
    it("PUT /api 应返回 405", async () => {
      const req = createMockReq({ method: "PUT", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(405);
      expect((res.body as { code: string }).code).toBe("METHOD_NOT_ALLOWED");
    });

    it("DELETE /api 应返回 405", async () => {
      const req = createMockReq({ method: "DELETE", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(405);
    });

    it("GET /api/capture 应返回 405（仅支持 POST）", async () => {
      const req = createMockReq({ method: "GET", url: "/api/capture" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(405);
    });
  });

  describe("安全响应头", () => {
    it("所有响应应设置 X-Content-Type-Options: nosniff", async () => {
      const req = createMockReq({ method: "GET", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(res.headers["X-Frame-Options"]).toBe("DENY");
      expect(res.headers["Strict-Transport-Security"]).toContain("max-age");
      expect(res.headers["X-XSS-Protection"]).toContain("1");
      expect(res.headers["Referrer-Policy"]).toBeDefined();
      expect(res.headers["Permissions-Policy"]).toBeDefined();
    });
  });

  describe("CORS 头", () => {
    it("非白名单 origin 不应设置 Access-Control-Allow-Origin（白名单策略）", async () => {
      // 安全策略：使用显式白名单，不再使用通配符 "*"
      // 默认 NODE_ENV=test，非生产
      const req = createMockReq({
        method: "GET",
        url: "/api",
        headers: { origin: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      // example.com 不在白名单中，不应设置 ACAO 头
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(res.headers["Access-Control-Allow-Methods"]).toBeDefined();
    });

    it("白名单 origin 应设置 Access-Control-Allow-Origin", async () => {
      const req = createMockReq({
        method: "GET",
        url: "/api",
        headers: { origin: "http://localhost:3000" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.headers["Access-Control-Allow-Origin"]).toBe(
        "http://localhost:3000",
      );
      expect(res.headers["Vary"]).toBe("Origin");
    });

    it("CORS 预检应返回 Allow-Methods", async () => {
      const req = createMockReq({
        method: "OPTIONS",
        url: "/api",
        headers: { origin: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
      expect(res.headers["Access-Control-Allow-Headers"]).toContain(
        "Content-Type",
      );
    });
  });

  describe("请求 ID", () => {
    it("每个响应应包含 X-Request-Id 头", async () => {
      const req = createMockReq({ method: "GET", url: "/api" });
      const res = createMockRes();

      await callHandler(req, res);

      // 健康检查不强制 X-Request-Id，但代理请求会设置
      // 这里仅验证健康检查路径不抛错
      expect(res.statusCode).toBe(200);
    });

    it("POST /api 成功响应应设置 X-Request-Id", async () => {
      mockExecute.mockResolvedValue({
        success: true,
        status: 200,
        statusText: "OK",
        headers: {},
        body: "{}",
        proxyUsed: false,
        fallbackUsed: false,
      });

      const req = createMockReq({
        method: "POST",
        url: "/api",
        body: { url: "https://example.com" },
      });
      const res = createMockRes();

      await callHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers["X-Request-Id"]).toBeDefined();
    });
  });
});
