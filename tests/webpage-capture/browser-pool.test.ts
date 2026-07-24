/** Copyright (c) 2026 Kirky-x License: MIT */

/**
 * 网页捕获 - 浏览器池单元测试
 *
 * 覆盖 BrowserPool 类的全部公开方法（getInstance / getPage / shutdown / getStats）
 * 以及 getBrowserPool 便捷函数。任务用例中提到的 getBrowser/closeBrowser/
 * getBrowserPoolStatus 在源码中分别对应 getPage/shutdown/getStats。
 *
 * 关键技术点：
 * - vi.hoisted 提升 mock 引用，确保 vi.resetModules 后 mock 函数引用稳定
 * - vi.resetModules + 动态 import 重新加载 BrowserPool 类，重置单例静态字段
 * - vi.useFakeTimers 避免 cleanupInterval 真实触发干扰 instance 计数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- hoisted mock 引用 ----
const mocks = vi.hoisted(() => {
  const pageClose = vi.fn();
  const setViewport = vi.fn();
  const evaluateOnNewDocument = vi.fn();
  const page = {
    close: pageClose,
    setViewport,
    evaluateOnNewDocument,
  };
  const newPage = vi.fn();
  const browserClose = vi.fn();
  const browserOn = vi.fn();
  const browser = {
    newPage,
    close: browserClose,
    on: browserOn,
  };
  const launch = vi.fn();

  // 可变 puppeteer mock 控制：puppeteerDefaultExecutablePath 控制兜底分支可执行路径
  // 测试中可让其抛错以覆盖 resolveLaunchOptions 的 catch 分支
  const puppeteerDefaultExecutablePath = vi.fn(() => '/mocked/puppeteer/chrome');

  // 可变 config 引用：测试中可调整 POOL_CONFIG 以触发不同分支
  // 对象引用稳定，修改属性会影响所有引用方（含 browser-pool.ts 内的 POOL_CONFIG）
  const configMock = {
    BROWSER_CONFIG: { headless: true, args: ['--no-sandbox'] },
    PAGE_CONFIG: {
      defaultViewport: { width: 1920, height: 1080 },
      defaultUserAgent: 'mock-ua',
      defaultTimeout: 30000,
    },
    POOL_CONFIG: {
      maxInstances: 3,
      maxPagesPerInstance: 10,
      idleTimeout: 60000,
    },
  };

  return {
    launch,
    newPage,
    pageClose,
    setViewport,
    evaluateOnNewDocument,
    browserClose,
    browserOn,
    // 暴露 mock 对象本身（不可变快照，用于断言 mockIdentity）
    pageRef: page,
    browserRef: browser,
    configMock,
    puppeteerDefaultExecutablePath,
  };
});

// ---- 模块 mock ----
vi.mock('puppeteer-core', () => ({
  default: {
    launch: mocks.launch,
    executablePath: vi.fn(),
  },
  launch: mocks.launch,
  executablePath: vi.fn(),
}));

// 兜底 dynamic import('puppeteer') 也需 mock，避免真实加载
// executablePath 引用 hoisted mock，测试中可让其抛错以覆盖 catch 分支
vi.mock('puppeteer', () => ({
  default: {
    executablePath: mocks.puppeteerDefaultExecutablePath,
  },
}));

vi.mock('@sparticuz/chromium', () => ({
  default: {
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: vi.fn().mockResolvedValue('/tmp/chromium'),
    setGraphicsMode: true,
  },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  executablePath: vi.fn().mockResolvedValue('/tmp/chromium'),
  setGraphicsMode: true,
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/webpage-capture/config.js', () => mocks.configMock);

vi.mock('../../src/webpage-capture/stealth-scripts.js', () => ({
  getStealthScriptCode: vi.fn().mockReturnValue('/* stealth-code */'),
}));

// ---- 动态导入类型 ----
type BrowserPoolModule = typeof import('../../src/webpage-capture/browser-pool.js');
let BrowserPool: BrowserPoolModule['BrowserPool'];
let getBrowserPool: BrowserPoolModule['getBrowserPool'];

