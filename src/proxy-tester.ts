/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Tester - 测试代理可用性
 * 快速检测代理是否可用，筛选出可用的代理
 * 支持数据库集成
 *
 * 关键约束：所有测试函数必须通过代理（undici.ProxyAgent）发起请求，
 * 验证响应确实经由代理转发，避免"测试通过但代理未介入"的虚假可用性。
 */

import type { ProxyInfo } from "./types/index.js";
import { PROXY_TEST_CONFIG, DATABASE_CONFIG } from "./config.js";
import { isDatabaseReady } from "./database/connection.js";
import {
  insertDeprecatedProxy,
} from "./database/deprecated-proxies-dao.js";
import { request as undiciRequest, ProxyAgent } from "undici";
import { logger } from "./logger.js";
import { getRandomUserAgent } from "./utils/user-agent.js";

// 代理黑名单最大容量
const MAX_BLACKLIST_SIZE = 1000;

// 代理黑名单（失败的代理，内存模式）
const failedProxyBlacklist = new Map<string, number>();

/**
 * 代理协议 -> undici ProxyAgent 支持的 URI 前缀
 * undici ProxyAgent 仅支持 http:// 协议（HTTP CONNECT 隧道）
 * HTTPS 代理和 SOCKS5 代理需要专门的 dispatcher，暂未集成
 */
function buildProxyUri(proxy: ProxyInfo): string {
  const protocol = (proxy.protocol ?? "http").toLowerCase();
  // undici ProxyAgent 走 HTTP CONNECT 隧道，协议始终为 http://
  // 协议字段用于上层语义区分，不直接拼到 ProxyAgent URI
  if (protocol !== "http" && protocol !== "https") {
    logger.debug(
      `代理协议 ${protocol} 暂未支持，按 http 处理: ${proxy.ip}:${proxy.port}`,
      { module: "ProxyTester" },
    );
  }
  return `http://${proxy.ip}:${proxy.port}`;
}

/**
 * 代理可达性测试结果
 */
export interface ProxyTestResult {
  success: boolean;
  proxy: ProxyInfo;
  latency?: number;
  anonymity?: "anonymous" | "transparent" | "unknown";
  exitIp?: string;
  error?: string;
}

/**
 * 通过代理向测试端点发起请求
 * 使用 undici ProxyAgent 作为 dispatcher，确保流量经由代理转发
 *
 * @param proxy 代理信息
 * @param timeoutMs 超时时间（毫秒）
 * @param method HTTP 方法（默认 GET，用于获取 httpbin.org/ip 的 JSON 响应）
 */
async function fetchViaProxy(
  proxy: ProxyInfo,
  timeoutMs: number,
  method: "GET" | "HEAD" = "GET",
): Promise<{
  ok: boolean;
  statusCode: number;
  bodyText: string;
  latency: number;
}> {
  const proxyUri = buildProxyUri(proxy);
  const dispatcher = new ProxyAgent(proxyUri);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await undiciRequest(PROXY_TEST_CONFIG.testUrl, {
      method,
      dispatcher,
      signal: controller.signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      maxRedirections: 0,
      headers: {
        // 每次请求随机轮换 UA，避免被目标站识别为自动化流量
        "User-Agent": getRandomUserAgent(),
        Accept: "application/json",
      },
    });

    let bodyText = "";
    if (response.body) {
      bodyText = await response.body.text();
    }

    return {
      ok: response.statusCode >= 200 && response.statusCode < 400,
      statusCode: response.statusCode,
      bodyText,
      latency: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeoutId);
    // 释放底层 socket 池，避免连接泄漏
    try {
      await dispatcher.close();
    } catch {
      // 关闭失败可忽略，dispatcher 会在 GC 时被回收
    }
  }
}

/**
 * 解析 httpbin.org/ip 响应，判断代理匿名性
 * 响应格式：{"origin": "1.2.3.4"} 或 {"origin": "1.2.3.4, 5.6.7.8"}
 */
