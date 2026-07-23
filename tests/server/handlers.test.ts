/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * dispatchRequest 单元测试 - 共享核心处理器
 *
 * 测试目标：src/server/handlers.ts 的 dispatchRequest
 *
 * 设计说明：
 * - 通过 vi.mock 替换 ProxyService / captureWebpage / DNS 解析等外部依赖
 * - 测试运行时中立接口：输入 RequestContext → 输出 ResponseSpec
 * - 与 e2e/api.test.ts 互补：e2e 验证完整 IO 适配链路，本测试验证纯业务逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecute, mockCaptureWebpage, featuresRef, apiKeyConfigRef } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCaptureWebpage: vi.fn(),
  featuresRef: {
    enableCache: true,
    enableRateLimit: false,
    enableFallback: true,
    enableApiKey: false,
  },
  apiKeyConfigRef: {
    enabled: false,
    keys: [] as string[],
    headerName: "x-api-key",
  },
}));

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    FEATURES: featuresRef,
    API_KEY_CONFIG: apiKeyConfigRef,
  };
});

vi.mock("../../src/core/proxy-service.js", () => ({
  ProxyService: class MockProxyService {
    execute = mockExecute;
  },
}));

vi.mock("../../src/webpage-capture/index.js", () => ({
  captureWebpage: (...args: unknown[]) => mockCaptureWebpage(...args),
}));

vi.mock("../../src/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/security.js")>();
  return {
    ...actual,
    validateDnsResolution: vi.fn().mockResolvedValue({ valid: true }),
  };
});

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { dispatchRequest, type RequestContext } from "../../src/server/handlers.js";

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    method: "GET",
    path: "/api",
    headers: new Headers(),
    body: null,
    clientIp: "203.0.113.1",
    requestId: "req-test",
    startTime: Date.now(),
    ...overrides,
  };
}

