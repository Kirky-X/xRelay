/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Request Handler - 请求转发与 Fallback 机制
 * 核心功能：代理请求 → 失败切换 → Fallback 直连
 */

import type {
  ProxyInfo,
  ProxyRequest,
  ProxyResponse,
  RequestResult,
} from "./types/index.js";
import {
  getAvailableProxy,
  getMultipleProxies,
  reportProxyFailed,
  reportProxySuccess,
} from "./proxy-manager.js";
import {
  REQUEST_TIMEOUT_CONFIG,
  DATABASE_CONFIG,
  SECURITY_CONFIG,
} from "./config.js";
import { request as undiciRequest, ProxyAgent, Agent } from "undici";
import { isIP as netIsIP } from "node:net";
import { getRandomUserAgent } from "./utils/user-agent.js";
import { createPinnedAgent } from "./utils/pinned-agent.js";
import {
  readUndiciBodyWithLimit,
  readWebBodyWithLimit,
  type UndiciBodyLike,
} from "./utils/body-reader.js";
import { logger } from "./logger.js";
import { validateUrl } from "./security.js";

/**
 * 检查字符串是否为有效的 IP 地址（IPv4 或 IPv6）
 *
 * 用于在 pinned DNS 路径前校验 resolvedIp，
 * 防止无效值（如 undefined 字符串、域名等）传入自定义 lookup 导致连接失败。
 *
 * 优先使用 Node.js 内置 net.isIP 做严格格式校验（覆盖 IPv4-mapped IPv6 等所有合法形式）；
 * Edge Runtime 下 node:net 不可用时，回退到纯 JS 正则校验，
 * 避免静默 fail-open 导致 SSRF TOCTOU 防护失效（规则12：失败显性化）。
 */
// IPv4 点分十进制正则（保守，仅匹配 0-255 段）
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
// IPv6 简化正则：覆盖常见形式（含 ::、IPv4-mapped、点分末段）
const IPV6_REGEX = /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{0,4}|(?:[0-9a-fA-F]{1,4}:){1,5}:[0-9]{1,3}(?:\.[0-9]{1,3}){3}|(?:[0-9a-fA-F]{1,4}:){1,4}:[0-9]{1,3}(?:\.[0-9]{1,3}){3})$/;
function isValidIpAddress(ip: string): boolean {
  // 优先使用 node:net.isIP（更严格、覆盖更全）
  if (typeof netIsIP === "function") {
    return netIsIP(ip) !== 0;
  }
  // Edge Runtime fallback：纯 JS 正则校验，避免静默 fail-open
  return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip);
}

// 响应体大小限制（统一从配置读取，与 webpage-capture 共享同一上限）
// 向后兼容：若 SECURITY_CONFIG.maxResponseSize 未配置，回退到 maxRequestSize * 100
const MAX_RESPONSE_SIZE =
  SECURITY_CONFIG.maxResponseSize ?? SECURITY_CONFIG.maxRequestSize * 100;

// HTTP 方法类型
type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

/**
 * ProxyAgent 池
 *
 * 每个 ProxyAgent 内部维护到同一代理的 HTTP 长连接池。
 * 复用 ProxyAgent 可避免每次请求都重新建立 TCP/TLS 连接，
 * 显著降低延迟与目标代理的连接开销。
 *
 * 容量限制：LRU 淘汰（与 AdvancedCache 惯例一致，规则8），
 * 超过上限时关闭并删除最近最少使用的条目，避免内存无限增长。
 */
const proxyAgentPool = new Map<string, ProxyAgent>();
const PROXY_AGENT_POOL_MAX_SIZE = 100;

/**
 * 获取或创建 ProxyAgent
 * @param proxyUrl 代理 URL（如 http://1.2.3.4:8080）
 * @returns 复用的 ProxyAgent 实例
 */
function getProxyAgent(proxyUrl: string): ProxyAgent {
  const existing = proxyAgentPool.get(proxyUrl);
  if (existing) {
    // LRU：命中时移到末尾（最近使用），与 AdvancedCache 一致
    proxyAgentPool.delete(proxyUrl);
    proxyAgentPool.set(proxyUrl, existing);
    return existing;
  }

  const agent = new ProxyAgent(proxyUrl);
  proxyAgentPool.set(proxyUrl, agent);

  // LRU 淘汰：超过容量时关闭并删除最早加入的条目（最近最少使用）
  if (proxyAgentPool.size > PROXY_AGENT_POOL_MAX_SIZE) {
    const oldestKey = proxyAgentPool.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestAgent = proxyAgentPool.get(oldestKey);
      // close() 返回 Promise，显式 catch 避免未处理 rejection（规则12：失败显性化）
      oldestAgent?.close().catch((err: unknown) => {
        logger.debug(`关闭 ProxyAgent 时出错: ${err instanceof Error ? err.message : String(err)}`, { module: "RequestHandler" });
      });
      proxyAgentPool.delete(oldestKey);
    }
  }

  return agent;
}

