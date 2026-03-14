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

export interface ProxyResponse {
  success: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  proxyUsed: boolean;
  fallbackUsed?: boolean;
  proxyIp?: string | null;
  proxySuccess?: boolean;
  error?: string;
  data?: string;
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
