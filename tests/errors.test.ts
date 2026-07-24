/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * errors 模块测试
 * 覆盖 src/errors/index.ts 的所有导出：
 * - ErrorCode 枚举完整性
 * - AppError 类（构造、属性、toJSON、原型链）
 * - 全部工厂函数（createInvalidUrlError 等）
 * - 工具函数 isAppError / toAppError
 */

import { describe, it, expect } from "vitest";
import {
  AppError,
  ErrorCode,
  createInvalidUrlError,
  createMissingUrlError,
  createInvalidApiKeyError,
  createRateLimitError,
  createMethodNotAllowedError,
  createProxyError,
  createUpstreamError,
  createTimeoutError,
  createInternalError,
  isAppError,
  toAppError,
} from "../src/errors/index.js";

describe("ErrorCode 枚举", () => {
  it("应包含所有客户端错误码 (4xx)", () => {
    expect(ErrorCode.INVALID_URL).toBe("INVALID_URL");
    expect(ErrorCode.MISSING_URL).toBe("MISSING_URL");
    expect(ErrorCode.INVALID_API_KEY).toBe("INVALID_API_KEY");
    expect(ErrorCode.RATE_LIMITED).toBe("RATE_LIMITED");
    expect(ErrorCode.INVALID_REQUEST).toBe("INVALID_REQUEST");
    expect(ErrorCode.METHOD_NOT_ALLOWED).toBe("METHOD_NOT_ALLOWED");
    expect(ErrorCode.REQUEST_TOO_LARGE).toBe("REQUEST_TOO_LARGE");
  });

  it("应包含所有服务端错误码 (5xx)", () => {
    expect(ErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    expect(ErrorCode.PROXY_ERROR).toBe("PROXY_ERROR");
    expect(ErrorCode.UPSTREAM_ERROR).toBe("UPSTREAM_ERROR");
    expect(ErrorCode.TIMEOUT_ERROR).toBe("TIMEOUT_ERROR");
  });

  it("应包含 11 个错误码", () => {
    expect(Object.values(ErrorCode)).toHaveLength(11);
  });

  it("枚举键与值应一致（字符串枚举）", () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(key).toBe(value);
    }
  });
});

describe("AppError 类", () => {
  it("构造函数应正确设置 code、message、statusCode", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom", 500);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.message).toBe("boom");
    expect(err.statusCode).toBe(500);
  });

  it("未传入 statusCode 时应默认 500", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.statusCode).toBe(500);
  });

  it("应正确设置 details", () => {
    const err = new AppError(ErrorCode.RATE_LIMITED, "limited", 429, {
      retryAfter: 60,
    });
    expect(err.details).toEqual({ retryAfter: 60 });
  });

  it("未传入 details 时应为 undefined", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.details).toBeUndefined();
  });

  it("应继承 Error 且 name 为 'AppError'", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe("AppError");
  });

  it("应通过 Object.setPrototypeOf 修复原型链", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(Object.getPrototypeOf(err)).toBe(AppError.prototype);
  });

  it("toJSON 应返回包含 error 和 code 的对象", () => {
    const err = new AppError(ErrorCode.INVALID_URL, "bad url", 400);
    expect(err.toJSON()).toEqual({
      error: "bad url",
      code: ErrorCode.INVALID_URL,
    });
  });

  it("toJSON 不应包含 details（未设置时）", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.toJSON()).not.toHaveProperty("details");
  });

  it("toJSON 应包含 details（设置时）", () => {
    const err = new AppError(ErrorCode.RATE_LIMITED, "limited", 429, {
      retryAfter: 30,
    });
    expect(err.toJSON().details).toEqual({ retryAfter: 30 });
  });

  it("toJSON 不应包含 requestId（未传入时）", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.toJSON()).not.toHaveProperty("requestId");
  });

  it("toJSON 应包含 requestId（传入非空字符串时）", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.toJSON("req_abc123").requestId).toBe("req_abc123");
  });

  it("toJSON 传入空字符串 requestId 时不应包含 requestId", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "boom");
    expect(err.toJSON("")).not.toHaveProperty("requestId");
  });

  it("toJSON 同时包含 details 和 requestId", () => {
    const err = new AppError(ErrorCode.RATE_LIMITED, "limited", 429, {
      retryAfter: 60,
    });
    expect(err.toJSON("req_xyz")).toEqual({
      error: "limited",
      code: ErrorCode.RATE_LIMITED,
      details: { retryAfter: 60 },
      requestId: "req_xyz",
    });
  });

  it("空 message 应保留为空字符串（无默认 message 逻辑）", () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, "", 500);
    expect(err.message).toBe("");
    expect(err.toJSON().error).toBe("");
  });
});

