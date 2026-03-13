import { vi } from 'vitest';

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.ENABLE_API_KEY = 'false';
process.env.ENABLE_RATE_LIMIT = 'false';

// Mock 全局 fetch
global.fetch = vi.fn();

// 清理每个测试后的状态
afterEach(() => {
  vi.clearAllMocks();
});