/**
 * 关闭所有 ProxyAgent 并清空池（用于优雅关闭与测试）
 *
 * 返回 Promise 以便调用方 await 资源真正释放完成（避免 process.exit
 * 提前中断事件循环，导致 TCP 连接被 RST 而非正常 FIN）。
 */
export async function closeAllProxyAgents(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const agent of proxyAgentPool.values()) {
    // close() 返回 Promise，统一收集后 await
    closePromises.push(
      agent.close().catch((err: unknown) => {
        logger.debug(`关闭 ProxyAgent 时出错: ${err instanceof Error ? err.message : String(err)}`, { module: "RequestHandler" });
      }),
    );
  }
  proxyAgentPool.clear();
  await Promise.all(closePromises);
}

/**
 * pinned DNS Agent 池（按 resolvedIp 缓存）
 *
 * SSRF TOCTOU 防护：直连路径使用自定义 lookup 将域名固定到已验证的 IP，
 * 防止第二次 DNS 解析返回内网地址（DNS 重绑定攻击）。
 *
 * 每个 resolvedIp 对应一个 Agent 实例（复用 TCP/TLS 连接），
 * 超过容量时 LRU 淘汰（与 ProxyAgent 池、AdvancedCache 一致）。
 */
const pinnedAgentPool = new Map<string, Agent>();
const PINNED_AGENT_POOL_MAX_SIZE = 50;

/**
 * 获取或创建 pin DNS 的 Agent
 * @param resolvedIp 已验证的公网 IP
 * @returns 复用的 Agent 实例（自定义 lookup 固定到 resolvedIp）
 */
function getPinnedAgent(resolvedIp: string): Agent {
  const existing = pinnedAgentPool.get(resolvedIp);
  if (existing) {
    // LRU：命中时移到末尾（最近使用）
    pinnedAgentPool.delete(resolvedIp);
    pinnedAgentPool.set(resolvedIp, existing);
    return existing;
  }

  // 使用统一的 pinned DNS Agent 工厂创建（SSRF TOCTOU 防护）
  const agent = createPinnedAgent(resolvedIp);
  pinnedAgentPool.set(resolvedIp, agent);

  // LRU 淘汰：超过容量时关闭并删除最早加入的条目（最近最少使用）
  if (pinnedAgentPool.size > PINNED_AGENT_POOL_MAX_SIZE) {
    const oldestKey = pinnedAgentPool.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestAgent = pinnedAgentPool.get(oldestKey);
      // close() 返回 Promise，显式 catch 避免未处理 rejection
      oldestAgent?.close().catch((err: unknown) => {
        logger.debug(`关闭 pinned Agent 时出错: ${err instanceof Error ? err.message : String(err)}`, { module: "RequestHandler" });
      });
      pinnedAgentPool.delete(oldestKey);
    }
  }

  return agent;
}

/**
 * 关闭所有 pinned DNS Agent（用于优雅关闭与测试）
 *
 * 返回 Promise 以便调用方 await 资源真正释放完成（避免 process.exit
 * 提前中断事件循环）。
 */
export async function closeAllPinnedAgents(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const agent of pinnedAgentPool.values()) {
    closePromises.push(
      agent.close().catch((err: unknown) => {
        logger.debug(`关闭 pinned Agent 时出错: ${err instanceof Error ? err.message : String(err)}`, { module: "RequestHandler" });
      }),
    );
  }
  pinnedAgentPool.clear();
  await Promise.all(closePromises);
}

// Undici 响应 headers 类型（来自 http.IncomingHttpHeaders）
interface UndiciHeaders extends Record<string, string | string[] | undefined> {
  [key: string]: string | string[] | undefined;
}

// Undici 响应类型（body 类型用统一的 UndiciBodyLike，避免重复定义）
interface UndiciResponse {
  statusCode: number;
  headers: UndiciHeaders;
  body: UndiciBodyLike | null;
  trailers: Record<string, string>;
}

/**
 * 危险 Headers 列表（大小写不敏感）
 * 这些 headers 可能被用于请求走私、注入攻击或绕过安全控制
 */
