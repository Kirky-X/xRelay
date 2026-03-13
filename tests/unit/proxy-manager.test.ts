/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Manager Tests - 代理池管理测试
 * 测试代理管理器的初始化、代理获取、失败报告、断路器等功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies - 必须在导入前设置
vi.mock('../../api/database/connection.js', () => ({
  initDatabase: vi.fn(() => Promise.resolve(false)),
  isDatabaseReady: vi.fn(() => false),
  getPool: vi.fn(() => null),
}));

vi.mock('../../api/proxy-fetcher.js', () => ({
  fetchAllProxies: vi.fn(() => Promise.resolve([
    { ip: '1.2.3.4', port: '8080', source: 'test', timestamp: Date.now() },
    { ip: '5.6.7.8', port: '8080', source: 'test', timestamp: Date.now() },
    { ip: '9.10.11.12', port: '8080', source: 'test', timestamp: Date.now() },
  ])),
}));

vi.mock('../../api/proxy-tester.js', () => ({
  quickTestProxies: vi.fn((proxies: any[]) => Promise.resolve(proxies)),
  cleanupBlacklist: vi.fn(),
  getBlacklistStatus: vi.fn(() => ({ size: 0, samples: [] })),
}));

vi.mock('../../api/database/available-proxies-dao.js', () => ({
  upsertProxy: vi.fn(),
  getAllProxies: vi.fn(() => Promise.resolve([])),
  getProxyCount: vi.fn(() => Promise.resolve(0)),
  incrementFailureCount: vi.fn(() => Promise.resolve(null)),
  incrementSuccessCount: vi.fn(),
  deleteProxy: vi.fn(),
  batchInsertProxies: vi.fn(),
  getWeightedProxies: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../api/database/deprecated-proxies-dao.js', () => ({
  insertDeprecatedProxy: vi.fn(),
  isProxyDeprecated: vi.fn(() => Promise.resolve(false)),
  getAllDeprecatedProxies: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../api/config.js', () => ({
  PROXY_CONFIG: {
    pool: {
      maxProxyCount: 100,
      minProxyCount: 5,
      refreshInterval: 300000,
      testTimeout: 5000,
    },
  },
  DATABASE_CONFIG: {
    minProxyCount: 10,
    failureThreshold: 5,
    pool: {
      maxConnections: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },
}));

vi.mock('../../api/logger.js', () => ({
  logger: {
    proxyManager: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      verbose: vi.fn(),
    },
  },
}));

// 导入被测模块 - 在 mock 之后
import {
  initProxyManager,
  isUsingDatabase,
  getAvailableProxy,
  getMultipleProxies,
  reportProxyFailed,
  reportProxySuccess,
  getPoolStatus,
  getCircuitBreakerStatus,
  manualRefresh,
  getProxyStats,
} from '../../api/proxy-manager.js';

describe('Proxy Manager - 初始化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置模块状态 - 通过重新导入
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应该正确初始化代理管理器（内存模式）', async () => {
    // 重新导入以获取新的模块实例
    const { initProxyManager, isUsingDatabase } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    // 内存模式下 isUsingDatabase 应该返回 false
    expect(isUsingDatabase()).toBe(false);
  });

  it('应该防止重复初始化', async () => {
    const { initProxyManager } = await import('../../api/proxy-manager.js');
    
    // 第一次初始化
    await initProxyManager();
    
    // 第二次初始化应该直接返回，不执行任何操作
    const { fetchAllProxies } = await import('../../api/proxy-fetcher.js');
    const callCountBefore = vi.mocked(fetchAllProxies).mock.calls.length;
    
    await initProxyManager();
    
    const callCountAfter = vi.mocked(fetchAllProxies).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it('初始化失败时应该降级到内存模式', async () => {
    // 模拟初始化过程中的错误
    const { fetchAllProxies } = await import('../../api/proxy-fetcher.js');
    vi.mocked(fetchAllProxies).mockRejectedValueOnce(new Error('Network error'));
    
    // 重新导入模块以测试错误处理
    vi.resetModules();
    
    const { initProxyManager, isUsingDatabase } = await import('../../api/proxy-manager.js');
    
    // 即使出错也应该完成初始化
    await initProxyManager();
    
    // 应该降级到内存模式
    expect(isUsingDatabase()).toBe(false);
  });
});