function parseIpResponse(
  bodyText: string,
  proxy: ProxyInfo,
): {
  anonymity: "anonymous" | "transparent" | "unknown";
  exitIp?: string;
} {
  if (!bodyText) {
    return { anonymity: "unknown" };
  }

  let parsed: { origin?: string };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { anonymity: "unknown" };
  }

  if (typeof parsed.origin !== "string" || !parsed.origin.trim()) {
    return { anonymity: "unknown" };
  }

  const origins = parsed.origin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return { anonymity: "unknown" };
  }

  const proxyIp = proxy.ip;
  const firstIp = origins[0];

  // 第一个 IP 是请求方 IP（代理出口 IP）
  if (firstIp === proxyIp) {
    return { anonymity: "anonymous", exitIp: firstIp };
  }

  // 多个 IP 表示透明代理（X-Forwarded-For 链）
  if (origins.length > 1) {
    return { anonymity: "transparent", exitIp: firstIp };
  }

  // 单个 IP 但不等于代理 IP，可能是代理做了 IP 伪装或测试端点异常
  return { anonymity: "unknown", exitIp: firstIp };
}

/**
 * 测试单个代理
 * 通过代理向 httpbin.org/ip 发起 GET 请求，验证响应状态与匿名性
 */
export async function testProxy(proxy: ProxyInfo): Promise<ProxyTestResult> {
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

  try {
    const result = await fetchViaProxy(
      proxy,
      PROXY_TEST_CONFIG.testTimeout,
      "GET",
    );

    if (!result.ok) {
      markProxyAsFailed(proxy);
      return {
        success: false,
        proxy,
        latency: result.latency,
        error: `HTTP ${result.statusCode}`,
      };
    }

    const { anonymity, exitIp } = parseIpResponse(result.bodyText, proxy);

    logger.info(
      `代理可用: ${proxy.ip}:${proxy.port} (延迟 ${result.latency}ms, 匿名性: ${anonymity}, 出口: ${exitIp ?? "N/A"})`,
      { module: "ProxyTester" },
    );

    return {
      success: true,
      proxy,
      latency: result.latency,
      anonymity,
      exitIp,
    };
  } catch (error) {
    markProxyAsFailed(proxy);
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.debug(
      `代理测试失败: ${proxy.ip}:${proxy.port} (${message})`,
      { module: "ProxyTester" },
    );
    return {
      success: false,
      proxy,
      error: message,
    };
  }
}

/**
 * 并行测试多个代理，快速筛选可用代理
 * 限制并发数避免系统资源耗尽；找到足够可用代理时提前结束
 */
export async function testProxiesInBatch(
  proxies: ProxyInfo[],
  maxWorkers: number = 5,
  minSuccessCount: number = 3,
): Promise<ProxyInfo[]> {
  if (proxies.length === 0) {
    return [];
  }

  logger.info(`开始批量测试 ${proxies.length} 个代理（并发 ${maxWorkers}）`, {
    module: "ProxyTester",
  });

  const successes: Array<{ proxy: ProxyInfo; latency: number }> = [];

  for (let i = 0; i < proxies.length; i += maxWorkers) {
    const batch = proxies.slice(i, i + maxWorkers);
    const batchResults = await Promise.all(
      batch.map((proxy) => testProxy(proxy)),
    );

    for (const result of batchResults) {
      if (result.success && typeof result.latency === "number") {
        successes.push({ proxy: result.proxy, latency: result.latency });
      }
    }

    if (successes.length >= minSuccessCount) {
      logger.info(
        `已找到 ${successes.length} 个可用代理，提前结束测试`,
        { module: "ProxyTester" },
      );
      break;
    }
  }

  // 按延迟升序排序
  successes.sort((a, b) => a.latency - b.latency);

  logger.info(
    `批量测试完成，可用代理 ${successes.length}/${proxies.length}`,
    { module: "ProxyTester" },
  );

  return successes.map((s) => s.proxy);
}

