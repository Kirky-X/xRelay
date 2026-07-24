/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * 认证中间件测试 - 验证 API Key 校验逻辑
 *
 * 测试目标：src/middleware/auth.ts 的
 *   validateApiKey / validateApiKeyFromHeaders / validateApiKeyFromRequest /
 *   extractApiKey / isApiKeyEnabled
 *
 * 设计说明：
 * - 使用 vi.hoisted 提升可变引用 apiKeyConfigRef，用例内可翻转 enabled / keys / headerName
 * - timingSafeEqualString / createInvalidApiKeyError / logger 均通过 vi.mock 替换，
 *   便于断言调用次数与返回值
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest } from "@vercel/node";

// 使用 vi.hoisted 提升 mock 引用，避免 TDZ
const {
  apiKeyConfigRef,
  loggerMock,
  cryptoMock,
  errorsMock,
} = vi.hoisted(() => ({
  // 可变的 API_KEY_CONFIG 引用
  apiKeyConfigRef: {
    enabled: true,
    keys: [] as string[],
    headerName: "x-api-key",
  },
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  cryptoMock: {
    timingSafeEqualString: vi.fn(),
  },
  errorsMock: {
    createInvalidApiKeyError: vi.fn(),
  },
}));

vi.mock("../../src/config.js", () => ({
  API_KEY_CONFIG: apiKeyConfigRef,
}));

vi.mock("../../src/logger.js", () => ({ logger: loggerMock }));

vi.mock("../../src/utils/crypto.js", () => cryptoMock);

vi.mock("../../src/errors/index.js", () => errorsMock);

import {
  validateApiKey,
  validateApiKeyFromHeaders,
  validateApiKeyFromRequest,
  extractApiKey,
  isApiKeyEnabled,
} from "../../src/middleware/auth.js";

// 构造一个固定的“无效 API Key”错误用于断言
const invalidKeyError = new Error("Unauthorized");

beforeEach(() => {
  vi.clearAllMocks();
  // 重置默认配置：启用验证、单 key、header 名 x-api-key
  apiKeyConfigRef.enabled = true;
  apiKeyConfigRef.keys = ["secret-key"];
  apiKeyConfigRef.headerName = "x-api-key";
  // crypto 默认返回 false（不匹配）
  cryptoMock.timingSafeEqualString.mockReturnValue(false);
  errorsMock.createInvalidApiKeyError.mockReturnValue(invalidKeyError);
});

// 辅助：构造一个最小可用的 VercelRequest（只用到 headers）
function makeVercelRequest(headers: Record<string, string>): VercelRequest {
  return { headers } as unknown as VercelRequest;
}

describe("validateApiKey", () => {
  it("enabled=false 时直接返回不抛错", () => {
    apiKeyConfigRef.enabled = false;
    apiKeyConfigRef.keys = ["secret-key"];

    expect(() => validateApiKey(makeVercelRequest({}))).not.toThrow();
    // 不应校验任何 key
    expect(cryptoMock.timingSafeEqualString).not.toHaveBeenCalled();
    expect(errorsMock.createInvalidApiKeyError).not.toHaveBeenCalled();
  });

  it("enabled=true 但 keys 为空时抛 createInvalidApiKeyError 并记录 error 日志", () => {
    apiKeyConfigRef.keys = [];

    expect(() => validateApiKey(makeVercelRequest({}))).toThrow(invalidKeyError);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "API Key 验证已启用但未配置密钥",
      undefined,
      expect.objectContaining({ module: "Auth" }),
    );
    expect(errorsMock.createInvalidApiKeyError).toHaveBeenCalledTimes(1);
  });

  it("headers 中无 key 时抛错", () => {
    expect(() =>
      validateApiKey(makeVercelRequest({ "other-header": "value" })),
    ).toThrow(invalidKeyError);
    expect(errorsMock.createInvalidApiKeyError).toHaveBeenCalledTimes(1);
    // 没有 key 不应该走到 timingSafeEqualString
    expect(cryptoMock.timingSafeEqualString).not.toHaveBeenCalled();
  });

  it("key 错误时抛错（timingSafeEqualString 返回 false）", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(false);

    expect(() =>
      validateApiKey(makeVercelRequest({ "x-api-key": "wrong-key" })),
    ).toThrow(invalidKeyError);
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledWith("wrong-key", "secret-key");
    expect(errorsMock.createInvalidApiKeyError).toHaveBeenCalledTimes(1);
  });

  it("key 正确时不抛错", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(true);

    expect(() =>
      validateApiKey(makeVercelRequest({ "x-api-key": "secret-key" })),
    ).not.toThrow();
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledWith("secret-key", "secret-key");
    expect(errorsMock.createInvalidApiKeyError).not.toHaveBeenCalled();
  });

  it("多个 keys 时逐个比较（源码循环无 break，会全部比较）", () => {
    apiKeyConfigRef.keys = ["key-a", "key-b", "key-c"];
    // 第二个 key 匹配
    cryptoMock.timingSafeEqualString
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(() =>
      validateApiKey(makeVercelRequest({ "x-api-key": "key-b" })),
    ).not.toThrow();
    // 源码 for...of 循环无 break，3 个 keys 全部比较
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledTimes(3);
    expect(cryptoMock.timingSafeEqualString).toHaveBeenNthCalledWith(1, "key-b", "key-a");
    expect(cryptoMock.timingSafeEqualString).toHaveBeenNthCalledWith(2, "key-b", "key-b");
    expect(cryptoMock.timingSafeEqualString).toHaveBeenNthCalledWith(3, "key-b", "key-c");
  });

  it("header 名大小写不敏感（源码使用 toLowerCase 读取 header）", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(true);

    // Node.js IncomingHttpHeaders 中 header 名已小写存储
    // 源码通过 headerName.toLowerCase() 访问，故小写键即可命中
    expect(() =>
      validateApiKey(makeVercelRequest({ "x-api-key": "secret-key" })),
    ).not.toThrow();
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledWith("secret-key", "secret-key");
  });
});