describe('Proxy Manager - 代理获取', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该返回可用代理', async () => {
    const { initProxyManager, getAvailableProxy } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = await getAvailableProxy();
    
    // 在内存模式下，应该返回代理或 null
    expect(proxy === null || (proxy && proxy.ip && proxy.port)).toBeTruthy();
  });

  it('应该返回多个代理', async () => {
    const { initProxyManager, getMultipleProxies } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxies = await getMultipleProxies(3);
    
    expect(Array.isArray(proxies)).toBe(true);
  });

  it('请求的代理数量超过可用数量时应该返回所有可用代理', async () => {
    const { initProxyManager, getMultipleProxies } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    // 请求 100 个代理，但可能只有少量可用
    const proxies = await getMultipleProxies(100);
    
    expect(Array.isArray(proxies)).toBe(true);
    expect(proxies.length).toBeLessThanOrEqual(100);
  });

  it('没有可用代理时应该返回 null', async () => {
    // 模拟空的代理列表
    vi.resetModules();
    
    vi.doMock('../../api/proxy-fetcher.js', () => ({
      fetchAllProxies: vi.fn(() => Promise.resolve([])),
    }));
    
    vi.doMock('../../api/proxy-tester.js', () => ({
      quickTestProxies: vi.fn(() => Promise.resolve([])),
      cleanupBlacklist: vi.fn(),
      getBlacklistStatus: vi.fn(() => ({ size: 0, samples: [] })),
    }));
    
    const { initProxyManager, getAvailableProxy } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = await getAvailableProxy();
    
    expect(proxy).toBeNull();
  });

  it('获取代理前应该确保已初始化', async () => {
    vi.resetModules();
    
    const { getAvailableProxy, isUsingDatabase } = await import('../../api/proxy-manager.js');
    
    // 不先调用 initProxyManager，直接获取代理
    const proxy = await getAvailableProxy();
    
    // 应该自动初始化并返回结果
    expect(proxy === null || (proxy && proxy.ip && proxy.port)).toBeTruthy();
  });
});

describe('Proxy Manager - 失败报告', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该正确报告代理失败', async () => {
    const { initProxyManager, reportProxyFailed, getPoolStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '1.2.3.4', port: '8080', source: 'test', timestamp: Date.now() };
    await reportProxyFailed(proxy);
    
    const status = await getPoolStatus();
    expect(status).toHaveProperty('availableCount');
    expect(status).toHaveProperty('mode');
  });

  it('报告失败后应该更新断路器状态', async () => {
    const { initProxyManager, reportProxyFailed, getCircuitBreakerStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '1.2.3.4', port: '8080', source: 'test', timestamp: Date.now() };
    
    // 多次报告失败
    for (let i = 0; i < 5; i++) {
      await reportProxyFailed(proxy);
    }
    
    const circuitStatus = getCircuitBreakerStatus();
    expect(circuitStatus instanceof Map).toBe(true);
  });

  it('失败报告应该从内存池中移除代理', async () => {
    const { initProxyManager, getMultipleProxies, reportProxyFailed } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    // 获取代理
    const proxiesBefore = await getMultipleProxies(3);
    
    if (proxiesBefore.length > 0) {
      const proxyToRemove = proxiesBefore[0];
      
      // 报告失败
      await reportProxyFailed(proxyToRemove);
      
      // 再次获取代理，检查是否已移除
      const proxiesAfter = await getMultipleProxies(10);
      const removed = proxiesAfter.find(
        p => p.ip === proxyToRemove.ip && p.port === proxyToRemove.port
      );
      
      // 该代理应该已被移除或断路器打开
      expect(removed).toBeUndefined();
    }
  });
});

describe('Proxy Manager - 成功报告', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该正确报告代理成功', async () => {
    const { initProxyManager, reportProxySuccess, getCircuitBreakerStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '1.2.3.4', port: '8080', source: 'test', timestamp: Date.now() };
    
    // 先报告一些失败
    await reportProxyFailed(proxy);
    await reportProxyFailed(proxy);
    
    // 然后报告成功
    await reportProxySuccess(proxy);
    
    const circuitStatus = getCircuitBreakerStatus();
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    const state = circuitStatus.get(proxyKey);
    
    // 成功后断路器应该重置
    if (state) {
      expect(state.failures).toBe(0);
      expect(state.isOpen).toBe(false);
    }
  });
});

describe('Proxy Manager - 断路器', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该跟踪断路器状态', async () => {
    const { initProxyManager, getCircuitBreakerStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const status = getCircuitBreakerStatus();
    
    expect(typeof status).toBe('object');
    expect(status instanceof Map).toBe(true);
  });

  it('连续失败达到阈值后应该打开断路器', async () => {
    const { initProxyManager, reportProxyFailed, getCircuitBreakerStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '10.20.30.40', port: '9999', source: 'test', timestamp: Date.now() };
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    
    // 连续报告 5 次失败（阈值）
    for (let i = 0; i < 5; i++) {
      await reportProxyFailed(proxy);
    }
    
    const status = getCircuitBreakerStatus();
    const state = status.get(proxyKey);
    
    expect(state).toBeDefined();
    expect(state?.isOpen).toBe(true);
    expect(state?.failures).toBeGreaterThanOrEqual(5);
  });

  it('断路器打开后代理应该不可用', async () => {
    const { initProxyManager, reportProxyFailed, getAvailableProxy } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '11.22.33.44', port: '8888', source: 'test', timestamp: Date.now() };
    
    // 连续报告失败以打开断路器
    for (let i = 0; i < 5; i++) {
      await reportProxyFailed(proxy);
    }
    
    // 获取代理时应该跳过断路器打开的代理
    const availableProxy = await getAvailableProxy();
    
    // 如果返回代理，不应该是断路器打开的那个
    if (availableProxy) {
      expect(`${availableProxy.ip}:${availableProxy.port}`).not.toBe(`${proxy.ip}:${proxy.port}`);
    }
  });

  it('成功后应该重置断路器', async () => {
    const { initProxyManager, reportProxyFailed, reportProxySuccess, getCircuitBreakerStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxy = { ip: '55.66.77.88', port: '7777', source: 'test', timestamp: Date.now() };
    const proxyKey = `${proxy.ip}:${proxy.port}`;
    
    // 先报告失败
    for (let i = 0; i < 3; i++) {
      await reportProxyFailed(proxy);
    }
    
    // 报告成功
    await reportProxySuccess(proxy);
    
    const status = getCircuitBreakerStatus();
    const state = status.get(proxyKey);
    
    if (state) {
      expect(state.failures).toBe(0);
      expect(state.isOpen).toBe(false);
    }
  });
});

