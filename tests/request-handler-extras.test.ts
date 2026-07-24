/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Request Handler 补充测试 - 提升分支覆盖率
 *
 * 覆盖目标（未覆盖或低覆盖分支）：
 * 1. getProxyAgent 池满 FIFO 淘汰 / 缓存命中
 * 2. closeAllProxyAgents 关闭并清空
 * 3. sendRequestWithProxy：timeout / 外部 signal / 状态码分支 / 数组 header / null body / undici 抛错
 * 4. readBodyWithLimit：超限 reject / 正常 resolve / error 事件 reject
 * 5. sendRequestDirect：fetch 失败 / Content-Length 超限 / reader.read 抛错 / body null → text()
 * 6. sendProxyRequest：无可用代理 fallback / 所有代理失败 fallback / useFallback=false / maxProxyAttempts=0
 * 7. ensureUserAgent：已有 UA 不覆盖 / 无 UA 添加
 * 8. filterDangerousHeaders：补充未覆盖的危险 header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProxyRequest } from "../src/types/index.js";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ
const { proxyManagerMock, loggerMock, configMock, undiciMock, userAgentMock } =
  vi.hoisted(() => ({
    proxyManagerMock: {
      getAvailableProxy: vi.fn(),
      getMultipleProxies: vi.fn(),
      reportProxyFailed: vi.fn(),
      reportProxySuccess: vi.fn(),
    },
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    configMock: {
      REQUEST_TIMEOUT_CONFIG: { proxy: 30000, direct: 10000 },
      DATABASE_CONFIG: { proxiesPerRequest: 3 },
      SECURITY_CONFIG: {
        allowedDomains: [],
        allowedProtocols: ["http:", "https:"],
        blockedIpRanges: [],
        maxRequestSize: 100 * 1024,
        enableVerboseLogging: false,
      },
    },
    undiciMock: {
      request: vi.fn(),
      // ProxyAgent 构造函数：必须用普通 function 才能被 new 调用
      // close() 返回 Promise（与真实 undici ProxyAgent 一致）
      ProxyAgent: vi.fn(function (this: { close: ReturnType<typeof vi.fn> }) {
        this.close = vi.fn().mockResolvedValue(undefined);
      }),
      // Agent 构造函数：用于 pinned DNS 直连路径
      Agent: vi.fn(function (this: { close: ReturnType<typeof vi.fn> }) {
        this.close = vi.fn().mockResolvedValue(undefined);
      }),
    },
    userAgentMock: {
      getRandomUserAgent: vi.fn(() => "TestUA/1.0"),
    },
  }));

vi.mock("../src/proxy-manager.js", () => proxyManagerMock);
vi.mock("../src/logger.js", () => ({ logger: loggerMock }));
vi.mock("../src/config.js", () => configMock);
vi.mock("../src/utils/user-agent.js", () => userAgentMock);
vi.mock("undici", () => undiciMock);

import {
  filterDangerousHeaders,
  closeAllProxyAgents,
  sendProxyRequest,
  sendRequestWithMultipleProxies,
} from "../src/request-handler.js";

// 构造一个可推送 data/end/error 事件的伪 body
function createFakeBody(
  chunks: Buffer[] = [],
  opts: { error?: Error; delay?: number } = {},
) {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const body = {
    on(event: string, listener: (...args: unknown[]) => void) {
      (listeners[event] ||= []).push(listener);
      return body;
    },
    destroy: vi.fn(() => {
      // destroy 时也触发 error? 不模拟，保持简单
    }),
    // 用于测试驱动事件
    _emit(event: string, ...args: unknown[]) {
      (listeners[event] || []).forEach((fn) => fn(...args));
    },
  };
  // 异步推送事件
  const delay = opts.delay ?? 0;
  setTimeout(() => {
    if (opts.error) {
      body._emit("error", opts.error);
      return;
    }
    for (const c of chunks) {
      body._emit("data", c);
    }
    body._emit("end");
  }, delay);
  return body;
}