const DANGEROUS_HEADERS = new Set([
  // 请求走私相关
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  // 代理相关
  "proxy-authorization",
  "proxy-connection",
  "proxy-authenticate",
  // CDN/转发相关
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "via",
  // 认证相关（用户应自行管理）
  "authorization",
  "cookie",
  "set-cookie",
  // 可能导致问题的 headers
  "expect",
  "range",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
  // 安全相关
  "front-end-https",
  "x-originating-url",
  "x-wap-profile",
  "x-att-deviceid",
]);

/**
 * 过滤危险 Headers（防止 Headers 注入和请求走私）
 */
export function filterDangerousHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // 检查是否为危险 header
    if (DANGEROUS_HEADERS.has(lowerKey)) {
      logger.debug(`过滤危险 header: ${key}`, { module: "RequestHandler" });
      continue;
    }

    // 验证 header 名称：不允许包含控制字符和特殊字符
    if (!key.match(/^[a-zA-Z0-9!#$%&'*+-.^_`|~]+$/)) {
      logger.debug(`过滤无效 header 名称: ${key}`, {
        module: "RequestHandler",
      });
      continue;
    }

    // 验证 header 值：防止 CRLF 注入
    if (typeof value !== "string") {
      logger.debug(`过滤非字符串 header 值: ${key}`, {
        module: "RequestHandler",
      });
      continue;
    }

    // 检查是否包含换行符（CRLF 注入防护）
    if (value.includes("\r") || value.includes("\n")) {
      logger.debug(`过滤包含换行符的 header 值: ${key}`, {
        module: "RequestHandler",
      });
      continue;
    }

    // 检查是否包含空字节
    if (value.includes("\0")) {
      logger.debug(`过滤包含空字节的 header 值: ${key}`, {
        module: "RequestHandler",
      });
      continue;
    }

    filtered[key] = value;
  }

  return filtered;
}

/**
 * 确保请求 headers 包含 User-Agent
 * 若未传入则随机轮换，避免目标站识别为自动化客户端（Bun/Node 等）
 * 大小写不敏感检查：HTTP header 名称大小写不敏感
 */
function ensureUserAgent(
  headers: Record<string, string>,
): Record<string, string> {
  const hasUserAgent = Object.keys(headers).some(
    (key) => key.toLowerCase() === "user-agent",
  );
  if (!hasUserAgent) {
    headers["User-Agent"] = getRandomUserAgent();
  }
  return headers;
}

/**
 * 通过代理发送请求
 */
async function sendRequestWithProxy(
  request: ProxyRequest,
  proxy: ProxyInfo,
  externalSignal?: AbortSignal,
): Promise<RequestResult> {
  logger.debug(`使用代理: ${proxy.ip}:***`, { module: "RequestHandler" });

  // 使用池化的 ProxyAgent：复用 TCP/TLS 长连接，避免每次请求重建连接
  const proxyUrl = `http://${proxy.ip}:${proxy.port}`;
  const dispatcher = getProxyAgent(proxyUrl);
  // ProxyRequest.method 可选：未指定时按 GET 处理
  const method = (request.method ?? "GET").toUpperCase() as HttpMethod;

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

    // 监听超时 signal（once: true 触发后自动移除监听器）
    timeoutController.signal.addEventListener("abort", () => {
      combinedController.abort();
    }, { once: true });

    // 监听外部 signal（如果存在）
    if (externalSignal) {
      if (externalSignal.aborted) {
        // 如果外部 signal 已经被取消，直接中止
        combinedController.abort();
      } else {
        externalSignal.addEventListener("abort", () => {
          combinedController.abort();
        }, { once: true });
      }
    }

    // 过滤危险 headers
    const filteredHeaders = request.headers
      ? filterDangerousHeaders(request.headers)
      : {};

    // 确保有 User-Agent（防跟踪：避免暴露 Bun/Node 默认 UA）
    ensureUserAgent(filteredHeaders);

    // 构建 undici 请求选项
    const undiciOptions = {
      method,
      headers: filteredHeaders as Record<string, string>,
      dispatcher,
      signal: combinedController.signal,
      body: request.body,
    };

    const response = (await undiciRequest(
      request.url,
      undiciOptions,
    )) as unknown as UndiciResponse;
    clearTimeout(timeoutId);

    // 使用流式读取响应体，并限制大小
    let text = "";
    if (response.body) {
      text = await readUndiciBodyWithLimit(response.body, MAX_RESPONSE_SIZE);
    }

    const headers: Record<string, string> = {};
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) {
          // 处理数组值（如 Set-Cookie）
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
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
    logger.error(
      `代理请求失败: ${errorMessage}`,
      error instanceof Error ? error : undefined,
      { module: "RequestHandler" },
    );

    return {
      success: false,
      error: errorMessage,
    };
  }
  // 不在此处关闭 dispatcher：ProxyAgent 由池统一管理生命周期
  // 池会通过 FIFO 淘汰或 closeAllProxyAgents() 关闭
}