describe("工厂函数", () => {
  describe("createInvalidUrlError", () => {
    it("无参数时应使用默认 message", () => {
      const err = createInvalidUrlError();
      expect(err.code).toBe(ErrorCode.INVALID_URL);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("Invalid or blocked URL");
    });

    it("传入 reason 时应使用自定义 message", () => {
      const err = createInvalidUrlError("custom reason");
      expect(err.message).toBe("custom reason");
      expect(err.code).toBe(ErrorCode.INVALID_URL);
      expect(err.statusCode).toBe(400);
    });

    it("传入空字符串时应使用默认 message（falsy 回退）", () => {
      const err = createInvalidUrlError("");
      expect(err.message).toBe("Invalid or blocked URL");
    });

    it("返回值应为 AppError 实例", () => {
      expect(createInvalidUrlError()).toBeInstanceOf(AppError);
    });
  });

  describe("createMissingUrlError", () => {
    it("应返回 400 MISSING_URL", () => {
      const err = createMissingUrlError();
      expect(err.code).toBe(ErrorCode.MISSING_URL);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("URL is required");
    });
  });

  describe("createInvalidApiKeyError", () => {
    it("应返回 401 INVALID_API_KEY", () => {
      const err = createInvalidApiKeyError();
      expect(err.code).toBe(ErrorCode.INVALID_API_KEY);
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Unauthorized");
    });
  });

  describe("createRateLimitError", () => {
    it("无 retryAfter 时不应设置 details", () => {
      const err = createRateLimitError();
      expect(err.code).toBe(ErrorCode.RATE_LIMITED);
      expect(err.statusCode).toBe(429);
      expect(err.message).toBe("Rate limit exceeded");
      expect(err.details).toBeUndefined();
    });

    it("传入正数 retryAfter 时应设置 details.retryAfter", () => {
      const err = createRateLimitError(60);
      expect(err.details).toEqual({ retryAfter: 60 });
    });

    it("传入 0 时应视为 falsy，不设置 details", () => {
      const err = createRateLimitError(0);
      expect(err.details).toBeUndefined();
    });

    it("未传入参数时应视为 falsy，不设置 details", () => {
      const err = createRateLimitError();
      expect(err.details).toBeUndefined();
    });
  });

  describe("createMethodNotAllowedError", () => {
    it("应返回 405 METHOD_NOT_ALLOWED", () => {
      const err = createMethodNotAllowedError();
      expect(err.code).toBe(ErrorCode.METHOD_NOT_ALLOWED);
      expect(err.statusCode).toBe(405);
      expect(err.message).toBe("Method not allowed");
    });
  });

  describe("createProxyError", () => {
    it("应返回 502 PROXY_ERROR 且保留传入 message", () => {
      const err = createProxyError("upstream down");
      expect(err.code).toBe(ErrorCode.PROXY_ERROR);
      expect(err.statusCode).toBe(502);
      expect(err.message).toBe("upstream down");
    });
  });

  describe("createUpstreamError", () => {
    it("应返回 502 UPSTREAM_ERROR 且保留传入 message", () => {
      const err = createUpstreamError("bad gateway");
      expect(err.code).toBe(ErrorCode.UPSTREAM_ERROR);
      expect(err.statusCode).toBe(502);
      expect(err.message).toBe("bad gateway");
    });
  });

  describe("createTimeoutError", () => {
    it("应返回 504 TIMEOUT_ERROR 且 message 含 operation", () => {
      const err = createTimeoutError("fetch");
      expect(err.code).toBe(ErrorCode.TIMEOUT_ERROR);
      expect(err.statusCode).toBe(504);
      expect(err.message).toBe("fetch timed out");
    });

    it("不同 operation 应生成不同 message", () => {
      expect(createTimeoutError("dns").message).toBe("dns timed out");
      expect(createTimeoutError("connect").message).toBe("connect timed out");
    });
  });

  describe("createInternalError", () => {
    it("无参数时应使用默认 message", () => {
      const err = createInternalError();
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.statusCode).toBe(500);
      expect(err.message).toBe("Internal server error");
    });

    it("传入 message 时应使用自定义 message", () => {
      const err = createInternalError("custom");
      expect(err.message).toBe("custom");
    });

    it("传入空字符串时应使用默认 message（falsy 回退）", () => {
      const err = createInternalError("");
      expect(err.message).toBe("Internal server error");
    });
  });
});

describe("isAppError", () => {
  it("AppError 实例应返回 true", () => {
    expect(isAppError(new AppError(ErrorCode.INTERNAL_ERROR, "x"))).toBe(true);
  });

  it("工厂函数创建的实例应返回 true", () => {
    expect(isAppError(createInvalidUrlError())).toBe(true);
    expect(isAppError(createRateLimitError(10))).toBe(true);
  });

  it("普通 Error 应返回 false", () => {
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("Error 子类（非 AppError）应返回 false", () => {
    class CustomError extends Error {}
    expect(isAppError(new CustomError("x"))).toBe(false);
  });

  it("非 Error 值应返回 false", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError("string")).toBe(false);
    expect(isAppError(123)).toBe(false);
    expect(isAppError({})).toBe(false);
    expect(isAppError([])).toBe(false);
  });
});

describe("toAppError", () => {
  it("AppError 应原样返回（同一引用）", () => {
    const original = createInvalidUrlError("bad");
    expect(toAppError(original)).toBe(original);
  });

  it("普通 Error 应转换为 INTERNAL_ERROR 且保留 message", () => {
    const result = toAppError(new Error("plain error"));
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe("plain error");
  });

  it("Error 子类应转换为 INTERNAL_ERROR 且保留 message", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    const result = toAppError(new CustomError("custom"));
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("custom");
  });

  it("字符串应转换为 INTERNAL_ERROR 且使用 'Unknown error'", () => {
    const result = toAppError("string error");
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("Unknown error");
  });

  it("null 应转换为 INTERNAL_ERROR 且使用 'Unknown error'", () => {
    const result = toAppError(null);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("Unknown error");
  });

  it("undefined 应转换为 INTERNAL_ERROR 且使用 'Unknown error'", () => {
    const result = toAppError(undefined);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("Unknown error");
  });

  it("普通对象应转换为 INTERNAL_ERROR 且使用 'Unknown error'", () => {
    const result = toAppError({ foo: "bar" });
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("Unknown error");
  });

  it("数字应转换为 INTERNAL_ERROR 且使用 'Unknown error'", () => {
    const result = toAppError(42);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe("Unknown error");
  });
});
