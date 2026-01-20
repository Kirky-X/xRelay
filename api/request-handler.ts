/**
 * Request Handler - 请求转发与 Fallback 机制
 * 核心功能：代理请求 → 失败切换 → Fallback 直连
 */

import type { ProxyInfo } from './proxy-fetcher';
import {
  getAvailableProxy,
  getMultipleProxies,
  reportProxyFailed,
  reportProxySuccess
} from './proxy-manager';

// 请求超时时间
const PROXY_REQUEST_TIMEOUT = 8000; // 8秒
const DIRECT_REQUEST_TIMEOUT = 10000; // 10秒

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
  usedProxy?: string;
  error?: string;
  fallbackUsed?: boolean;
}

/**
 * 通过代理发送请求
 */
async function sendRequestWithProxy(
  request: ProxyRequest,
  proxy: ProxyInfo
): Promise<{
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}> {
  const proxyUrl = `http://${proxy.ip}:${proxy.port}`;

  console.log(`[RequestHandler] 使用代理: ${proxyUrl}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROXY_REQUEST_TIMEOUT);

    // 构建请求
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: {
        ...request.headers,
        'Proxy-Authorization': `Basic ${btoa(`${proxy.ip}:${proxy.port}`)}`,
        'X-Forwarded-For': proxy.ip
      },
      signal: controller.signal
    };

    if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      fetchOptions.body = request.body;
    }

    const response = await fetch(request.url, fetchOptions);
    clearTimeout(timeoutId);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const text = await response.text();

    if (response.ok) {
      return {
        success: true,
        data: text,
        status: response.status,
        headers
      };
    } else {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        data: text
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[RequestHandler] 代理请求失败: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * 直接发送请求（不使用代理）
 */
async function sendRequestDirect(
  request: ProxyRequest
): Promise<{
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}> {
  console.log(`[RequestHandler] 使用直连模式`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DIRECT_REQUEST_TIMEOUT);

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: request.headers || {},
      signal: controller.signal
    };

    if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
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
      headers
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[RequestHandler] 直连请求失败: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage
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
  } = {}
): Promise<ProxyResponse> {
  const maxProxyAttempts = options.maxProxyAttempts || 3;
  const useFallback = options.useFallback !== false;

  console.log(`[RequestHandler] 开始处理请求: ${request.url}`);
  console.log(`[RequestHandler] 最大代理尝试次数: ${maxProxyAttempts}, Fallback: ${useFallback}`);

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
        usedProxy: `${proxy.ip}:${proxy.port}`
      };
    } else {
      console.log(`[RequestHandler] 代理请求失败: ${result.error}`);
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
        fallbackUsed: true
      };
    } else {
      console.log(`[RequestHandler] 直连失败: ${result.error}`);

      return {
        success: false,
        error: `代理失败，直连也失败: ${result.error}`
      };
    }
  }

  // 3. 不使用 Fallback，直接返回失败
  return {
    success: false,
    error: '所有代理尝试失败'
  };
}

/**
 * 并行尝试多个代理（用于快速获取结果）
 */
export async function sendRequestWithMultipleProxies(
  request: ProxyRequest,
  proxyCount: number = 3
): Promise<ProxyResponse> {
  console.log(`[RequestHandler] 并行尝试 ${proxyCount} 个代理`);

  const proxies = await getMultipleProxies(proxyCount);

  if (proxies.length === 0) {
    // 没有代理，直接直连
    return sendRequestDirect(request).then(result => ({
      success: result.success,
      data: result.data,
      status: result.status,
      headers: result.headers,
      fallbackUsed: true
    }));
  }

  // 并行发送请求
  const results = await Promise.all(
    proxies.map(async (proxy) => {
      const result = await sendRequestWithProxy(request, proxy);
      return { proxy, result };
    })
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
        usedProxy: `${proxy.ip}:${proxy.port}`
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
    error: fallbackResult.success ? undefined : fallbackResult.error,
    fallbackUsed: true
  };
}
