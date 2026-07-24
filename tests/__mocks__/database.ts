import { vi } from "vitest";

/**
 * Mock 数据库连接池
 */
export function createMockPool() {
  return {
    query: vi.fn((_sql: string, _params?: unknown[]) =>
      Promise.resolve({ rows: [], rowCount: 0 }),
    ),
    connect: vi.fn(() =>
      Promise.resolve({
        query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
        release: vi.fn(),
      }),
    ),
    end: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
  };
}

/**
 * Mock 数据库（带内存 Map 存储代理数据）
 */
export function createMockDatabase() {
  const proxies = new Map<string, Record<string, unknown>>();

  return {
    query: vi.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes("SELECT")) {
        return Promise.resolve({
          rows: Array.from(proxies.values()),
          rowCount: proxies.size,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    _proxies: proxies,
  };
}
