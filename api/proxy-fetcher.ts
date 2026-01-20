/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Proxy Fetcher - 获取免费代理列表
 * 从多个免费代理源获取代理 IP
 */

import { PROXY_CONFIG } from "./config";

// 代理源配置
const PROXY_SOURCES = [
  {
    name: "ProxyScrape",
    url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&limit=20",
    parse: (text: string) => {
      // 格式: ip:port 每行一个
      return text
        .trim()
        .split("\n")
        .filter((line) => line.includes(":"))
        .map((line) => line.trim());
    },
  },
  {
    name: "FreeProxyList",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/main/http.txt",
    parse: (text: string) => {
      return text
        .trim()
        .split("\n")
        .filter((line) => line.includes(":"))
        .map((line) => line.trim());
    },
  },
  {
    name: "ProxyListDownload",
    url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    parse: (text: string) => {
      return text
        .trim()
        .split("\n")
        .filter((line) => line.includes(":"))
        .map((line) => line.trim());
    },
  },
];

// 代理信息类型
export interface ProxyInfo {
  ip: string;
  port: string;
  source: string;
  timestamp: number;
}

let cachedProxies: ProxyInfo[] = [];
let lastFetchTime = 0;

/**
 * 获取所有可用代理
 */
export async function fetchAllProxies(): Promise<ProxyInfo[]> {
  const now = Date.now();

  // 检查缓存
  if (
    cachedProxies.length > 0 &&
    now - lastFetchTime < PROXY_CONFIG.pool.refreshInterval
  ) {
    console.log(
      `[ProxyFetcher] 使用缓存的代理列表，共 ${cachedProxies.length} 个`,
    );
    return cachedProxies;
  }

  const allProxies: ProxyInfo[] = [];

  // 并行获取所有代理源
  const fetchPromises = PROXY_SOURCES.map(async (source) => {
    try {
      const proxies = await fetchFromSource(source);
      console.log(
        `[ProxyFetcher] 从 ${source.name} 获取了 ${proxies.length} 个代理`,
      );
      return proxies;
    } catch (error) {
      console.error(`[ProxyFetcher] 从 ${source.name} 获取失败:`, error);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);

  // 合并所有代理
  for (const proxies of results) {
    allProxies.push(...proxies);
  }

  // 去重
  const uniqueProxies = deduplicateProxies(allProxies);

  // 更新缓存
  cachedProxies = uniqueProxies;
  lastFetchTime = now;

  console.log(`[ProxyFetcher] 总共获取 ${uniqueProxies.length} 个唯一代理`);

  return uniqueProxies;
}

/**
 * 从单个源获取代理
 */
async function fetchFromSource(
  source: (typeof PROXY_SOURCES)[0],
): Promise<ProxyInfo[]> {
  const response = await fetch(source.url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const proxyStrings = source.parse(text);

  return proxyStrings
    .map((proxy) => {
      const parts = proxy.split(":");
      if (parts.length < 2) {
        console.warn(`[ProxyFetcher] 无效的代理格式: ${proxy}`);
        return null;
      }
      const [ip, port] = parts;
      return {
        ip,
        port,
        source: source.name,
        timestamp: Date.now(),
      };
    })
    .filter((p): p is ProxyInfo => p !== null);
}

/**
 * 去重代理
 */
function deduplicateProxies(proxies: ProxyInfo[]): ProxyInfo[] {
  const seen = new Map<string, ProxyInfo>();

  for (const proxy of proxies) {
    const key = `${proxy.ip}:${proxy.port}`;
    if (!seen.has(key)) {
      seen.set(key, proxy);
    }
  }

  return Array.from(seen.values());
}

/**
 * 随机打乱代理顺序（负载均衡）
 */
export function shuffleProxies(proxies: ProxyInfo[]): ProxyInfo[] {
  const shuffled = [...proxies];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * 获取随机 N 个代理
 */
export function getRandomProxies(count: number): ProxyInfo[] {
  const shuffled = shuffleProxies(cachedProxies);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export { PROXY_SOURCES };
