/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * dispatchRequest 补充测试 - 提升分支覆盖率
 *
 * 覆盖目标（handlers.test.ts 未覆盖的分支）：
 * 1. handleProxy / handleCapture 的 DNS 验证失败分支（valid=false 返回 400）
 * 2. handleProxy / handleCapture 的 DNS 验证失败且无 error 字段（fallback 消息）
 * 3. handleProxy / handleCapture 的 DNS 验证异常分支（catch 返回 400）
 * 4. handleProxy / handleCapture 的非 AppError 异常（普通 Error / 非 Error 对象）
 * 5. isProduction()=true 时错误消息脱敏分支
 * 6. /api/capture 端点的 API Key 验证（AppError 分支）
 * 7. handleHealthCheck 中 process.uptime 为 undefined 的分支
 * 8. setCorsHeaders 无 Origin 时不设置 Access-Control-Allow-Origin
 * 9. URL 验证失败且无 error 字段的 fallback 分支（需 mock validateUrl）
 * 10. body 为 null/undefined 时的解构 fallback 分支
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ
const {
  mockExecute,
  mockCaptureWebpage,
  mockValidateDns,
  mockValidateUrl,
  featuresRef,
  apiKeyConfigRef,
  isProductionRef,
  corsConfigRef,
} = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCaptureWebpage: vi.fn(),
  mockValidateDns: vi.fn().mockResolvedValue({ valid: true }),
  mockValidateUrl: vi.fn().mockReturnValue({ valid: true }),
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
  isProductionRef: { value: false },
  corsConfigRef: {
    allowedOrigins: [
      "https://vercel-proxy-shield.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    allowedMethods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
    maxAge: 86400,
  },
}));

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    FEATURES: featuresRef,
    API_KEY_CONFIG: apiKeyConfigRef,
    CORS_CONFIG: corsConfigRef,
    isProduction: () => isProductionRef.value,
    validateProductionConfig: () => ({ valid: true, errors: [] }),
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
    validateDnsResolution: mockValidateDns,
    validateUrl: mockValidateUrl,
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
    requestId: "req-extras",
    startTime: Date.now(),
    ...overrides,
  };
}

describe("dispatchRequest Extras - DNS 验证失败分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    mockValidateUrl.mockReturnValue({ valid: true });
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api DNS 验证失败（valid=false + error）应返回 400", async () => {
    mockValidateDns.mockResolvedValue({
      valid: false,
      error: "DNS resolved to blocked IP",
    });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
    expect((spec.body as { error: string }).error).toBe(
      "DNS resolved to blocked IP",
    );
  });

  it("POST /api DNS 验证失败且无 error 字段应使用 fallback 消息", async () => {
    mockValidateDns.mockResolvedValue({ valid: false });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { error: string }).error).toBe(
      "DNS validation failed",
    );
  });

  it("POST /api/capture DNS 验证失败（valid=false + error）应返回 400", async () => {
    mockValidateDns.mockResolvedValue({
      valid: false,
      error: "DNS resolved to blocked IP",
    });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
    expect((spec.body as { error: string }).error).toBe(
      "DNS resolved to blocked IP",
    );
  });

  it("POST /api/capture DNS 验证失败且无 error 字段应使用 fallback 消息", async () => {
    mockValidateDns.mockResolvedValue({ valid: false });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { error: string }).error).toBe(
      "DNS validation failed",
    );
  });
});

describe("dispatchRequest Extras - DNS 验证异常分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    mockValidateUrl.mockReturnValue({ valid: true });
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api DNS 验证抛 Error 应返回 400", async () => {
    mockValidateDns.mockRejectedValue(new Error("Network error"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
    expect((spec.body as { error: string }).error).toBe(
      "DNS validation failed",
    );
  });

  it("POST /api DNS 验证抛非 Error 对象应返回 400", async () => {
    mockValidateDns.mockRejectedValue("string error");
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
  });

  it("POST /api/capture DNS 验证抛 Error 应返回 400", async () => {
    mockValidateDns.mockRejectedValue(new Error("Network error"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
  });
});

describe("dispatchRequest Extras - handleProxy 非 AppError 异常分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    mockValidateUrl.mockReturnValue({ valid: true });
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api ProxyService 抛普通 Error 应返回 500 + error.message（开发模式）", async () => {
    mockExecute.mockRejectedValue(new Error("proxy internal failure"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { code: string }).code).toBe("INTERNAL_ERROR");
    expect((spec.body as { error: string }).error).toBe(
      "proxy internal failure",
    );
  });

  it("POST /api ProxyService 抛非 Error 对象应返回 500 + Unknown error", async () => {
    mockExecute.mockRejectedValue("string error");
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { error: string }).error).toBe("Unknown error");
  });

  it("POST /api ProxyService 抛 null 应返回 500 + Unknown error", async () => {
    mockExecute.mockRejectedValue(null);
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { error: string }).error).toBe("Unknown error");
  });

  it("POST /api 生产模式下非 AppError 应返回脱敏消息", async () => {
    isProductionRef.value = true;
    mockExecute.mockRejectedValue(new Error("sensitive internal detail"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { error: string }).error).toBe(
      "Internal server error",
    );
  });
});