describe('BrowserPool', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    // 重置可变 config 为默认值（部分测试会调整以触发不同分支）
    mocks.configMock.POOL_CONFIG.maxInstances = 3;
    mocks.configMock.POOL_CONFIG.maxPagesPerInstance = 10;
    mocks.configMock.POOL_CONFIG.idleTimeout = 60000;

    // 重置所有 mock 并重新建立默认实现
    mocks.launch.mockReset();
    mocks.newPage.mockReset();
    mocks.pageClose.mockReset();
    mocks.setViewport.mockReset();
    mocks.evaluateOnNewDocument.mockReset();
    mocks.browserClose.mockReset();
    mocks.browserOn.mockReset();
    mocks.puppeteerDefaultExecutablePath.mockReset();
    mocks.puppeteerDefaultExecutablePath.mockReturnValue('/mocked/puppeteer/chrome');

    mocks.setViewport.mockResolvedValue(undefined);
    mocks.evaluateOnNewDocument.mockResolvedValue(undefined);
    mocks.pageClose.mockResolvedValue(undefined);
    mocks.browserClose.mockResolvedValue(undefined);
    mocks.newPage.mockResolvedValue(mocks.pageRef);
    mocks.launch.mockResolvedValue(mocks.browserRef);

    // 重新加载模块以重置 BrowserPool 静态单例字段
    const mod = await import('../../src/webpage-capture/browser-pool.js');
    BrowserPool = mod.BrowserPool;
    getBrowserPool = mod.getBrowserPool;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getPage 在浏览器未启动时调用 puppeteer.launch 并返回 page', async () => {
    const pool = BrowserPool.getInstance();
    const result = await pool.getPage();

    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.newPage).toHaveBeenCalledTimes(1);
    expect(result.page).toBeDefined();
    expect(typeof result.release).toBe('function');
  });

  it('getPage 在浏览器已启动时直接返回缓存实例（launch 只调用一次）', async () => {
    const pool = BrowserPool.getInstance();
    await pool.getPage();
    await pool.getPage();

    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.newPage).toHaveBeenCalledTimes(2);
  });

  it('getPage 调用 browser.newPage 并返回 page + release 函数', async () => {
    const pool = BrowserPool.getInstance();
    const result = await pool.getPage();

    expect(mocks.newPage).toHaveBeenCalledTimes(1);
    expect(result.page).toBe(mocks.pageRef);
    expect(typeof result.release).toBe('function');
  });

  it('getPage 在 browser.newPage 失败时抛出错误', async () => {
    mocks.newPage.mockRejectedValueOnce(new Error('newPage failed'));

    const pool = BrowserPool.getInstance();
    await expect(pool.getPage()).rejects.toThrow('newPage failed');
  });

  it('shutdown 调用 browser.close 并清空缓存', async () => {
    const pool = BrowserPool.getInstance();
    await pool.getPage();

    expect(pool.getStats().instanceCount).toBe(1);

    await pool.shutdown();

    expect(mocks.browserClose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('shutdown 在无浏览器时不抛错', async () => {
    const pool = BrowserPool.getInstance();
    await expect(pool.shutdown()).resolves.toBeUndefined();
    expect(mocks.browserClose).not.toHaveBeenCalled();
  });

  it('getStats 返回正确状态（active/pending/closed）', async () => {
    const pool = BrowserPool.getInstance();

    // 初始状态：无实例
    expect(pool.getStats()).toEqual({ instanceCount: 0, totalPages: 0, instances: [] });

    // 创建一个实例并占用一页
    const r = await pool.getPage();
    const stats1 = pool.getStats();
    expect(stats1.instanceCount).toBe(1);
    expect(stats1.totalPages).toBe(1);
    expect(stats1.instances[0].pageCount).toBe(1);

    // 释放后 totalPages 归零，实例仍保留
    await r.release();
    const stats2 = pool.getStats();
    expect(stats2.instanceCount).toBe(1);
    expect(stats2.totalPages).toBe(0);
    expect(stats2.instances[0].pageCount).toBe(0);

    // 关闭后清空
    await pool.shutdown();
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('并发 getPage 调用正确复用浏览器实例', async () => {
    const pool = BrowserPool.getInstance();
    // 并发发起 5 个 getPage，maxPagesPerInstance=10，应全部复用同一实例
    const results = await Promise.all([
      pool.getPage(),
      pool.getPage(),
      pool.getPage(),
      pool.getPage(),
      pool.getPage(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.newPage).toHaveBeenCalledTimes(5);
    for (const r of results) {
      expect(r.page).toBe(mocks.pageRef);
    }
    expect(pool.getStats().instanceCount).toBe(1);
    expect(pool.getStats().totalPages).toBe(5);
  });

  it('调用 release 后页面关闭且 pageCount 减少（重复 release 幂等）', async () => {
    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();
    expect(pool.getStats().totalPages).toBe(1);

    await r.release();
    expect(mocks.pageClose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().totalPages).toBe(0);

    // 重复 release 应幂等无副作用
    await r.release();
    expect(mocks.pageClose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().totalPages).toBe(0);
  });

  it('浏览器断开事件触发清理（disconnected 回调移除实例）', async () => {
    const pool = BrowserPool.getInstance();
    await pool.getPage();

    expect(pool.getStats().instanceCount).toBe(1);

    // browser-pool.createInstance 注册了 browser.on('disconnected', cb)
    // 手动触发该回调以模拟浏览器崩溃
    expect(mocks.browserOn).toHaveBeenCalledWith('disconnected', expect.any(Function));
    const disconnectedCb = mocks.browserOn.mock.calls.find(
      (c) => c[0] === 'disconnected',
    )![1] as () => void;
    disconnectedCb();

    // 断开后实例被移除
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('getBrowserPool 返回单例（多次调用返回同一实例）', () => {
    const a = getBrowserPool();
    const b = getBrowserPool();
    expect(a).toBe(b);
  });
});

describe('BrowserPool - 等待队列与清理（覆盖未覆盖分支）', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    // 默认 config
    mocks.configMock.POOL_CONFIG.maxInstances = 3;
    mocks.configMock.POOL_CONFIG.maxPagesPerInstance = 10;
    mocks.configMock.POOL_CONFIG.idleTimeout = 60000;

    mocks.launch.mockReset();
    mocks.newPage.mockReset();
    mocks.pageClose.mockReset();
    mocks.setViewport.mockReset();
    mocks.evaluateOnNewDocument.mockReset();
    mocks.browserClose.mockReset();
    mocks.browserOn.mockReset();
    mocks.puppeteerDefaultExecutablePath.mockReset();
    mocks.puppeteerDefaultExecutablePath.mockReturnValue('/mocked/puppeteer/chrome');

    mocks.setViewport.mockResolvedValue(undefined);
    mocks.evaluateOnNewDocument.mockResolvedValue(undefined);
    mocks.pageClose.mockResolvedValue(undefined);
    mocks.browserClose.mockResolvedValue(undefined);
    mocks.newPage.mockResolvedValue(mocks.pageRef);
    mocks.launch.mockResolvedValue(mocks.browserRef);

    const mod = await import('../../src/webpage-capture/browser-pool.js');
    BrowserPool = mod.BrowserPool;
    getBrowserPool = mod.getBrowserPool;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('达到 maxInstances 限制时 getPage 进入等待队列，release 后唤醒等待者复用实例', async () => {
    // 限制为单实例单页，强制第二个 getPage 进入等待队列
    mocks.configMock.POOL_CONFIG.maxInstances = 1;
    mocks.configMock.POOL_CONFIG.maxPagesPerInstance = 1;

    const pool = BrowserPool.getInstance();
    const r1 = await pool.getPage();

    // 第二个 getPage 进入等待队列（不立即返回）
    const p2 = pool.getPage();
    // 让 microtask flush，确保 waitQueue 已注册
    await Promise.resolve();

    // 此时仍只有 1 个实例、1 个 page
    expect(pool.getStats().instanceCount).toBe(1);
    expect(pool.getStats().totalPages).toBe(1);

    // release 后唤醒等待者，复用同一实例
    await r1.release();
    const r2 = await p2;

    expect(mocks.launch).toHaveBeenCalledTimes(1); // 仅创建 1 个实例
    expect(r2.page).toBe(mocks.pageRef);
    expect(pool.getStats().instanceCount).toBe(1);
  });

  it('等待实例超过 ACQUIRE_TIMEOUT(30s) 时 getPage 抛出 timeout 错误', async () => {
    mocks.configMock.POOL_CONFIG.maxInstances = 1;
    mocks.configMock.POOL_CONFIG.maxPagesPerInstance = 1;

    const pool = BrowserPool.getInstance();
    await pool.getPage(); // 占满唯一实例

    // 预先附加 catch，避免推进时间后 promise 已 reject 造成 unhandledRejection
    const p2 = pool.getPage().catch((e: unknown) => e as Error);
    await Promise.resolve(); // 让 waitQueue 注册

    // 推进时间超过 30s 触发 timeout
    await vi.advanceTimersByTimeAsync(30001);

    const err = await p2;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Timeout waiting for available browser instance');
  });

  it('cleanupIdleInstances 清理空闲超过 idleTimeout 的实例', async () => {
    // 缩短 idleTimeout 以便快速触发
    mocks.configMock.POOL_CONFIG.idleTimeout = 1000;

    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();
    await r.release();

    expect(pool.getStats().instanceCount).toBe(1);

    // cleanupInterval 每 idleTimeout/2 触发一次；推进时间需让某次 cleanup 时
    // now - lastUsed > idleTimeout 成立
    // 推进 2001ms：interval 在 500/1000/1500/2000 触发；2000ms 时 now-lastUsed=2000 > 1000 成立
    await vi.advanceTimersByTimeAsync(2001);

    expect(mocks.browserClose).toHaveBeenCalled();
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('shutdown 时 browser.close 抛错被吞掉，不中断关闭流程', async () => {
    const pool = BrowserPool.getInstance();
    await pool.getPage();

    // 让 browser.close 抛错
    mocks.browserClose.mockRejectedValueOnce(new Error('close failed'));

    // shutdown 不应抛错
    await expect(pool.shutdown()).resolves.toBeUndefined();
    // instances 仍然被清空
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('cleanupIdleInstances 中 browser.close 抛错被吞掉，实例仍被移除', async () => {
    mocks.configMock.POOL_CONFIG.idleTimeout = 1000;

    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();
    await r.release();

    // cleanup 时 browser.close 抛错
    mocks.browserClose.mockRejectedValueOnce(new Error('close failed'));

    await vi.advanceTimersByTimeAsync(2001);

    // 即使 close 抛错，实例仍被 removeInstance 移除
    expect(pool.getStats().instanceCount).toBe(0);
  });

  it('shutdown 后再调用 getPage 抛出 isShuttingDown 错误', async () => {
    const pool = BrowserPool.getInstance();
    await pool.shutdown();

    await expect(pool.getPage()).rejects.toThrow('BrowserPool is shutting down');
  });

  it('release 时 page.close 抛错被吞掉，不影响后续统计', async () => {
    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();

    // page.close 抛错
    mocks.pageClose.mockRejectedValueOnce(new Error('page close failed'));

    // release 不应抛错
    await expect(r.release()).resolves.toBeUndefined();
    // pageCount 仍正确减少
    expect(pool.getStats().totalPages).toBe(0);
  });

  it('VERCEL=1 环境下 getPage 走 @sparticuz/chromium 分支正常工作', async () => {
    process.env.VERCEL = '1';

    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(r.page).toBe(mocks.pageRef);

    await pool.shutdown();
    delete process.env.VERCEL;
  });

  it('CHROME_PATH 设置时 getPage 走 chromePath 分支正常工作', async () => {
    process.env.CHROME_PATH = '/custom/chrome/path';

    const pool = BrowserPool.getInstance();
    const r = await pool.getPage();
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(r.page).toBe(mocks.pageRef);

    await pool.shutdown();
    delete process.env.CHROME_PATH;
  });

  it('puppeteer executablePath 抛错时 getPage 抛出 Unable to resolve 错误（覆盖 catch 分支）', async () => {
    // 不设置 VERCEL / CHROME_PATH，强制走 dynamic import('puppeteer') 兜底
    delete process.env.VERCEL;
    delete process.env.CHROME_PATH;
    // 让 puppeteerFull.executablePath() 抛错，触发 resolveLaunchOptions 的 catch
    mocks.puppeteerDefaultExecutablePath.mockImplementation(() => {
      throw new Error('exec path not found');
    });
    vi.resetModules();

    const mod = await import('../../src/webpage-capture/browser-pool.js');
    const pool = mod.BrowserPool.getInstance();

    await expect(pool.getPage()).rejects.toThrow('Unable to resolve Chromium executable path');
  });
});