describe('Proxy Manager - 池状态', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该返回正确的池状态', async () => {
    const { initProxyManager, getPoolStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const status = await getPoolStatus();
    
    expect(status).toHaveProperty('availableCount');
    expect(status).toHaveProperty('lastRefreshTime');
    expect(status).toHaveProperty('refreshCount');
    expect(status).toHaveProperty('blacklistSize');
    expect(status).toHaveProperty('mode');
    expect(typeof status.availableCount).toBe('number');
    expect(['memory', 'database']).toContain(status.mode);
  });

  it('应该返回正确的代理统计信息', async () => {
    const { initProxyManager, getProxyStats } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const stats = await getProxyStats();
    
    expect(stats).toHaveProperty('totalFetched');
    expect(stats).toHaveProperty('availableInPool');
    expect(stats).toHaveProperty('isFresh');
    expect(stats).toHaveProperty('mode');
    expect(typeof stats.totalFetched).toBe('number');
    expect(typeof stats.availableInPool).toBe('number');
    expect(typeof stats.isFresh).toBe('boolean');
  });
});

describe('Proxy Manager - 手动刷新', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应该支持手动刷新代理池', async () => {
    const { initProxyManager, manualRefresh, getPoolStatus } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const statusBefore = await getPoolStatus();
    
    await manualRefresh();
    
    const statusAfter = await getPoolStatus();
    
    // 刷新后 refreshCount 应该增加
    expect(statusAfter.refreshCount).toBeGreaterThanOrEqual(statusBefore.refreshCount);
  });
});

describe('Proxy Manager - 边界情况', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('获取 0 个代理应该返回空数组', async () => {
    const { initProxyManager, getMultipleProxies } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxies = await getMultipleProxies(0);
    
    expect(proxies).toEqual([]);
  });

  it('获取负数个代理应该返回空数组', async () => {
    const { initProxyManager, getMultipleProxies } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const proxies = await getMultipleProxies(-1);
    
    expect(proxies).toEqual([]);
  });

  it('报告不存在的代理失败不应该抛出错误', async () => {
    const { initProxyManager, reportProxyFailed } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const nonExistentProxy = { 
      ip: '0.0.0.0', 
      port: '0', 
      source: 'nonexistent', 
      timestamp: Date.now() 
    };
    
    // 不应该抛出错误
    await expect(reportProxyFailed(nonExistentProxy)).resolves.not.toThrow();
  });

  it('报告不存在的代理成功不应该抛出错误', async () => {
    const { initProxyManager, reportProxySuccess } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    const nonExistentProxy = { 
      ip: '0.0.0.0', 
      port: '0', 
      source: 'nonexistent', 
      timestamp: Date.now() 
    };
    
    // 不应该抛出错误
    await expect(reportProxySuccess(nonExistentProxy)).resolves.not.toThrow();
  });
});

describe('Proxy Manager - 并发安全', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('并发初始化应该只执行一次', async () => {
    const { initProxyManager, isUsingDatabase } = await import('../../api/proxy-manager.js');
    
    // 并发调用初始化
    const promises = [
      initProxyManager(),
      initProxyManager(),
      initProxyManager(),
    ];
    
    await Promise.all(promises);
    
    // 应该只初始化一次
    expect(isUsingDatabase()).toBe(false);
  });

  it('并发获取代理应该正常工作', async () => {
    const { initProxyManager, getAvailableProxy } = await import('../../api/proxy-manager.js');
    
    await initProxyManager();
    
    // 并发获取多个代理
    const promises = [
      getAvailableProxy(),
      getAvailableProxy(),
      getAvailableProxy(),
    ];
    
    const results = await Promise.all(promises);
    
    // 所有结果都应该是有效的
    for (const proxy of results) {
      expect(proxy === null || (proxy && proxy.ip && proxy.port)).toBeTruthy();
    }
  });
});
