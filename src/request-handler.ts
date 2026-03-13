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
import { REQUEST_TIMEOUT_CONFIG, DATABASE_CONFIG } from "./config.js";
import { request as undiciRequest, ProxyAgent } from "undici";
import { logger } from "./logger.js";

// 响应体大小限制常量
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1秒
  maxDelay: 10000, // 10秒
};

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

// HTTP 方法类型
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

// Undici 响应 headers 类型（来自 http.IncomingHttpHeaders）
interface UndiciHeaders extends Record<string, string | string[] | undefined> {
  [key: string]: string | string[] | undefined;
}

// Undici body 类型
interface BodyReadable {
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  destroy(): void;
}

// Undici 响应类型
interface UndiciResponse {
  statusCode: number;
  headers: UndiciHeaders;
  body: BodyReadable | null;
  trailers: Record<string, string>;
}

/**
 * 延迟函数
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指数退避重试策略
 * @param fn 要执行的异步函数
 * @param maxRetries 最大重试次数
 * @param baseDelay 基础延迟时间（毫秒）
 * @returns 函数执行结果
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, i), RETRY_CONFIG.maxDelay);
        console.log(`[RequestHandler] 重试 ${i + 1}/${maxRetries}，等待 ${delay}ms 后重试...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
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
  'te',
  'trailer',
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
  // 可能导致问题的 headers
  'expect',
  'range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
  // 安全相关
  'front-end-https',
  'x-originating-url',
  'x-wap-profile',
  'x-att-deviceid',
]);

/**
 * 过滤危险 Headers（防止 Headers 注入和请求走私）
 */
export function filterDangerousHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    
    // 检查是否为危险 header
    if (DANGEROUS_HEADERS.has(lowerKey)) {
      logger.requestHandler.verbose(`过滤危险 header: ${key}`);
      continue;
    }
    
    // 验证 header 名称：不允许包含控制字符和特殊字符
    if (!key.match(/^[a-zA-Z0-9!#$%&'*+-.^_`|~]+$/)) {
      logger.requestHandler.verbose(`过滤无效 header 名称: ${key}`);
      continue;
    }
    
    // 验证 header 值：防止 CRLF 注入
    if (typeof value !== 'string') {
      logger.requestHandler.verbose(`过滤非字符串 header 值: ${key}`);
      continue;
    }
    
    // 检查是否包含换行符（CRLF 注入防护）
    if (value.includes('\r') || value.includes('\n')) {
      logger.requestHandler.verbose(`过滤包含换行符的 header 值: ${key}`);
      continue;
    }
    
    // 检查是否包含空字节
    if (value.includes('\0')) {
      logger.requestHandler.verbose(`过滤包含空字节的 header 值: ${key}`);
      continue;
    }
    
    filtered[key] = value;
  }
  
  return filtered;
}

/**
 * 读取响应体并限制大小（防止内存溢出）
 */
