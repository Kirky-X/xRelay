/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Stealth Scripts Tests
 * 验证反自动化检测脚本的内容、结构、语法正确性、深冻结
 */

import { describe, it, expect } from "vitest";
import {
  STEALTH_SCRIPTS,
  getStealthScriptCode,
} from "../../src/webpage-capture/stealth-scripts.js";

describe("stealth-scripts", () => {
  describe("STEALTH_SCRIPTS 常量", () => {
    it("应返回非空数组（至少 5 条脚本）", () => {
      expect(Array.isArray(STEALTH_SCRIPTS)).toBe(true);
      expect(STEALTH_SCRIPTS.length).toBeGreaterThanOrEqual(5);
    });

    it("每条脚本都有 name 和 code 字段", () => {
      for (const script of STEALTH_SCRIPTS) {
        expect(script).toHaveProperty("name");
        expect(script).toHaveProperty("code");
        expect(typeof script.name).toBe("string");
        expect(typeof script.code).toBe("string");
        expect(script.name.length).toBeGreaterThan(0);
        expect(script.code.length).toBeGreaterThan(0);
      }
    });

    it("脚本名称应唯一", () => {
      const names = STEALTH_SCRIPTS.map((s) => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("数组应被深冻结（数组 + 元素都不可变）", () => {
      // 数组本身冻结
      expect(Object.isFrozen(STEALTH_SCRIPTS)).toBe(true);
      // 每个元素也应冻结（防止 code 字段被运行时污染）
      for (const script of STEALTH_SCRIPTS) {
        expect(Object.isFrozen(script)).toBe(true);
      }
    });
  });

  describe("核心反检测项覆盖", () => {
    const allCode = STEALTH_SCRIPTS.map((s) => s.code).join("\n");

    it("应包含 navigator.webdriver 隐藏（最关键）", () => {
      expect(allCode).toContain("webdriver");
      expect(allCode).toContain("undefined");
    });

    it("应包含 navigator.plugins 模拟", () => {
      expect(allCode).toContain("plugins");
      // 至少模拟一个常见插件名
      expect(allCode).toContain("PDF");
    });

    it("应包含 navigator.languages 设置", () => {
      expect(allCode).toContain("languages");
      expect(allCode).toMatch(/en-US|en/);
    });

    it("应包含 WebGL vendor/renderer 掩码", () => {
      expect(allCode).toMatch(/WebGL|webgl/i);
      expect(allCode).toContain("37445"); // UNMASKED_VENDOR_WEBGL
      expect(allCode).toContain("37446"); // UNMASKED_RENDERER_WEBGL
    });

    it("应包含 window.chrome 运行时模拟", () => {
      expect(allCode).toContain("chrome");
      expect(allCode).toContain("runtime");
    });

    it("不应包含空枚举字段（OnInstalledReason 等会被严格检测识别）", () => {
      // 空枚举对象是反检测漏洞，目标站可检测 Object.keys(...).length === 0
      expect(allCode).not.toContain("OnInstalledReason");
      expect(allCode).not.toContain("PlatformArch");
    });
  });

  describe("脚本语法合法性", () => {
    it("每条脚本都应可被 new Function 解析（语法合法）", () => {
      // 注意：stealth 脚本依赖浏览器上下文（navigator, WebGLRenderingContext 等），
      // 在 Node.js 中执行必然 ReferenceError，因此仅验证语法合法性，不强制执行
      for (const script of STEALTH_SCRIPTS) {
        expect(() => {
           
          new Function(script.code);
        }).not.toThrow();
      }
    });
  });

  describe("getStealthScriptCode()", () => {
    it("应返回非空字符串（合并后的 IIFE）", () => {
      const code = getStealthScriptCode();
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });

    it("应包含所有脚本的 IIFE 包装", () => {
      const code = getStealthScriptCode();
      // 合并格式：(function(){...})();
      const iifeCount = (code.match(/\(function\(\)\{/g) || []).length;
      expect(iifeCount).toBe(STEALTH_SCRIPTS.length);
    });

    it("多次调用应返回相同引用（缓存优化）", () => {
      const code1 = getStealthScriptCode();
      const code2 = getStealthScriptCode();
      expect(code1).toBe(code2);
    });

    it("应包含 webdriver 隐藏内容", () => {
      const code = getStealthScriptCode();
      expect(code).toContain("webdriver");
      expect(code).toContain("undefined");
    });
  });
});
