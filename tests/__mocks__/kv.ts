import { vi } from "vitest";

/**
 * Mock Vercel KV / Upstash Redis 客户端
 * 使用内存 Map 存储，模拟异步行为
 */
export function createMockKV() {
  const store = new Map<string, unknown>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: unknown, _options?: { px?: number }) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    del: vi.fn((key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    incr: vi.fn((key: string) => {
      const current = ((store.get(key) as number) || 0) + 1;
      store.set(key, current);
      return Promise.resolve(current);
    }),
    pexpire: vi.fn((key: string, _ms: number) => {
      return Promise.resolve(store.has(key) ? 1 : 0);
    }),
    pttl: vi.fn((key: string) => {
      return Promise.resolve(store.has(key) ? 60000 : -1);
    }),
    scanIterator: vi.fn(function* (options?: { match?: string }) {
      for (const key of store.keys()) {
        if (options?.match) {
          // Escape regex special chars then convert glob * to .* pattern
          const escaped = options.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
          if (!new RegExp(escaped, 'i').test(key)) {
            continue;
          }
        }
        yield key;
      }
    }),
    _store: store, // 用于测试中直接访问
  };
}

export type MockKV = ReturnType<typeof createMockKV>;