/**
 * 直接发送请求（不使用代理）
 *
 * SSRF TOCTOU 防护：当 request.resolvedIp 提供时，使用 pinned DNS Agent
 * 将域名固定到已验证的 IP，防止第二次 DNS 解析返回内网地址。
 */
async function sendRequestDirect(request: ProxyRequest): Promise<RequestResult> {
  logger.debug(`使用直连模式`, { module: "RequestHandler" });
  // ProxyRequest.method 可选：未指定时按 GET 处理
  const method = (request.method ?? "GET").toUpperCase() as HttpMethod;

  // SSRF 防护：直连前静态验证 URL（阻止内网/私有地址请求）
  const urlValidation = validateUrl(request.url);
  if (!urlValidation.valid) {
    logger.warn(`URL validation failed: ${urlValidation.error}`, {
      module: "RequestHandler",
      url: request.url,
    });
    return {
      success: false,
      error: `URL validation failed: ${urlValidation.error}`,
    };
  }

  // SSRF TOCTOU 防护：有 resolvedIp 时走 pinned DNS 路径
  // 仅当 resolvedIp 是有效 IP 地址时才使用 pinned DNS，避免无效值导致连接失败
  if (request.resolvedIp && isValidIpAddress(request.resolvedIp)) {
    return sendRequestDirectPinned(request, method);
  }

  // resolvedIp 无效或未提供时，走标准 fetch 路径（向后兼容）
  if (request.resolvedIp && !isValidIpAddress(request.resolvedIp)) {
    logger.warn(`resolvedIp 值无效（${request.resolvedIp}），回退到标准 fetch 路径`, { module: "RequestHandler" });
  }

  // 无 resolvedIp 时保持原有 fetch 路径（向后兼容）
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_CONFIG.direct,
    );

    // 过滤危险 headers
    const filteredHeaders = request.headers
      ? filterDangerousHeaders(request.headers)
      : {};

    // 确保有 User-Agent（防跟踪：避免暴露 Bun/Node 默认 UA）
    ensureUserAgent(filteredHeaders);

    const fetchOptions: RequestInit = {
      method,
      headers: filteredHeaders,
      signal: controller.signal,
    };

    if (request.body && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOptions.body = request.body;
    }

    const response = await fetch(request.url, fetchOptions);
    clearTimeout(timeoutId);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // 检查 Content-Length 头（如果存在）
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response body too large: ${contentLength} bytes (max: ${MAX_RESPONSE_SIZE} bytes)`,
      };
    }

    // 使用统一的流式读取工具，限制响应体大小防止 OOM
    let text = "";
    try {
      text = await readWebBodyWithLimit(response.body, MAX_RESPONSE_SIZE);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: errorMessage,
      };
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
    logger.error(
      `直连请求失败: ${errorMessage}`,
      error instanceof Error ? error : undefined,
      { module: "RequestHandler" },
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 使用 pinned DNS 发送直连请求（SSRF TOCTOU 防护）
 *
 * 当上层已通过 validateDnsResolution 验证 IP 为公网地址时，
 * 使用此路径将 DNS 固定到已验证的 IP，防止 DNS 重绑定攻击。
 */
async function sendRequestDirectPinned(
  request: ProxyRequest,
  method: HttpMethod,
): Promise<RequestResult> {
  logger.debug(`使用 pinned DNS 直连模式: ${request.resolvedIp}`, {
    module: "RequestHandler",
  });

  try {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      REQUEST_TIMEOUT_CONFIG.direct,
    );

    // 过滤危险 headers
    const filteredHeaders = request.headers
      ? filterDangerousHeaders(request.headers)
      : {};

    ensureUserAgent(filteredHeaders);

    const dispatcher = getPinnedAgent(request.resolvedIp!);

    const undiciOptions = {
      method,
      headers: filteredHeaders as Record<string, string>,
      dispatcher,
      signal: timeoutController.signal,
      body: request.body,
    };

    const response = (await undiciRequest(
      request.url,
      undiciOptions,
    )) as unknown as UndiciResponse;
    clearTimeout(timeoutId);

    // 使用流式读取响应体，并限制大小
    let text = "";
    if (response.body) {
      text = await readUndiciBodyWithLimit(response.body, MAX_RESPONSE_SIZE);
    }

    const headers: Record<string, string> = {};
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) {
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
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
    }

    return {
      success: false,
      error: `HTTP ${response.statusCode}`,
      data: text,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(
      `pinned DNS 直连请求失败: ${errorMessage}`,
      error instanceof Error ? error : undefined,
      { module: "RequestHandler" },
    );
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
  logger.info(`开始处理请求: ${request.method ?? "GET"} ${urlObj.hostname}`, {
    module: "RequestHandler",
  });
  logger.debug(
    `最大代理尝试次数: ${maxProxyAttempts}, Fallback: ${useFallback}`,
    { module: "RequestHandler" },
  );

  // 1. 尝试使用代理
  for (let attempt = 0; attempt < maxProxyAttempts; attempt++) {
    const proxy = await getAvailableProxy();

    if (!proxy) {
      logger.warn(`没有可用代理`, { module: "RequestHandler" });
      break;
    }

    logger.debug(`代理尝试 ${attempt + 1}/${maxProxyAttempts}`, {
      module: "RequestHandler",
    });

    const result = await sendRequestWithProxy(request, proxy);

    if (result.success) {
      logger.info(`代理请求成功`, { module: "RequestHandler" });
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
      logger.warn(`代理请求失败`, { module: "RequestHandler" });
      reportProxyFailed(proxy);
    }
  }

  // 2. 所有代理失败，尝试 Fallback
  if (useFallback) {
    logger.info(`所有代理失败，尝试直连`, { module: "RequestHandler" });

    const result = await sendRequestDirect(request);

    if (result.success) {
      logger.info(`直连成功`, { module: "RequestHandler" });

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
      logger.error(`直连失败`, undefined, { module: "RequestHandler" });

      return {
        success: false,
        // 保留原始错误信息（如 OOM/超时/HTTP 状态等）便于诊断，
        // 同时附加上下文标识走过了 fallback 路径
        error: result.error
          ? `代理失败，直连也失败: ${result.error}`
          : `代理失败，直连也失败`,
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
  logger.debug(`并行尝试最多 ${count} 个代理`, { module: "RequestHandler" });
  const proxies = await getMultipleProxies(count);
  logger.debug(`获取到 ${proxies.length} 个代理`, { module: "RequestHandler" });
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
  logger.warn(`没有可用代理`, { module: "RequestHandler" });

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
  result: RequestResult,
  proxy: ProxyInfo,
): ProxyResponse {
  logger.info(`代理请求成功: ${proxy.ip}:***`, { module: "RequestHandler" });
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

  logger.info(`所有代理失败，回退到直连`, { module: "RequestHandler" });
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
  logger.debug(`开始尝试代理: ${proxy.ip}:***`, { module: "RequestHandler" });

  try {
    const result = await sendRequestWithProxy(request, proxy, abortSignal);

    if (result.success) {
      abortOthers();
      return {
        success: true,
        response: buildSuccessResponse(result, proxy),
      };
    } else {
      logger.debug(`代理请求失败: ${proxy.ip}:*** - ${result.error}`, {
        module: "RequestHandler",
      });
      reportProxyFailed(proxy);
      return { success: false, response: null };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.debug(`代理请求被取消: ${proxy.ip}:***`, {
        module: "RequestHandler",
      });
      return { success: false, response: null };
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(
      `代理请求异常: ${proxy.ip}:*** - ${errorMessage}`,
      error instanceof Error ? error : undefined,
      { module: "RequestHandler" },
    );
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
  logger.debug(`开始并行尝试 ${proxies.length} 个代理`, {
    module: "RequestHandler",
  });

  const abortControllers = proxies.map(() => new AbortController());

  const proxyPromises = proxies.map((proxy, index) => {
    const abortOthers = () => {
      abortControllers.forEach((ctrl, i) => {
        if (i !== index) {
          ctrl.abort();
          logger.debug(`已取消代理 ${i} 的请求`, { module: "RequestHandler" });
        }
      });
    };

    return attemptProxyRequest(
      request,
      proxy,
      abortControllers[index].signal,
      abortOthers,
    );
  });

  try {
    const result = await Promise.any(
      proxyPromises.map((p) =>
        p.then((r) => {
          if (r.success && r.response) return r.response;
          throw new Error("Proxy failed");
        }),
      ),
    );

    logger.info(`竞速成功`, { module: "RequestHandler" });
    return result;
  } catch {
    logger.warn(`所有 ${proxies.length} 个代理都失败`, {
      module: "RequestHandler",
    });
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
