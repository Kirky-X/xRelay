export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * 代理信息接口
 */
export interface ProxyInfo {
  ip: string;
  port: string;
  source: string;
  timestamp: number;
  protocol?: 'http' | 'https' | 'socks5';
}

/**
 * 代理配置接口（用于数据库存储）
 */
export interface ProxyConfig {
  ip: string;
  port: number;
  source: string;
  protocol?: 'http' | 'https' | 'socks5';
  timestamp?: number;
}

export interface ProxyRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

/**
 * 代理响应接口
 *
 * 字段统一原则：
 * - `success`/`proxyUsed` 为必填，决定请求与代理的整体结果
 * - 其余字段可选，避免强制下游构造空对象
 * - `data` 与 `body` 同时保留：`data` 为 request-handler 路径的原始响应体，
 *   `body` 为 proxy-service 标准化后的等价表达，二者择一即可
 */
export interface ProxyResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  data?: string;
  proxyUsed: boolean;
  fallbackUsed?: boolean;
  proxyIp?: string | null;
  proxySuccess?: boolean;
  error?: string;
  cached?: boolean;
}

export interface RequestContext {
  requestId: string;
  clientIp: string;
  startTime: number;
  apiKey?: string;
}

/**
 * 请求结果类型（内部使用）
 * 用于 request-handler 内部的请求结果
 */
export interface RequestResult {
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}