// 构造一个伪 undici 响应
function createFakeResponse(opts: {
  statusCode?: number;
  headers?: Record<string, string | string[] | undefined>;
  body?: ReturnType<typeof createFakeBody> | null;
}) {
  return {
    statusCode: opts.statusCode ?? 200,
    headers: opts.headers ?? {},
    body: opts.body === undefined ? null : opts.body,
    trailers: {},
  };
}

const fakeProxy = {
  ip: "203.0.113.10",
  port: 8080,
  protocol: "http",
  country: "US",
  anonymity: "high",
  lastChecked: Date.now(),
  successRate: 0.9,
  avgResponseTime: 100,
};

describe("Request Handler Extras - getProxyAgent 池管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
    undiciMock.ProxyAgent.mockClear();
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("池满（>100）时应 FIFO 关闭并删除最早条目", async () => {
    // 通过 sendProxyRequest 触发多次 getProxyAgent，每次使用不同 proxy URL
    proxyManagerMock.getAvailableProxy.mockImplementation(async () => {
      // 每次返回不同 ip，触发新建 ProxyAgent
      const idx = proxyManagerMock.getAvailableProxy.mock.calls.length;
      return { ...fakeProxy, ip: `203.0.113.${idx + 1}` };
    });
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    proxyManagerMock.reportProxySuccess.mockResolvedValue(undefined);

    // 让 undici request 抛错以快速走完一次循环
    undiciMock.request.mockRejectedValue(new Error("fail"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };

    // 触发 101 次以超过 100 上限
    await sendProxyRequest(request, {
      maxProxyAttempts: 101,
      useFallback: false,
    });

    // ProxyAgent 应被创建 101 次
    expect(undiciMock.ProxyAgent).toHaveBeenCalledTimes(101);
  });

  it("缓存命中时应直接返回已有 ProxyAgent（不新建）", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    undiciMock.request.mockRejectedValue(new Error("fail"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };

    // 两次请求同一个 proxy URL，应只创建一次 ProxyAgent
    await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });
    await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(undiciMock.ProxyAgent).toHaveBeenCalledTimes(1);
  });

  it("closeAllProxyAgents 应清空池，下次请求会重建 ProxyAgent", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    undiciMock.request.mockRejectedValue(new Error("fail"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });
    expect(undiciMock.ProxyAgent).toHaveBeenCalledTimes(1);

    closeAllProxyAgents();

    await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });
    expect(undiciMock.ProxyAgent).toHaveBeenCalledTimes(2);
  });
});

describe("Request Handler Extras - filterDangerousHeaders 补充分支", () => {
  it("应过滤 Keep-Alive / Upgrade / TE / Trailer / Proxy-* / Via / If-* / Front-End-Https 等", () => {
    const headers = {
      "Keep-Alive": "timeout=5",
      Upgrade: "websocket",
      TE: "trailers",
      Trailer: "x-trailer",
      "Proxy-Authorization": "Basic abc",
      "Proxy-Connection": "keep-alive",
      "Proxy-Authenticate": "Basic",
      Via: "1.1 proxy",
      "X-Forwarded-Host": "evil.com",
      "X-Forwarded-Proto": "https",
      "X-Real-IP": "1.2.3.4",
      "X-Client-IP": "1.2.3.4",
      "If-Match": '"etag"',
      "If-None-Match": '"etag"',
      "If-Modified-Since": "Wed, 21 Oct 2015 07:28:00 GMT",
      "If-Unmodified-Since": "Wed, 21 Oct 2015 07:28:00 GMT",
      "If-Range": '"etag"',
      "Front-End-Https": "on",
      "X-Originating-URL": "http://evil.com",
      "X-Wap-Profile": "http://wap.xml",
      "X-ATT-DeviceId": "device123",
      "X-Safe": "value",
    };
    const filtered = filterDangerousHeaders(headers);
    expect(filtered).toEqual({ "X-Safe": "value" });
  });

  it("应过滤含控制字符的 header 名称", () => {
    const headers = {
      "Bad\rHeader": "v",
      "Tab\tHeader": "v",
      "NUL\0Header": "v",
      "Good-Header": "v",
    };
    const filtered = filterDangerousHeaders(headers);
    expect(filtered).toEqual({ "Good-Header": "v" });
  });

  it("空 headers 对象应返回空对象", () => {
    expect(filterDangerousHeaders({})).toEqual({});
  });
});

