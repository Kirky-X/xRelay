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

    // 构建 undici 请求选项
    const undiciOptions = {
      method: request.method as any,
      headers: request.headers as any,
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

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: request.headers || {},
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
 * 并行尝试多个代理（用于快速获取结果）
 */
export async function sendRequestWithMultipleProxies(
  request: ProxyRequest,
  proxyCount: number = 3,
): Promise<ProxyResponse> {
  console.log(`[RequestHandler] 并行尝试 ${proxyCount} 个代理`);

  const proxies = await getMultipleProxies(proxyCount);

  if (proxies.length === 0) {
    // 没有代理，直接直连
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

  // 并行发送请求
  const results = await Promise.all(
    proxies.map(async (proxy) => {
      const result = await sendRequestWithProxy(request, proxy);
      return { proxy, result };
    }),
  );

  // 找到第一个成功的
  for (const { proxy, result } of results) {
    if (result.success) {
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
      reportProxyFailed(proxy);
    }
  }

  // 全部失败，尝试 Fallback
  console.log(`[RequestHandler] 所有并行代理失败，尝试直连`);
  const fallbackResult = await sendRequestDirect(request);

  return {
    success: fallbackResult.success,
    data: fallbackResult.data,
    status: fallbackResult.status,
    headers: fallbackResult.headers,
    proxyUsed: false,
    proxyIp: null,
    proxySuccess: false,
    fallbackUsed: true,
    error: fallbackResult.success ? undefined : fallbackResult.error,
  };
}