describe("dispatchRequest - 路由分发", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("OPTIONS 预检", () => {
    it("应返回 204 No Content", async () => {
      const spec = await dispatchRequest(makeCtx({ method: "OPTIONS" }));
      expect(spec.status).toBe(204);
      expect(spec.body).toBeNull();
      expect(spec.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    });

    it("应包含 CORS 白名单 origin", async () => {
      const spec = await dispatchRequest(
        makeCtx({
          method: "OPTIONS",
          headers: new Headers({ origin: "http://localhost:3000" }),
        }),
      );
      expect(spec.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
      expect(spec.headers["Vary"]).toBe("Origin");
    });

    it("非白名单 origin 不应设置 Access-Control-Allow-Origin", async () => {
      const spec = await dispatchRequest(
        makeCtx({
          method: "OPTIONS",
          headers: new Headers({ origin: "https://evil.com" }),
        }),
      );
      expect(spec.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });

  describe("健康检查", () => {
    it("GET /api 应返回 200 + healthy", async () => {
      const spec = await dispatchRequest(makeCtx({ method: "GET", path: "/api" }));
      expect(spec.status).toBe(200);
      const body = spec.body as { status: string; requestId: string };
      expect(body.status).toBe("healthy");
      expect(body.requestId).toBe("req-test");
    });

    it("GET /api/health 应返回 200", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "GET", path: "/api/health" }),
      );
      expect(spec.status).toBe(200);
    });

    it("GET /api/ready 应返回 200", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "GET", path: "/api/ready" }),
      );
      expect(spec.status).toBe(200);
    });
  });

  describe("Method Not Allowed", () => {
    it("PUT /api 应返回 405", async () => {
      const spec = await dispatchRequest(makeCtx({ method: "PUT", path: "/api" }));
      expect(spec.status).toBe(405);
      expect((spec.body as { code: string }).code).toBe("METHOD_NOT_ALLOWED");
    });

    it("DELETE /api 应返回 405", async () => {
      const spec = await dispatchRequest(makeCtx({ method: "DELETE", path: "/api" }));
      expect(spec.status).toBe(405);
    });

    it("POST /unknown 应返回 405", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "POST", path: "/unknown" }),
      );
      expect(spec.status).toBe(405);
    });
  });

  describe("POST /api 代理请求", () => {
    it("body 缺失 url 应返回 400 INVALID_URL", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "POST", path: "/api", body: {} }),
      );
      expect(spec.status).toBe(400);
      expect((spec.body as { code: string }).code).toBe("INVALID_URL");
    });

    it("无效 URL 应返回 400", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "POST", path: "/api", body: { url: "not-a-url" } }),
      );
      expect(spec.status).toBe(400);
    });

    it("有效 URL 应调用 ProxyService.execute 并返回 200", async () => {
      mockExecute.mockResolvedValue({ success: true, status: 200, body: "ok" });
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api",
          body: { url: "https://example.com", method: "GET" },
        }),
      );
      expect(spec.status).toBe(200);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com", method: "GET" }),
      );
    });

    it("ProxyService.execute 抛 AppError 时应原样返回错误码", async () => {
      const { AppError, ErrorCode } = await import("../../src/errors/index.js");
      mockExecute.mockRejectedValue(
        new AppError(ErrorCode.INVALID_API_KEY, "bad key", 401),
      );
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api",
          body: { url: "https://example.com" },
        }),
      );
      expect(spec.status).toBe(401);
      expect((spec.body as { code: string }).code).toBe("INVALID_API_KEY");
    });
  });

  describe("POST /api/capture 网页捕获", () => {
    it("body 缺失 url 应返回 400", async () => {
      const spec = await dispatchRequest(
        makeCtx({ method: "POST", path: "/api/capture", body: {} }),
      );
      expect(spec.status).toBe(400);
      expect((spec.body as { code: string }).code).toBe("INVALID_URL");
    });

    it("成功捕获应返回 200 + html", async () => {
      mockCaptureWebpage.mockResolvedValue({
        success: true,
        html: "<html>ok</html>",
        title: "Title",
        url: "https://example.com",
        mode: "html",
        capturedAt: "2026-01-01T00:00:00.000Z",
        duration: 50,
      });
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api/capture",
          body: { url: "https://example.com" },
        }),
      );
      expect(spec.status).toBe(200);
      const body = spec.body as { success: boolean; data: { html: string } };
      expect(body.success).toBe(true);
      expect(body.data.html).toBe("<html>ok</html>");
    });

    it("降级模式应包含 degraded 标志", async () => {
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
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api/capture",
          body: { url: "https://example.com" },
        }),
      );
      expect(spec.status).toBe(200);
      const body = spec.body as { data: { degraded: boolean } };
      expect(body.data.degraded).toBe(true);
    });

    it("captureWebpage 失败应返回 500", async () => {
      mockCaptureWebpage.mockResolvedValue({
        success: false,
        error: "Browser failed",
        url: "https://example.com",
        mode: "html",
        duration: 0,
      });
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api/capture",
          body: { url: "https://example.com" },
        }),
      );
      expect(spec.status).toBe(500);
      expect((spec.body as { code: string }).code).toBe("INTERNAL_ERROR");
    });
  });

  describe("安全响应头", () => {
    it("所有响应都应包含安全响应头", async () => {
      const spec = await dispatchRequest(makeCtx({ method: "GET", path: "/api" }));
      expect(spec.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(spec.headers["X-Frame-Options"]).toBe("DENY");
      expect(spec.headers["X-XSS-Protection"]).toBe("1; mode=block");
      expect(spec.headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(spec.headers["Permissions-Policy"]).toContain("geolocation=()");
    });
  });

  describe("限流触发", () => {
    it("enableRateLimit=true 且超限时 capture 端点应返回 429", async () => {
      featuresRef.enableRateLimit = true;
      // 使用唯一 IP 避免与其他用例的 IP 计数冲突
      const ctx = makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
        clientIp: "198.51.100.250",
      });

      // CAPTURE_RATE_LIMIT_MAX = 30，调用 30 次后再发应触发 429
      for (let i = 0; i < 30; i++) {
        await dispatchRequest({ ...ctx, requestId: `req-${i}` });
      }
      const over = await dispatchRequest({ ...ctx, requestId: "req-over" });
      expect(over.status).toBe(429);
      expect((over.body as { code: string }).code).toBe("RATE_LIMITED");
    });

    it("enableRateLimit=true 且超限时 /api 端点应返回 429", async () => {
      featuresRef.enableRateLimit = true;
      const ctx = makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
        clientIp: "198.51.100.251",
      });
      mockExecute.mockResolvedValue({ success: true });

      // RATE_LIMIT_MAX = 100，调用 100 次后再发应触发 429
      for (let i = 0; i < 100; i++) {
        await dispatchRequest({ ...ctx, requestId: `req-${i}` });
      }
      const over = await dispatchRequest({ ...ctx, requestId: "req-over" });
      expect(over.status).toBe(429);
    });
  });

  describe("API Key 验证", () => {
    it("enableApiKey=true 且无 key 应返回 401", async () => {
      featuresRef.enableApiKey = true;
      apiKeyConfigRef.enabled = true;
      apiKeyConfigRef.keys = ["valid-key"];
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api",
          body: { url: "https://example.com" },
        }),
      );
      expect(spec.status).toBe(401);
      expect((spec.body as { code: string }).code).toBe("INVALID_API_KEY");
    });

    it("enableApiKey=true 且 key 错误应返回 401", async () => {
      featuresRef.enableApiKey = true;
      apiKeyConfigRef.enabled = true;
      apiKeyConfigRef.keys = ["valid-key"];
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api",
          body: { url: "https://example.com" },
          headers: new Headers({ "x-api-key": "wrong-key" }),
        }),
      );
      expect(spec.status).toBe(401);
    });

    it("enableApiKey=true 且 key 正确应放行", async () => {
      featuresRef.enableApiKey = true;
      apiKeyConfigRef.enabled = true;
      apiKeyConfigRef.keys = ["valid-key"];
      mockExecute.mockResolvedValue({ success: true });
      const spec = await dispatchRequest(
        makeCtx({
          method: "POST",
          path: "/api",
          body: { url: "https://example.com" },
          headers: new Headers({ "x-api-key": "valid-key" }),
        }),
      );
      expect(spec.status).toBe(200);
    });
  });
});
