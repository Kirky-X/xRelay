/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * User-Agent 轮换模块测试
 * 验证：
 * 1. UA 池非空且包含真实浏览器 UA
 * 2. getRandomUserAgent 返回池中元素
 * 3. 多次调用应该分布到不同 UA（统计性验证）
 * 4. getDefaultUserAgent 返回稳定默认值
 */

import { describe, it, expect } from "vitest";
import {
  USER_AGENTS,
  getRandomUserAgent,
  getDefaultUserAgent,
  getUserAgentByIndex,
} from "../../src/utils/user-agent.js";

describe("User-Agent 轮换模块", () => {
  describe("UA 池", () => {
    it("池非空（至少 5 个 UA）", () => {
      expect(USER_AGENTS.length).toBeGreaterThanOrEqual(5);
    });

    it("所有 UA 都包含 Mozilla/5.0 前缀", () => {
      for (const ua of USER_AGENTS) {
        expect(ua).toMatch(/^Mozilla\/5\.0/);
      }
    });

    it("UA 池应包含 Chrome 与 Firefox", () => {
      const hasChrome = USER_AGENTS.some((ua) => /Chrome\//.test(ua));
      const hasFirefox = USER_AGENTS.some((ua) => /Firefox\//.test(ua));
      // 至少要有 Chrome（生产环境主流）
      expect(hasChrome).toBe(true);
      // Firefox 可选，但有更好
      expect(hasFirefox).toBe(true);
    });

    it("所有 UA 应包含平台信息（Windows/Mac/Linux）", () => {
      for (const ua of USER_AGENTS) {
        const hasPlatform =
          /Windows/.test(ua) || /Macintosh/.test(ua) || /Linux/.test(ua);
        expect(hasPlatform).toBe(true);
      }
    });
  });

  describe("getRandomUserAgent", () => {
    it("返回字符串", () => {
      const ua = getRandomUserAgent();
      expect(typeof ua).toBe("string");
      expect(ua.length).toBeGreaterThan(50);
    });

    it("返回的 UA 在池中", () => {
      const ua = getRandomUserAgent();
      expect(USER_AGENTS).toContain(ua);
    });

    it("调用 100 次应至少出现 3 个不同 UA（避免确定性轮换）", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) {
        seen.add(getRandomUserAgent());
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe("getDefaultUserAgent", () => {
    it("返回稳定的默认 UA（多次调用结果相同）", () => {
      const a = getDefaultUserAgent();
      const b = getDefaultUserAgent();
      expect(a).toBe(b);
    });

    it("默认 UA 在池中", () => {
      expect(USER_AGENTS).toContain(getDefaultUserAgent());
    });
  });

  describe("getUserAgentByIndex", () => {
    it("返回指定索引的 UA", () => {
      const ua = getUserAgentByIndex(0);
      expect(ua).toBe(USER_AGENTS[0]);
    });

    it("负索引应取最后一个", () => {
      const ua = getUserAgentByIndex(-1);
      expect(ua).toBe(USER_AGENTS[USER_AGENTS.length - 1]);
    });

    it("超界索引应回环（mod 运算）", () => {
      const ua = getUserAgentByIndex(USER_AGENTS.length);
      expect(ua).toBe(USER_AGENTS[0]);
    });
  });
});