async function readBodyWithLimit(body: BodyReadable, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    body.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        body.destroy();
        reject(new Error(`Response body exceeds ${maxSize} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    body.on('error', reject);
  });
}

/**
 * 通过代理发送请求
 */
async function sendRequestWithProxy(
  request: ProxyRequest,
  proxy: ProxyInfo,
  externalSignal?: AbortSignal,
): Promise<{
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}> {
  logger.requestHandler.verbose(`使用代理: ${proxy.ip}:***`);

  // 使用 undici 的 request 方法直接发送请求
  const proxyUrl = `http://${proxy.ip}:${proxy.port}`;
  const dispatcher = new ProxyAgent(proxyUrl);

  try {
    // 创建 AbortController 用于超时控制
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      REQUEST_TIMEOUT_CONFIG.proxy,
    );

    // 如果有外部 signal，需要合并两个 signal
    // 创建一个组合的 AbortController
    const combinedController = new AbortController();

    // 监听超时 signal
    timeoutController.signal.addEventListener('abort', () => {
      combinedController.abort();
    });

    // 监听外部 signal（如果存在）
    if (externalSignal) {
      if (externalSignal.aborted) {
        // 如果外部 signal 已经被取消，直接中止
        combinedController.abort();
      } else {
        externalSignal.addEventListener('abort', () => {
          combinedController.abort();
        });
      }
    }

    // 过滤危险 headers
    const filteredHeaders = request.headers ? filterDangerousHeaders(request.headers) : {};

    // 构建 undici 请求选项
    const undiciOptions = {
      method: request.method.toUpperCase() as HttpMethod,
      headers: filteredHeaders as Record<string, string>,
      dispatcher,
      signal: combinedController.signal,
      body: request.body,
    };

    const response = await undiciRequest(request.url, undiciOptions) as unknown as UndiciResponse;
    clearTimeout(timeoutId);

    // 使用流式读取响应体，并限制大小
    let text = '';
    if (response.body) {
      text = await readBodyWithLimit(response.body, MAX_RESPONSE_SIZE);
    }

    const headers: Record<string, string> = {};
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) {
          // 处理数组值（如 Set-Cookie）
          headers[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      }
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
    logger.requestHandler.error(`代理请求失败: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    // 确保 ProxyAgent 被关闭，防止资源泄漏
    try {
      dispatcher.close();
    } catch {
      // 忽略关闭错误
    }
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
  logger.requestHandler.verbose(`使用直连模式`);

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

    // 检查 Content-Length 头（如果存在）
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response body too large: ${contentLength} bytes (max: ${MAX_RESPONSE_SIZE} bytes)`,
      };
    }

    // 使用流式读取响应体，并限制大小
    const reader = response.body?.getReader();
    let text = '';
    
    if (reader) {
      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          totalSize += value.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            reader.cancel();
            return {
              success: false,
              error: `Response body exceeds ${MAX_RESPONSE_SIZE} bytes`,
            };
          }
          
          chunks.push(value);
        }
        
        // 合并所有 chunks 并转换为字符串
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedArray = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combinedArray.set(chunk, offset);
          offset += chunk.length;
        }
        
        text = new TextDecoder('utf-8').decode(combinedArray);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          error: errorMessage,
        };
      }
    } else {
      // 如果没有流式 body，使用 text() 方法并检查大小
      text = await response.text();
      if (text.length > MAX_RESPONSE_SIZE) {
        return {
          success: false,
          error: `Response body exceeds ${MAX_RESPONSE_SIZE} bytes`,
        };
      }
    }

    return {
      success: response.ok,
      data: text,
      status: response.status,
      headers,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.requestHandler.error(`直连请求失败: ${errorMessage}`);
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
  logger.requestHandler.info(
    `开始处理请求: ${request.method} ${urlObj.hostname}`,
  );
  logger.requestHandler.verbose(
    `最大代理尝试次数: ${maxProxyAttempts}, Fallback: ${useFallback}`,
  );

  // 1. 尝试使用代理
  for (let attempt = 0; attempt < maxProxyAttempts; attempt++) {
    const proxy = await getAvailableProxy();

    if (!proxy) {
      logger.requestHandler.warn(`没有可用代理`);
      break;
    }

    logger.requestHandler.verbose(`代理尝试 ${attempt + 1}/${maxProxyAttempts}`);

    const result = await sendRequestWithProxy(request, proxy);

    if (result.success) {
      logger.requestHandler.info(`代理请求成功`);
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
      logger.requestHandler.warn(`代理请求失败`);
      reportProxyFailed(proxy);
    }
  }

  // 2. 所有代理失败，尝试 Fallback
  if (useFallback) {
    logger.requestHandler.info(`所有代理失败，尝试直连`);

    const result = await sendRequestDirect(request);

    if (result.success) {
      logger.requestHandler.info(`直连成功`);

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
      logger.requestHandler.error(`直连失败`);

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
 * 获取代理列表
 * @param count 请求的代理数量
 * @returns 代理列表
 */
async function getProxiesForRequest(count: number): Promise<ProxyInfo[]> {
  logger.requestHandler.verbose(`并行尝试最多 ${count} 个代理`);
  const proxies = await getMultipleProxies(count);
  logger.requestHandler.verbose(`获取到 ${proxies.length} 个代理`);
  return proxies;
}

/**
 * 处理无代理情况
 * @param request 请求对象
 * @param useFallback 是否使用直连回退
 * @returns 响应对象
 */
async function handleNoProxies(
  request: ProxyRequest,
  useFallback: boolean,
): Promise<ProxyResponse> {
  logger.requestHandler.warn(`没有可用代理`);

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

/**
 * 构建代理成功响应
 * @param result 请求结果
 * @param proxy 代理信息
 * @returns 响应对象
 */
function buildSuccessResponse(
  result: { data?: string; status?: number; headers?: Record<string, string> },
  proxy: ProxyInfo,
): ProxyResponse {
  logger.requestHandler.info(`代理请求成功: ${proxy.ip}:***`);
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
}

/**
 * 处理所有代理失败后的回退
 * @param request 请求对象
 * @param useFallback 是否使用直连回退
 * @returns 响应对象
 */
async function handleAllProxiesFailed(
  request: ProxyRequest,
  useFallback: boolean,
): Promise<ProxyResponse> {
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

  logger.requestHandler.info(`所有代理失败，回退到直连`);
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

/**
 * 单个代理尝试结果
 */
interface ProxyAttemptResult {
  success: boolean;
  response: ProxyResponse | null;
}

/**
 * 尝试单个代理请求
 * @param request 请求对象
 * @param proxy 代理信息
 * @param abortSignal 取消信号
 * @param abortOthers 取消其他请求的回调
 * @returns 尝试结果
 */
async function attemptProxyRequest(
  request: ProxyRequest,
  proxy: ProxyInfo,
  abortSignal: AbortSignal,
  abortOthers: () => void,
): Promise<ProxyAttemptResult> {
  logger.requestHandler.verbose(`开始尝试代理: ${proxy.ip}:***`);

  try {
    const result = await sendRequestWithProxy(request, proxy, abortSignal);

    if (result.success) {
      abortOthers();
      return {
        success: true,
        response: buildSuccessResponse(result, proxy),
      };
    } else {
      logger.requestHandler.verbose(`代理请求失败: ${proxy.ip}:*** - ${result.error}`);
      reportProxyFailed(proxy);
      return { success: false, response: null };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.requestHandler.verbose(`代理请求被取消: ${proxy.ip}:***`);
      return { success: false, response: null };
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.requestHandler.error(`代理请求异常: ${proxy.ip}:*** - ${errorMessage}`);
    reportProxyFailed(proxy);
    return { success: false, response: null };
  }
}

/**
 * 并行尝试多个代理
 * @param request 请求对象
 * @param proxies 代理列表
 * @returns 第一个成功的响应，或 null 表示全部失败
 */
async function raceProxies(
  request: ProxyRequest,
  proxies: ProxyInfo[],
): Promise<ProxyResponse | null> {
  logger.requestHandler.verbose(`开始并行尝试 ${proxies.length} 个代理`);

  const abortControllers = proxies.map(() => new AbortController());

  const proxyPromises = proxies.map((proxy, index) => {
    const abortOthers = () => {
      abortControllers.forEach((ctrl, i) => {
        if (i !== index) {
          ctrl.abort();
          logger.requestHandler.verbose(`已取消代理 ${i} 的请求`);
        }
      });
    };

    return attemptProxyRequest(request, proxy, abortControllers[index].signal, abortOthers);
  });

  try {
    const result = await Promise.any(
      proxyPromises.map(p => p.then(r => {
        if (r.success && r.response) return r.response;
        throw new Error('Proxy failed');
      }))
    );

    logger.requestHandler.info(`竞速成功`);
    return result;
  } catch {
    logger.requestHandler.warn(`所有 ${proxies.length} 个代理都失败`);
    return null;
  }
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
  const actualProxyCount = proxyCount || DATABASE_CONFIG.proxiesPerRequest;
  const proxies = await getProxiesForRequest(actualProxyCount);

  if (proxies.length === 0) {
    return handleNoProxies(request, useFallback);
  }

  const successResponse = await raceProxies(request, proxies);

  if (successResponse) {
    return successResponse;
  }

  return handleAllProxiesFailed(request, useFallback);
}
