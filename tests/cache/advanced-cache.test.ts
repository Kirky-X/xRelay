/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * AdvancedCache 测试 - 验证真 LRU 实现
 *
 * 覆盖目标：
 * 1. get 命中时移到末尾（LRU 顺序更新）
 * 2. evictLru 淘汰最旧（keys().next().value）
 * 3. hitRate 正确计算（hits / (hits + misses)）
 * 4. TTL 过期
 * 5. invalidateByTag
 * 6. 已存在 key 的 set 更新顺序
 */

import { describe, it, expect } from "vitest";
import { AdvancedCache } from "../../src/cache/advanced-cache.js";

describe("AdvancedCache - LRU 行为", () => {
  it("get 命中应将条目移到末尾（最近使用）", () => {
    const cache = new AdvancedCache<string>(3, 60000);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // 访问 "a"，应移到末尾
    cache.get("a");

    // 再插入 "d"，应淘汰最旧的 "b"（"a" 已被 get 移到末尾）
    cache.set("d", "4");

    expect(cache.get("b")).toBeNull(); // 被淘汰
    expect(cache.get("a")).toBe("1"); // 仍在
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  it("evictLru 应淘汰最早插入的条目", () => {
    const cache = new AdvancedCache<string>(2, 60000);
    cache.set("a", "1");
    cache.set("b", "2");

    // 插入 "c"，应淘汰 "a"（最早插入）
    cache.set("c", "3");

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("已存在的 key 的 set 应更新顺序（移到末尾）", () => {
    const cache = new AdvancedCache<string>(2, 60000);
    cache.set("a", "1");
    cache.set("b", "2");

    // 更新 "a"，应移到末尾
    cache.set("a", "updated");

    // 插入 "c"，应淘汰 "b"（"a" 已被 set 移到末尾）
    cache.set("c", "3");

    expect(cache.get("a")).toBe("updated");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe("3");
  });

  it("TTL 过期后 get 应返回 null 并删除", () => {
    const cache = new AdvancedCache<string>(10, 100); // 100ms TTL
    cache.set("a", "1");

    // 等待 TTL 过期
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get("a")).toBeNull();
        resolve();
      }, 150);
    });
  });

  it("invalidateByTag 应删除所有带指定 tag 的条目", () => {
    const cache = new AdvancedCache<string>(10, 60000);
    cache.set("a", "1", undefined, ["group1", "shared"]);
    cache.set("b", "2", undefined, ["group1"]);
    cache.set("c", "3", undefined, ["group2"]);

    cache.invalidateByTag("group1");

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe("3");
  });

  it("hitRate 应正确计算 hits / (hits + misses)", () => {
    const cache = new AdvancedCache<string>(10, 60000);
    cache.set("a", "1");

    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("b"); // miss

    const stats = cache.getStats();
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
  });

  it("空缓存 hitRate 应为 0", () => {
    const cache = new AdvancedCache<string>(10, 60000);
    const stats = cache.getStats();
    expect(stats.hitRate).toBe(0);
  });

  it("clear 应清空所有条目", () => {
    const cache = new AdvancedCache<string>(10, 60000);
    cache.set("a", "1");
    cache.set("b", "2");

    cache.clear();

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    const stats = cache.getStats();
    expect(stats.size).toBe(0);
  });

  it("getStats 应返回正确的 size 和 maxSize", () => {
    const cache = new AdvancedCache<string>(5, 60000);
    cache.set("a", "1");
    cache.set("b", "2");

    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(5);
  });

  it("连续淘汰多次应正确维护顺序", () => {
    const cache = new AdvancedCache<string>(3, 60000);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // 淘汰 a
    cache.set("e", "5"); // 淘汰 b

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
    expect(cache.get("e")).toBe("5");
  });
});
