import { vi } from 'vitest';

export function createMockPool() {
  return {
    query: vi.fn((sql: string, params?: any[]) => 
      Promise.resolve({ rows: [], rowCount: 0 })
    ),
    connect: vi.fn(() => Promise.resolve({
      query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    })),
    end: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
  };
}

export function createMockDatabase() {
  const proxies = new Map<string, any>();
  
  return {
    query: vi.fn((sql: string, params?: any[]) => {
      if (sql.includes('SELECT')) {
        return Promise.resolve({ rows: Array.from(proxies.values()), rowCount: proxies.size });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    _proxies: proxies,
  };
}