/**
 * 快速检测代理是否可用（非严格测试）
 * 仍通过代理发起请求，但仅检查 HTTP 状态，不解析 body
 */
export async function quickTestProxy(proxy: ProxyInfo): Promise<boolean> {
  try {
    const result = await fetchViaProxy(
      proxy,
      PROXY_TEST_CONFIG.quickTestTimeout,
      "GET",
    );
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * 批量快速测试代理
 * 全部并行测试，通过测试的代理按原始顺序返回
 */
export async function quickTestProxies(
  proxies: ProxyInfo[],
  timeoutPerProxy: number = PROXY_TEST_CONFIG.quickTestTimeout,
): Promise<ProxyInfo[]> {
  if (proxies.length === 0) {
    return [];
  }

  logger.info(`快速测试 ${proxies.length} 个代理`, { module: "ProxyTester" });

  const results = await Promise.all(
    proxies.map(async (proxy) => {
      try {
        const result = await fetchViaProxy(proxy, timeoutPerProxy, "GET");
        return result.ok ? proxy : null;
      } catch {
        return null;
      }
    }),
  );

  const availableProxies = results.filter(
    (p): p is ProxyInfo => p !== null,
  );

  logger.info(
    `快速测试完成，可用 ${availableProxies.length}/${proxies.length}`,
    { module: "ProxyTester" },
  );

  return availableProxies;
}

/**
 * 检测代理可达性（使用前检测）
 * 通过代理发起请求，返回可达性与错误信息
 */
export async function checkProxyReachability(
  proxy: ProxyInfo,
): Promise<{ reachable: boolean; error?: string; latency?: number }> {
  try {
    const result = await fetchViaProxy(
      proxy,
      PROXY_TEST_CONFIG.quickTestTimeout,
      "GET",
    );

    if (result.ok) {
      return { reachable: true, latency: result.latency };
    }

    return {
      reachable: false,
      error: `HTTP ${result.statusCode}`,
      latency: result.latency,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 删除最旧条目的辅助函数
 */
function evictOldestBlacklistEntry(): void {
  const firstKey = failedProxyBlacklist.keys().next().value;
  if (firstKey !== undefined) {
    failedProxyBlacklist.delete(firstKey);
  }
}

/**
 * 标记代理为失败
 */
function markProxyAsFailed(proxy: ProxyInfo): void {
  const key = `${proxy.ip}:${proxy.port}`;

  // 如果使用数据库模式，不需要内存黑名单
  if (!isDatabaseReady()) {
    // 检查大小限制，超过则删除最旧的条目
    if (failedProxyBlacklist.size >= MAX_BLACKLIST_SIZE) {
      evictOldestBlacklistEntry();
    }
    failedProxyBlacklist.set(
      key,
      Date.now() + PROXY_TEST_CONFIG.blacklistDuration,
    );
  }

  logger.debug(`代理失效: ${proxy.ip}:${proxy.port}，加入黑名单`, {
    module: "ProxyTester",
  });
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
    logger.info(
      `代理不可达，移入废弃表: ${proxy.ip}:${proxy.port} (${error || "Unknown error"})`,
      { module: "ProxyTester" },
    );

    await insertDeprecatedProxy({
      ip: proxy.ip,
      port: parseInt(proxy.port, 10),
      source: proxy.source,
      protocol: "http",
      failure_count: DATABASE_CONFIG.failureThreshold,
      created_at: new Date(proxy.timestamp),
    });
  } catch (err) {
    logger.error(
      "移入废弃表失败",
      err instanceof Error ? err : undefined,
      { module: "ProxyTester" },
    );
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
  logger.debug(
    `黑名单清理完成，剩余 ${failedProxyBlacklist.size} 个`,
    { module: "ProxyTester" },
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