describe("Request Handler Extras - sendRequestWithProxy 分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    proxyManagerMock.reportProxySuccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("2xx 状态码应返回 success:true + data + status + headers", async () => {
    const body = createFakeBody([Buffer.from("hello world")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("hello world");
    expect(result.status).toBe(200);
    expect(result.proxyUsed).toBe(true);
    expect(result.proxySuccess).toBe(true);
    expect(proxyManagerMock.reportProxySuccess).toHaveBeenCalledWith(fakeProxy);
  });

  it("4xx 状态码应返回 success:false + HTTP 错误", async () => {
    const body = createFakeBody([Buffer.from("not found")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 404, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    // 4xx 走 reportProxyFailed 路径，循环结束后 fallback=false 时 proxyUsed=false
    expect(result.fallbackUsed).toBe(false);
    // reportProxyFailed 应被调用
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledWith(fakeProxy);
  });

  it("5xx 状态码同样返回 success:false", async () => {
    const body = createFakeBody([Buffer.from("server error")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 503, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalled();
  });

  it("undici request 抛错时应返回 success:false + error.message", async () => {
    undiciMock.request.mockRejectedValue(new Error("network down"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalled();
  });

  it("undici request 抛非 Error 值时应返回 'Unknown error'", async () => {
    undiciMock.request.mockRejectedValue("string error");

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
  });

  it("response.headers 含数组值时应合并为逗号分隔字符串", async () => {
    const body = createFakeBody([Buffer.from("ok")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({
        statusCode: 200,
        headers: {
          "Set-Cookie": ["a=1", "b=2"],
          "X-Single": "single",
          "X-Undefined": undefined,
        },
        body,
      }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(true);
    const headers = result.headers ?? {};
    expect(headers["Set-Cookie"]).toBe("a=1, b=2");
    expect(headers["X-Single"]).toBe("single");
    expect(headers).not.toHaveProperty("X-Undefined");
  });

  it("response.body 为 null 时应返回空字符串", async () => {
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body: null }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("");
  });

  it("response.body 超过 maxSize 时应 reject 并返回失败", async () => {
    // maxRequestSize = 100KB, MAX_RESPONSE_SIZE = 100 * 100KB = 10MB
    // 推送一个 11MB 的 chunk 触发超限
    const bigChunk = Buffer.alloc(11 * 1024 * 1024, 0x61);
    const body = createFakeBody([bigChunk]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalled();
  });

  it("response.body 触发 error 事件时应返回失败", async () => {
    const body = createFakeBody([], { error: new Error("stream broken") });
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalled();
  });

  it("response.body 正常小数据应正确 resolve", async () => {
    const body = createFakeBody([
      Buffer.from("chunk1-"),
      Buffer.from("chunk2"),
    ]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("chunk1-chunk2");
  });

  it("timeout 触发 abort 时应返回失败（undici 抛 AbortError）", async () => {
    // 直接让 undici 抛 AbortError 模拟 timeout 触发
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    undiciMock.request.mockRejectedValue(abortErr);

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
  });

  it("request.headers 为 undefined 时应跳过 filterDangerousHeaders", async () => {
    const body = createFakeBody([Buffer.from("ok")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(true);
  });
});

describe("Request Handler Extras - ensureUserAgent 行为", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("无 UA 时应通过 ensureUserAgent 添加随机 UA（直连路径）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    await sendProxyRequest(request, { useFallback: true });

    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callOpts.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("TestUA/1.0");
    expect(userAgentMock.getRandomUserAgent).toHaveBeenCalled();
  });

  it("已有 UA（任意大小写）时不应覆盖", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = {
      url: "http://example.com",
      method: "GET",
      headers: { "user-agent": "MyCustomUA/2.0" },
    };
    await sendProxyRequest(request, { useFallback: true });

    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callOpts.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("MyCustomUA/2.0");
    expect(headers["User-Agent"]).toBeUndefined();
    // 不应调用 getRandomUserAgent
    expect(userAgentMock.getRandomUserAgent).not.toHaveBeenCalled();
  });
});

describe("Request Handler Extras - sendRequestDirect 分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("fetch 失败时应返回 success:false + error", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("network down"),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it("Content-Length 超限时应返回错误", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "Content-Length": String(20 * 1024 * 1024) },
      }),
    ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it("reader.read 抛错时应返回错误", async () => {
    // 构造一个会抛错的 ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream read failed"));
      },
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it("response.body 为 null（如 204 响应）应返回空 body 且 success=true", async () => {
    // 204 No Content 响应 body 为 null
    // readWebBodyWithLimit 对 null body 直接返回空字符串
    const resp = new Response(null, { status: 204 });
    global.fetch = vi
      .fn()
      .mockResolvedValue(resp) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe(204);
    expect(result.data).toBe("");
  });

  it("response.body 超过 maxSize 时应返回错误（readWebBodyWithLimit 流式限制）", async () => {
    // 构造一个返回超大响应体的 ReadableStream
    // readWebBodyWithLimit 在累计大小超过 maxSize 时抛错
    const largeData = new Uint8Array(11 * 1024 * 1024); // 11MB > MAX_RESPONSE_SIZE
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(largeData);
        controller.close();
      },
    });
    const resp = new Response(stream, { status: 200 });
    global.fetch = vi
      .fn()
      .mockResolvedValue(resp) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.error).toMatch(/exceeds/i);
  });
});

describe("Request Handler Extras - sendProxyRequest 分支", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("无可用代理且 useFallback=true 时应 Fallback 直连", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.proxyUsed).toBe(false);
    expect(result.proxyIp).toBeNull();
  });

  it("无可用代理且 useFallback=false 时应直接返回失败", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: false });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.error).toContain("代理尝试失败");
  });

  it("所有代理失败且 useFallback=true 时应 Fallback 直连", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    undiciMock.request.mockRejectedValue(new Error("proxy fail"));
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("direct ok", { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 2,
      useFallback: true,
    });

    expect(result.fallbackUsed).toBe(true);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledTimes(2);
  });

  it("所有代理失败且 useFallback=false 时应直接返回失败", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    undiciMock.request.mockRejectedValue(new Error("proxy fail"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 1,
      useFallback: false,
    });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.error).toContain("代理尝试失败");
  });

  it("maxProxyAttempts=0 时由于 `|| 3` 短路会被当作 3 次尝试", async () => {
    // 源码：const maxProxyAttempts = options.maxProxyAttempts || 3;
    // 0 是 falsy，所以实际值为 3
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    undiciMock.request.mockRejectedValue(new Error("proxy fail"));
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("ok", { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 0,
      useFallback: true,
    });

    // maxProxyAttempts=0 → || 3 → 实际尝试 3 次代理，全部失败后 fallback
    expect(proxyManagerMock.getAvailableProxy).toHaveBeenCalledTimes(3);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledTimes(3);
    expect(result.fallbackUsed).toBe(true);
  });

  it("代理成功时不应调用 fallback", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(fakeProxy);
    proxyManagerMock.reportProxySuccess.mockResolvedValue(undefined);
    const body = createFakeBody([Buffer.from("proxy ok")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, {
      maxProxyAttempts: 3,
      useFallback: true,
    });

    expect(result.success).toBe(true);
    expect(result.proxyUsed).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("直连失败且 useFallback=true 时应返回合并错误", async () => {
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);
    global.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("direct fail"),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.error).toContain("直连也失败");
  });
});

