/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * Logger 模块单元测试
 *
 * 覆盖：
 * - debug 在 DEBUG 环境变量不同取值下的行为
 * - info / warn / error 日志格式（合法 JSON、level、message、context 合并）
 * - error 在传入 / 不传 Error 时的字段差异
 * - logPerformance / logRequest 业务方法
 * - logRequest 的 URL sanitize（query 遮蔽 / 无 query 保留 / 非法 URL 原样返回）
 * - format 输出合法性、getTimestamp ISO 格式
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../src/logger.js";

describe("Logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalDebug: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // 拦截 console 输出，避免污染测试输出
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    originalDebug = process.env.DEBUG;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    // 恢复环境变量
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe("debug", () => {
    it("DEBUG=true 时调用 console.log", () => {
      process.env.DEBUG = "true";
      logger.debug("调试消息");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it("DEBUG 未设置时不调用 console.log", () => {
      delete process.env.DEBUG;
      logger.debug("调试消息");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("DEBUG=false 时不调用 console.log", () => {
      process.env.DEBUG = "false";
      logger.debug("调试消息");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("info", () => {
    it("调用 console.log，输出 JSON 含 level=info、message、context（service/version/environment）", () => {
      logger.info("hello", { foo: "bar" });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.level).toBe("info");
      expect(entry.message).toBe("hello");
      expect(entry.context.service).toBe("xRelay");
      expect(entry.context.version).toBe("0.2.2");
      // setup.ts 设置 NODE_ENV=test，logger 构造时读取
      expect(entry.context.environment).toBeDefined();
      expect(entry.context.foo).toBe("bar");
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe("warn", () => {
    it("调用 console.log，输出 JSON 含 level=warn", () => {
      logger.warn("警告消息");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.level).toBe("warn");
      expect(entry.message).toBe("警告消息");
    });
  });

  describe("error", () => {
    it("调用 console.error，输出 JSON 含 level=error", () => {
      logger.error("出错了");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(entry.level).toBe("error");
      expect(entry.message).toBe("出错了");
      expect(entry.context.service).toBe("xRelay");
    });

    it("传入 Error 时包含 error.name、error.message、error.stack", () => {
      const err = new Error("boom");
      err.name = "CustomError";
      logger.error("失败", err);
      const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(entry.error).toBeDefined();
      expect(entry.error.name).toBe("CustomError");
      expect(entry.error.message).toBe("boom");
      expect(typeof entry.error.stack).toBe("string");
      expect(entry.error.stack).toContain("CustomError");
    });

    it("不传 Error 时不含 error 字段", () => {
      logger.error("失败");
      const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(entry.error).toBeUndefined();
    });
  });

  describe("logPerformance", () => {
    it("调用 info，输出含 operation、duration_ms、metadata", () => {
      logger.logPerformance("render", 250, { extra: "meta" });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      // operation 拼接在 message 中
      expect(entry.message).toContain("render");
      expect(entry.context.duration_ms).toBe(250);
      expect(entry.context.extra).toBe("meta");
    });
  });

  describe("logRequest", () => {
    it("调用 info，输出含 requestId、method、statusCode、duration_ms", () => {
      logger.logRequest("req-123", "GET", "https://example.com/path", 200, 42);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.context.requestId).toBe("req-123");
      expect(entry.context.method).toBe("GET");
      expect(entry.context.statusCode).toBe(200);
      expect(entry.context.duration_ms).toBe(42);
    });

    it("URL 含 query string 时遮蔽为 ?[REDACTED]", () => {
      logger.logRequest(
        "req-1",
        "GET",
        "https://example.com/path?token=secret&foo=bar",
        200,
        10,
      );
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.context.url).toBe("https://example.com/path?[REDACTED]");
    });

    it("URL 无 query 时保留 protocol/host/pathname", () => {
      logger.logRequest(
        "req-2",
        "GET",
        "https://example.com/path/sub",
        200,
        10,
      );
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.context.url).toBe("https://example.com/path/sub");
    });

    it("URL 非法时原样返回", () => {
      const invalidUrl = "not-a-valid-url";
      logger.logRequest("req-3", "GET", invalidUrl, 500, 10);
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.context.url).toBe(invalidUrl);
    });
  });

  describe("format / getTimestamp（通过输出间接验证）", () => {
    it("format 输出是合法 JSON", () => {
      logger.info("msg");
      const raw = logSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(raw)).not.toThrow();
      const entry = JSON.parse(raw);
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("level");
      expect(entry).toHaveProperty("message");
      expect(entry).toHaveProperty("context");
    });

    it("getTimestamp 输出 ISO 格式", () => {
      logger.info("msg");
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      // ISO 8601 格式校验：Date 能解析且 toString 回到原值
      const ts = new Date(entry.timestamp);
      expect(ts.toString()).not.toBe("Invalid Date");
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("context 合并", () => {
    it("自定义 context 与 service/version/environment 正确合并", () => {
      logger.info("msg", { custom: "value", service: "override-attempt" });
      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      // 自定义字段被合并
      expect(entry.context.custom).toBe("value");
      // 内置字段存在
      expect(entry.context.version).toBe("0.2.2");
      expect(entry.context.environment).toBeDefined();
      // 自定义 context 在 ...context 展开顺序，可覆盖内置字段
      expect(entry.context.service).toBe("override-attempt");
    });
  });
});