describe("dispatchRequest Extras - handleCapture 非 AppError 异常分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    mockValidateUrl.mockReturnValue({ valid: true });
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/capture captureWebpage 抛普通 Error 应返回 500（开发模式）", async () => {
    mockCaptureWebpage.mockRejectedValue(new Error("browser crashed"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { code: string }).code).toBe("INTERNAL_ERROR");
    expect((spec.body as { error: string }).error).toBe("browser crashed");
  });

  it("POST /api/capture captureWebpage 抛非 Error 对象应返回 500 + Unknown error", async () => {
    mockCaptureWebpage.mockRejectedValue(42);
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { error: string }).error).toBe("Unknown error");
  });

  it("POST /api/capture 生产模式下非 AppError 应返回脱敏消息", async () => {
    isProductionRef.value = true;
    mockCaptureWebpage.mockRejectedValue(new Error("sensitive detail"));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(500);
    expect((spec.body as { error: string }).error).toBe(
      "Internal server error",
    );
  });

  it("POST /api/capture API Key 验证失败应返回 401 AppError", async () => {
    featuresRef.enableApiKey = true;
    apiKeyConfigRef.enabled = true;
    apiKeyConfigRef.keys = ["valid-key"];
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(401);
    expect((spec.body as { code: string }).code).toBe("INVALID_API_KEY");
  });

  it("POST /api/capture API Key 正确应放行至 captureWebpage", async () => {
    featuresRef.enableApiKey = true;
    apiKeyConfigRef.enabled = true;
    apiKeyConfigRef.keys = ["valid-key"];
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
        headers: new Headers({ "x-api-key": "valid-key" }),
      }),
    );
    expect(spec.status).toBe(200);
    expect(mockCaptureWebpage).toHaveBeenCalled();
  });
});

describe("dispatchRequest Extras - URL 验证 fallback 分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api URL 验证失败且无 error 字段应使用 fallback 消息", async () => {
    mockValidateUrl.mockReturnValue({ valid: false });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { error: string }).error).toBe("Invalid URL");
  });

  it("POST /api/capture URL 验证失败且无 error 字段应使用 fallback 消息", async () => {
    mockValidateUrl.mockReturnValue({ valid: false });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: { url: "https://example.com" },
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { error: string }).error).toBe("Invalid URL");
  });
});

describe("dispatchRequest Extras - body 解构 fallback 分支", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCaptureWebpage.mockReset();
    mockValidateDns.mockReset();
    mockValidateDns.mockResolvedValue({ valid: true });
    mockValidateUrl.mockReset();
    mockValidateUrl.mockReturnValue({ valid: true });
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
    isProductionRef.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api body=null 应走 fallback 路径返回 400（url 缺失）", async () => {
    mockValidateUrl.mockImplementation((url: string) => ({
      valid: url.length > 0,
      error: url.length === 0 ? "URL is required" : undefined,
    }));
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: null,
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
  });

  it("POST /api/capture body=undefined 应走 fallback 路径返回 400", async () => {
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api/capture",
        body: undefined,
      }),
    );
    expect(spec.status).toBe(400);
    expect((spec.body as { code: string }).code).toBe("INVALID_URL");
  });

  it("POST /api 传入完整 headers/method/timeout 应透传给 ProxyService", async () => {
    mockExecute.mockResolvedValue({ success: true, status: 200, body: "ok" });
    const spec = await dispatchRequest(
      makeCtx({
        method: "POST",
        path: "/api",
        body: {
          url: "https://example.com",
          method: "POST",
          headers: { "X-Custom": "value" },
          body: "payload",
          timeout: 5000,
        },
      }),
    );
    expect(spec.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        method: "POST",
        headers: { "X-Custom": "value" },
        body: "payload",
        timeout: 5000,
      }),
    );
  });
});

describe("dispatchRequest Extras - handleHealthCheck 边界", () => {
  beforeEach(() => {
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("process.uptime 不存在时应返回 uptime=0", async () => {
    const originalUptime = process.uptime;
    // 模拟 process.uptime 不存在的环境（如某些边缘运行时）
    Object.defineProperty(process, "uptime", {
      value: undefined,
      configurable: true,
    });
    try {
      const spec = await dispatchRequest(
        makeCtx({ method: "GET", path: "/api" }),
      );
      expect(spec.status).toBe(200);
      const body = spec.body as { uptime: number };
      expect(body.uptime).toBe(0);
    } finally {
      Object.defineProperty(process, "uptime", {
        value: originalUptime,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("dispatchRequest Extras - CORS 边界", () => {
  beforeEach(() => {
    featuresRef.enableApiKey = false;
    featuresRef.enableRateLimit = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("无 Origin header 时不应设置 Access-Control-Allow-Origin 但保留通用 CORS 头", async () => {
    const spec = await dispatchRequest(
      makeCtx({
        method: "GET",
        path: "/api",
        headers: new Headers(),
      }),
    );
    expect(spec.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(spec.headers["Vary"]).toBeUndefined();
    // 通用 CORS 头仍应存在
    expect(spec.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(spec.headers["Access-Control-Allow-Headers"]).toBe(
      "Content-Type, x-api-key",
    );
    expect(spec.headers["Access-Control-Max-Age"]).toBe("86400");
  });

  it("Origin 为空字符串时不应设置 Access-Control-Allow-Origin", async () => {
    const spec = await dispatchRequest(
      makeCtx({
        method: "OPTIONS",
        headers: new Headers({ origin: "" }),
      }),
    );
    expect(spec.status).toBe(204);
    expect(spec.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
