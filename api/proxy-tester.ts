/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Tester - 测试代理可用性
 * 快速检测代理是否可用，筛选出可用的代理
 * 支持数据库集成
 */

import type { ProxyInfo } from "./proxy-fetcher.js";
import { PROXY_TEST_CONFIG, DATABASE_CONFIG } from "./config.js";
import { isDatabaseReady } from "../lib/database/connection.js";
import {
  insertDeprecatedProxy,
} from "../lib/database/deprecated-proxies-dao.js";

// 代理黑名单（失败的代理，内存模式）
const failedProxyBlacklist = new Map<string, number>();

/**
 * 测试单个代理
 */
export async function testProxy(proxy: ProxyInfo): Promise<{
  success: boolean;
  proxy: ProxyInfo;
  latency?: number;
  error?: string;
}> {
  // 检查是否在黑名单中（内存模式）
  if (!isDatabaseReady()) {
    const blacklistKey = `${proxy.ip}:${proxy.port}`;
    const blacklistExpiry = failedProxyBlacklist.get(blacklistKey);
    if (blacklistExpiry && Date.now() < blacklistExpiry) {
      return {
        success: false,
        proxy,
        error: "In blacklist",
      };
    }
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PROXY_TEST_CONFIG.testTimeout,
    );

    const response = await fetch(PROXY_TEST_CONFIG.testUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Proxy-Connection": "Keep-Alive",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;

    if (response.ok) {
      console.log(
        `[ProxyTester] 代理可用: ${proxy.ip}:*** (延迟: ${latency}ms)`,
      );
      return {
        success: true,
        proxy,
        latency,
      };
    } else {
      markProxyAsFailed(proxy);
      return {
        success: false,
        proxy,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    markProxyAsFailed(proxy);
    return {
      success: false,
      proxy,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 并行测试多个代理，快速筛选可用代理
 */
export async function testProxiesInBatch(
  proxies: ProxyInfo[],
  maxWorkers: number = 5,
  minSuccessCount: number = 3,
): Promise<ProxyInfo[]> {
  if (proxies.length === 0) {
    return [];
  }

  console.log(`[ProxyTester] 开始测试 ${proxies.length} 个代理...`);

  // 并行测试，但限制并发数
  const results: Array<{ success: boolean; proxy: ProxyInfo }> = [];

  for (let i = 0; i < proxies.length; i += maxWorkers) {
    const batch = proxies.slice(i, i + maxWorkers);
    const batchResults = await Promise.all(
      batch.map((proxy) => testProxy(proxy)),
    );

    for (const result of batchResults) {
      if (result.success) {
        results.push({ success: true, proxy: result.proxy });
      }
    }

    // 如果已经找到足够的可用代理，提前结束
    if (results.length >= minSuccessCount) {
      console.log(
        `[ProxyTester] 已找到 ${results.length} 个可用代理，提前结束测试`,
      );
      break;
    }
  }

  // 按延迟排序（最快的在前）
  const sortedResults = await Promise.all(
    results.map(async (r) => {
      const testResult = await testProxy(r.proxy);
      return testResult;
    }),
  );

  sortedResults.sort(
    (a, b) => (a.latency || Infinity) - (b.latency || Infinity),
  );

  console.log(
    `[ProxyTester] 测试完成，找到 ${sortedResults.length} 个可用代理`,
  );

  return sortedResults.map((r) => r.proxy);
}

/**
 * 快速检测代理是否可用（非严格测试）
 */
export async function quickTestProxy(_proxy: ProxyInfo): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PROXY_TEST_CONFIG.quickTestTimeout,
    );

    const response = await fetch(PROXY_TEST_CONFIG.testUrl, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 批量快速测试代理
 */
export async function quickTestProxies(
  proxies: ProxyInfo[],
  timeoutPerProxy: number = PROXY_TEST_CONFIG.quickTestTimeout,
): Promise<ProxyInfo[]> {
  console.log(`[ProxyTester] 快速测试 ${proxies.length} 个代理...`);

  const results = await Promise.all(
    proxies.map(async (proxy) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutPerProxy);

        const response = await fetch(PROXY_TEST_CONFIG.testUrl, {
          method: "HEAD",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return proxy;
        }
      } catch {
        // 测试失败，忽略
      }
      return null;
    }),
  );

  const availableProxies = results.filter((p): p is ProxyInfo => p !== null);
  console.log(`[ProxyTester] 快速测试完成，${availableProxies.length} 个可用`);

  return availableProxies;
}

/**
 * 检测代理可达性（使用前检测）
 */
export async function checkProxyReachability(proxy: ProxyInfo): Promise<{
  reachable: boolean;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PROXY_TEST_CONFIG.quickTestTimeout,
    );

    const response = await fetch(PROXY_TEST_CONFIG.testUrl, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { reachable: true };
    } else {
      return {
        reachable: false,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 标记代理为失败
 */
function markProxyAsFailed(proxy: ProxyInfo): void {
  const key = `${proxy.ip}:${proxy.port}`;

  // 如果使用数据库模式，不需要内存黑名单
  if (!isDatabaseReady()) {
    failedProxyBlacklist.set(
      key,
      Date.now() + PROXY_TEST_CONFIG.blacklistDuration,
    );
  }

  console.log(`[ProxyTester] 代理失效: ${proxy.ip}:***，加入黑名单`);
}

/**
 * 将不可达代理移入废弃表（数据库模式）
 */
export async function moveUnreachableProxyToDeprecated(
  proxy: ProxyInfo,
  error?: string,
): Promise<void> {
  if (!isDatabaseReady()) {
    // 内存模式，只记录到黑名单
    markProxyAsFailed(proxy);
    return;
  }

  try {
    console.log(
      `[ProxyTester] 代理不可达，移入废弃表: ${proxy.ip}:*** (${error || "Unknown error"})`,
    );

    await insertDeprecatedProxy({
      ip: proxy.ip,
      port: parseInt(proxy.port, 10),
      source: proxy.source,
      protocol: "http",
      failure_count: DATABASE_CONFIG.failureThreshold, // 直接设为最大值
      created_at: new Date(proxy.timestamp),
    });
  } catch (err) {
    console.error("[ProxyTester] 移入废弃表失败:", err);
  }
}

/**
 * 清理过期黑名单（内存模式）
 */
export function cleanupBlacklist(): void {
  const now = Date.now();
  for (const [key, expiry] of failedProxyBlacklist.entries()) {
    if (now > expiry) {
      failedProxyBlacklist.delete(key);
    }
  }
  console.log(
    `[ProxyTester] 黑名单清理完成，剩余 ${failedProxyBlacklist.size} 个`,
  );
}

/**
 * 获取黑名单状态
 */
export function getBlacklistStatus(): { size: number; samples: string[] } {
  const samples = Array.from(failedProxyBlacklist.keys()).slice(0, 5);
  return {
    size: failedProxyBlacklist.size,
    samples,
  };
}