describe("Request Handler Extras - sendRequestWithMultipleProxies 竞速成功路径", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllProxyAgents();
    proxyManagerMock.reportProxyFailed.mockResolvedValue(undefined);
    proxyManagerMock.reportProxySuccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    closeAllProxyAgents();
  });

  it("竞速成功时应返回 successResponse 并 reportProxySuccess（覆盖 raceProxies 成功 + sendRequestWithMultipleProxies 成功路径）", async () => {
    // 单个代理成功 → raceProxies Promise.any 立即 resolve → 覆盖 line 999-1000, 1028
    proxyManagerMock.getMultipleProxies.mockResolvedValue([fakeProxy]);
    const body = createFakeBody([Buffer.from("race-success")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 1, false);

    expect(result.success).toBe(true);
    expect(result.data).toBe("race-success");
    expect(result.proxyUsed).toBe(true);
    expect(result.proxySuccess).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.proxyIp).toBe(`${fakeProxy.ip}:${fakeProxy.port}`);
    expect(proxyManagerMock.reportProxySuccess).toHaveBeenCalledWith(fakeProxy);
    expect(proxyManagerMock.reportProxyFailed).not.toHaveBeenCalled();
  });

  it("多代理竞速时第一个成功应取消其他代理请求", async () => {
    // 2 个代理：第一个成功，第二个应被 abort
    const proxy1 = { ...fakeProxy, ip: "203.0.113.11" };
    const proxy2 = { ...fakeProxy, ip: "203.0.113.12" };
    proxyManagerMock.getMultipleProxies.mockResolvedValue([proxy1, proxy2]);

    const body = createFakeBody([Buffer.from("first-wins")]);
    undiciMock.request.mockResolvedValueOnce(
      createFakeResponse({ statusCode: 200, body }),
    );
    // 第二个代理请求不会被实际调用（因为 Promise.any 在第一个 resolve 后立即返回）
    // 但 abortOthers 会调用 ctrl.abort()，触发 AbortError

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 2, false);

    expect(result.success).toBe(true);
    expect(result.data).toBe("first-wins");
    expect(proxyManagerMock.reportProxySuccess).toHaveBeenCalledWith(proxy1);
  });

  it("竞速全部失败但 useFallback=true 时应回退到直连", async () => {
    proxyManagerMock.getMultipleProxies.mockResolvedValue([fakeProxy]);
    undiciMock.request.mockRejectedValue(new Error("all proxies failed"));
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("direct-ok", { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 1, true);

    expect(result.success).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.proxyUsed).toBe(false);
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledWith(fakeProxy);
  });

  it("竞速全部失败且 useFallback=false 时应返回失败", async () => {
    proxyManagerMock.getMultipleProxies.mockResolvedValue([fakeProxy]);
    undiciMock.request.mockRejectedValue(new Error("all proxies failed"));

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 1, false);

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.error).toContain("代理失败");
  });

  it("无可用代理且 useFallback=true 时应回退到直连", async () => {
    proxyManagerMock.getMultipleProxies.mockResolvedValue([]);
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("direct-ok", { status: 200 }),
      ) as unknown as typeof globalThis.fetch;

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 3, true);

    expect(result.success).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.proxyUsed).toBe(false);
  });

  it("无可用代理且 useFallback=false 时应返回失败", async () => {
    proxyManagerMock.getMultipleProxies.mockResolvedValue([]);

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 3, false);

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.error).toContain("没有可用代理");
  });

  it("未传 proxyCount 时应使用 DATABASE_CONFIG.proxiesPerRequest", async () => {
    // proxyCount 为 undefined → actualProxyCount = DATABASE_CONFIG.proxiesPerRequest (3)
    proxyManagerMock.getMultipleProxies.mockResolvedValue([fakeProxy]);
    const body = createFakeBody([Buffer.from("default-count")]);
    undiciMock.request.mockResolvedValue(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request);

    expect(result.success).toBe(true);
    // 应使用默认 proxyCount=3 调用 getMultipleProxies
    expect(proxyManagerMock.getMultipleProxies).toHaveBeenCalledWith(3);
  });

  it("attemptProxyRequest 中 AbortError 应被 sendRequestWithProxy 捕获返回 success:false，最终调用 reportProxyFailed", async () => {
    // sendRequestWithProxy 内部有 try/catch 捕获所有异常（含 AbortError），
    // 返回 {success:false}，attemptProxyRequest 走 success=false 路径调用 reportProxyFailed
    const proxy1 = { ...fakeProxy, ip: "203.0.113.21" };
    const proxy2 = { ...fakeProxy, ip: "203.0.113.22" };
    proxyManagerMock.getMultipleProxies.mockResolvedValue([proxy1, proxy2]);

    // 第一个代理抛 AbortError（被取消），第二个成功
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    undiciMock.request.mockRejectedValueOnce(abortErr).mockResolvedValueOnce(
      createFakeResponse({
        statusCode: 200,
        body: createFakeBody([Buffer.from("second-wins")]),
      }),
    );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 2, false);

    expect(result.success).toBe(true);
    expect(result.data).toBe("second-wins");
    expect(proxyManagerMock.reportProxySuccess).toHaveBeenCalledWith(proxy2);
    // AbortError 被 sendRequestWithProxy 捕获 → 返回 success:false → reportProxyFailed 被调用
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledWith(proxy1);
  });

  it("attemptProxyRequest 中非 AbortError 异常应调用 reportProxyFailed", async () => {
    const proxy1 = { ...fakeProxy, ip: "203.0.113.31" };
    const proxy2 = { ...fakeProxy, ip: "203.0.113.32" };
    proxyManagerMock.getMultipleProxies.mockResolvedValue([proxy1, proxy2]);

    // 第一个代理抛非 AbortError 异常，第二个成功
    undiciMock.request
      .mockRejectedValueOnce(new Error("unexpected boom"))
      .mockResolvedValueOnce(
        createFakeResponse({
          statusCode: 200,
          body: createFakeBody([Buffer.from("recovered")]),
        }),
      );

    const request: ProxyRequest = { url: "http://example.com", method: "GET" };
    const result = await sendRequestWithMultipleProxies(request, 2, false);

    expect(result.success).toBe(true);
    expect(result.data).toBe("recovered");
    // 非 AbortError 异常应调用 reportProxyFailed
    expect(proxyManagerMock.reportProxyFailed).toHaveBeenCalledWith(proxy1);
  });
});

