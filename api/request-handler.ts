/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Request Handler - 请求转发与 Fallback 机制
 * 核心功能：代理请求 → 失败切换 → Fallback 直连
 */

import type { ProxyInfo } from "./proxy-fetcher.js";
import {
  getAvailableProxy,
  getMultipleProxies,
  reportProxyFailed,
  reportProxySuccess,
} from "./proxy-manager.js";
import { REQUEST_TIMEOUT_CONFIG } from "./config.js";

// 请求类型定义
export interface ProxyRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  // 代理相关信息
  proxyUsed: boolean;
  proxyIp: string | null;
  proxySuccess: boolean;
  fallbackUsed: boolean;
  error?: string;
}

/**
 * 危险 Headers 列表（大小写不敏感）
 * 这些 headers 可能被用于请求走私、注入攻击或绕过安全控制
 */
const DANGEROUS_HEADERS = new Set([
  // 请求走私相关
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  // 代理相关
  'proxy-authorization',
  'proxy-connection',
  'proxy-authenticate',
  // CDN/转发相关
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-client-ip',
  'via',
  // 认证相关（用户应自行管理）
  'authorization',
  'cookie',
  'set-cookie',
]);

/**
 * 过滤危险 Headers（防止 Headers 注入和请求走私）
 */
export function filterDangerousHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (!DANGEROUS_HEADERS.has(lowerKey)) {
      filtered[key] = value;
    } else {
      console.log(`[RequestHandler] 过滤危险 header: ${key}`);
    }
  }
  
  return filtered;
}

/**
 * 通过代理发送请求
 */