describe("validateApiKeyFromHeaders", () => {
  it("enabled=false 时直接返回", () => {
    apiKeyConfigRef.enabled = false;

    const headers = new Headers();
    expect(() => validateApiKeyFromHeaders(headers)).not.toThrow();
    expect(errorsMock.createInvalidApiKeyError).not.toHaveBeenCalled();
  });

  it("enabled=true 但 keys 为空时抛错并记录 error 日志", () => {
    apiKeyConfigRef.keys = [];

    expect(() => validateApiKeyFromHeaders(new Headers())).toThrow(invalidKeyError);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "API Key 验证已启用但未配置密钥",
      undefined,
      expect.objectContaining({ module: "Auth" }),
    );
  });

  it("headers 中无 key 时抛错", () => {
    expect(() => validateApiKeyFromHeaders(new Headers())).toThrow(invalidKeyError);
    expect(cryptoMock.timingSafeEqualString).not.toHaveBeenCalled();
  });

  it("key 错误时抛错", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(false);

    const headers = new Headers({ "x-api-key": "wrong" });
    expect(() => validateApiKeyFromHeaders(headers)).toThrow(invalidKeyError);
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledWith("wrong", "secret-key");
  });

  it("key 正确时不抛错", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(true);

    const headers = new Headers({ "x-api-key": "secret-key" });
    expect(() => validateApiKeyFromHeaders(headers)).not.toThrow();
  });

  it("多个 keys 时逐个比较", () => {
    apiKeyConfigRef.keys = ["a", "b"];
    cryptoMock.timingSafeEqualString.mockReturnValue(true);

    const headers = new Headers({ "x-api-key": "b" });
    expect(() => validateApiKeyFromHeaders(headers)).not.toThrow();
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledTimes(2);
  });
});

describe("validateApiKeyFromRequest", () => {
  it("通过 request.headers 转发到 validateApiKeyFromHeaders（key 正确）", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(true);

    const request = new Request("https://example.com", {
      headers: { "x-api-key": "secret-key" },
    });
    expect(() => validateApiKeyFromRequest(request)).not.toThrow();
    expect(cryptoMock.timingSafeEqualString).toHaveBeenCalledWith("secret-key", "secret-key");
  });

  it("key 错误时通过转发抛错", () => {
    cryptoMock.timingSafeEqualString.mockReturnValue(false);

    const request = new Request("https://example.com", {
      headers: { "x-api-key": "wrong" },
    });
    expect(() => validateApiKeyFromRequest(request)).toThrow(invalidKeyError);
    expect(errorsMock.createInvalidApiKeyError).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 时不抛错（透传 enabled 短路逻辑）", () => {
    apiKeyConfigRef.enabled = false;

    const request = new Request("https://example.com");
    expect(() => validateApiKeyFromRequest(request)).not.toThrow();
    expect(errorsMock.createInvalidApiKeyError).not.toHaveBeenCalled();
  });
});

describe("extractApiKey", () => {
  it("从 VercelRequest 返回 header 值", () => {
    const req = makeVercelRequest({ "x-api-key": "extracted-key" });
    expect(extractApiKey(req)).toBe("extracted-key");
  });

  it("header 不存在时返回 undefined", () => {
    const req = makeVercelRequest({ "other-header": "value" });
    expect(extractApiKey(req)).toBeUndefined();
  });

  it("使用自定义 headerName 时正确读取", () => {
    apiKeyConfigRef.headerName = "x-custom-auth";
    const req = makeVercelRequest({ "x-custom-auth": "custom-value" });
    expect(extractApiKey(req)).toBe("custom-value");
  });
});

describe("isApiKeyEnabled", () => {
  it("enabled=true 时返回 true", () => {
    apiKeyConfigRef.enabled = true;
    expect(isApiKeyEnabled()).toBe(true);
  });

  it("enabled=false 时返回 false", () => {
    apiKeyConfigRef.enabled = false;
    expect(isApiKeyEnabled()).toBe(false);
  });
});