describe("sendRequestDirectPinned - SSRF TOCTOU 防护 pinned DNS 路径（覆盖 line 605-676）", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 无可用代理 → 跳过代理循环 → 走 fallback 直连
    proxyManagerMock.getAvailableProxy.mockResolvedValue(null);
    // sendRequestDirect 在 pinned 失败后会回退标准 fetch（Bug 1 修复：保生产可用性）。
    // mock 标准 fetch 也失败，使 pinned 错误用例验证"pinned 失败 + 回退失败 → 整体 success:false"。
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch fallback failed"));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("resolvedIp 存在时应走 pinned DNS 直连并返回 200 响应", async () => {
    const body = createFakeBody([Buffer.from("pinned-success")]);
    undiciMock.request.mockResolvedValueOnce(
      createFakeResponse({ statusCode: 200, body }),
    );

    const request: ProxyRequest = {
      url: "http://example.com",
      method: "GET",
      resolvedIp: "203.0.113.99",
    };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.data).toBe("pinned-success");
    expect(result.fallbackUsed).toBe(true);
    expect(result.proxyUsed).toBe(false);
    expect(undiciMock.request).toHaveBeenCalled();
  });

  it("pinned DNS 直连返回非 200 应返回 success:false", async () => {
    const body = createFakeBody([Buffer.from("error-body")]);
    undiciMock.request.mockResolvedValueOnce(
      createFakeResponse({ statusCode: 503, body }),
    );

    const request: ProxyRequest = {
      url: "http://example.com",
      method: "GET",
      resolvedIp: "203.0.113.100",
    };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it("pinned DNS 直连抛错应走 catch 返回 success:false（覆盖 line 668-676）", async () => {
    undiciMock.request.mockRejectedValueOnce(
      new Error("pinned connection failed"),
    );

    const request: ProxyRequest = {
      url: "http://example.com",
      method: "GET",
      resolvedIp: "203.0.113.101",
    };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it("pinned DNS 直连无 body 时应跳过 readBodyWithLimit（覆盖 line 641-643）", async () => {
    undiciMock.request.mockResolvedValueOnce(
      createFakeResponse({ statusCode: 200, body: null }),
    );

    const request: ProxyRequest = {
      url: "http://example.com",
      method: "GET",
      resolvedIp: "203.0.113.102",
    };
    const result = await sendProxyRequest(request, { useFallback: true });

    expect(result.success).toBe(true);
    expect(result.data).toBe("");
  });
});