async function sendRequestWithProxy(
  request: ProxyRequest,
  proxy: ProxyInfo,
): Promise<{
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}> {
  console.log(`[RequestHandler] 使用代理: ${proxy.ip}:***`);

  try {
    // 使用 undici 的 request 方法直接发送请求
    const { request: undiciRequest, ProxyAgent } = await import('undici');
    
    const proxyUrl = `http://${proxy.ip}:${proxy.port}`;
    const dispatcher = new ProxyAgent(proxyUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_CONFIG.proxy,
    );

    // 过滤危险 headers
    const filteredHeaders = request.headers ? filterDangerousHeaders(request.headers) : {};

    // 构建 undici 请求选项
    const undiciOptions = {
      method: request.method as any,
      headers: filteredHeaders as any,
      dispatcher,
      signal: controller.signal as any,
      body: request.body,
    };

    const response = await undiciRequest(request.url, undiciOptions);
    clearTimeout(timeoutId);

    // 使用 ReadableStream 读取响应体
    let text = '';
    if (response.body) {
      const chunks: Buffer[] = [];
      for await (const chunk of response.body as any) {
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks).toString('utf-8');
    }

    const headers: Record<string, string> = {};
    const responseHeaders = response.headers as any;
    if (responseHeaders && typeof responseHeaders.forEach === 'function') {
      responseHeaders.forEach((value: string, key: string) => {
        headers[key] = value;
      });
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {
        success: true,
        data: text,
        status: response.statusCode,
        headers,
      };
    } else {
      return {
        success: false,
        error: `HTTP ${response.statusCode}`,
        data: text,
      };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.log(`[RequestHandler] 代理请求失败: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 直接发送请求（不使用代理）
 */
async function sendRequestDirect(request: ProxyRequest): Promise<{
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}> {
  console.log(`[RequestHandler] 使用直连模式`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_CONFIG.direct,
    );

    // 过滤危险 headers
    const filteredHeaders = request.headers ? filterDangerousHeaders(request.headers) : {};

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: filteredHeaders,
      signal: controller.signal,
    };

    if (request.body && ["POST", "PUT", "PATCH"].includes(request.method)) {
      fetchOptions.body = request.body;
    }

    const response = await fetch(request.url, fetchOptions);
    clearTimeout(timeoutId);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const text = await response.text();

    return {
      success: response.ok,
      data: text,
      status: response.status,
      headers,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.log(`[RequestHandler] 直连请求失败: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 主函数：通过代理发送请求，失败则切换代理或 Fallback
 */
export async function sendProxyRequest(
  request: ProxyRequest,
  options: {
    maxProxyAttempts?: number;
    useFallback?: boolean;
  } = {},
): Promise<ProxyResponse> {
  const maxProxyAttempts = options.maxProxyAttempts || 3;
  const useFallback = options.useFallback !== false;

  const urlObj = new URL(request.url);
  console.log(
    `[RequestHandler] 开始处理请求: ${request.method} ${urlObj.hostname}`,
  );
  console.log(
    `[RequestHandler] 最大代理尝试次数: ${maxProxyAttempts}, Fallback: ${useFallback}`,
  );

  // 1. 尝试使用代理
  for (let attempt = 0; attempt < maxProxyAttempts; attempt++) {
    const proxy = await getAvailableProxy();

    if (!proxy) {
      console.log(`[RequestHandler] 没有可用代理`);
      break;
    }

    console.log(`[RequestHandler] 代理尝试 ${attempt + 1}/${maxProxyAttempts}`);

    const result = await sendRequestWithProxy(request, proxy);

    if (result.success) {
      console.log(`[RequestHandler] 代理请求成功`);
      reportProxySuccess(proxy);

      return {
        success: true,
        data: result.data,
        status: result.status,
        headers: result.headers,
        proxyUsed: true,
        proxyIp: `${proxy.ip}:${proxy.port}`,
        proxySuccess: true,
        fallbackUsed: false,
      };
    } else {
      console.log(`[RequestHandler] 代理请求失败`);
      reportProxyFailed(proxy);
    }
  }

  // 2. 所有代理失败，尝试 Fallback
  if (useFallback) {
    console.log(`[RequestHandler] 所有代理失败，尝试直连`);

    const result = await sendRequestDirect(request);

    if (result.success) {
      console.log(`[RequestHandler] 直连成功`);

      return {
        success: true,
        data: result.data,
        status: result.status,
        headers: result.headers,
        proxyUsed: false,
        proxyIp: null,
        proxySuccess: false,
        fallbackUsed: true,
      };
    } else {
      console.log(`[RequestHandler] 直连失败`);

      return {
        success: false,
        error: `代理失败，直连也失败`,
        proxyUsed: false,
        proxyIp: null,
        proxySuccess: false,
        fallbackUsed: true,
      };
    }
  }

  // 3. 不使用 Fallback，直接返回失败
  return {
    success: false,
    error: "所有代理尝试失败",
    proxyUsed: false,
    proxyIp: null,
    proxySuccess: false,
    fallbackUsed: false,
  };
}

/**
 * 通过多个代理并行尝试发送请求（竞速模式）
 * 同时尝试多个代理，返回第一个成功的响应
 */
export async function sendRequestWithMultipleProxies(
  request: ProxyRequest,
  proxyCount?: number,
  useFallback: boolean = true,
): Promise<ProxyResponse> {
  // 使用配置的代理数量
  const { DATABASE_CONFIG } = await import("./config.js");
  const actualProxyCount = proxyCount || DATABASE_CONFIG.proxiesPerRequest;

  console.log(`[RequestHandler] 并行尝试最多 ${actualProxyCount} 个代理`);

  // 获取代理（最多 actualProxyCount 个，不足则获取所有可用代理）
  const proxies = await getMultipleProxies(actualProxyCount);

  if (proxies.length === 0) {
    console.log(`[RequestHandler] 没有可用代理`);
    if (!useFallback) {
      return {
        success: false,
        error: "没有可用代理且已禁用直连回退",
        proxyUsed: false,
        proxyIp: null,
        proxySuccess: false,
        fallbackUsed: false,
      };
    }
    const result = await sendRequestDirect(request);
    return {
      success: result.success,
      data: result.data,
      status: result.status,
      headers: result.headers,
      proxyUsed: false,
      proxyIp: null,
      proxySuccess: false,
      fallbackUsed: true,
      error: result.success ? undefined : result.error,
    };
  }

  console.log(`[RequestHandler] 获取到 ${proxies.length} 个代理，开始并行尝试`);

  // 并行尝试所有代理
  const proxyPromises = proxies.map(async (proxy) => {
    console.log(`[RequestHandler] 开始尝试代理: ${proxy.ip}:${proxy.port}`);

    try {
      const result = await sendRequestWithProxy(request, proxy);

      if (result.success) {
        console.log(`[RequestHandler] 代理请求成功: ${proxy.ip}:${proxy.port}`);
        reportProxySuccess(proxy);
        return {
          success: true,
          data: result.data,
          status: result.status,
          headers: result.headers,
          proxyUsed: true,
          proxyIp: `${proxy.ip}:${proxy.port}`,
          proxySuccess: true,
          fallbackUsed: false,
        };
      } else {
        console.log(`[RequestHandler] 代理请求失败: ${proxy.ip}:${proxy.port} - ${result.error}`);
        reportProxyFailed(proxy);
        return null; // 失败返回 null
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.log(`[RequestHandler] 代理请求异常: ${proxy.ip}:${proxy.port} - ${errorMessage}`);
      reportProxyFailed(proxy);
      return null;
    }
  });

  // 使用 Promise.any 获取第一个成功的结果
  try {
    const result = await Promise.any(
      proxyPromises.map(p => p.then(r => {
        if (r && r.success) return r;
        throw new Error('Proxy failed');
      }))
    );
    
    // 找到成功的代理
    if (result && result.success) {
      return result;
    }
  } catch (aggregateError) {
    // 所有代理都失败
    console.log(`[RequestHandler] 所有 ${proxies.length} 个代理都失败`);
  }

  // 所有代理都失败，回退到直连
  if (!useFallback) {
    return {
      success: false,
      error: "所有代理失败且已禁用直连回退",
      proxyUsed: false,
      proxyIp: null,
      proxySuccess: false,
      fallbackUsed: false,
    };
  }

  console.log(`[RequestHandler] 所有代理失败，回退到直连`);
  const directResult = await sendRequestDirect(request);

  return {
    success: directResult.success,
    data: directResult.data,
    status: directResult.status,
    headers: directResult.headers,
    proxyUsed: false,
    proxyIp: null,
    proxySuccess: false,
    fallbackUsed: true,
    error: directResult.success ? undefined : directResult.error,
  };
}
