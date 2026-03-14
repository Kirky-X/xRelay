export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

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
  // 代理相关信息
  proxyIp?: string | null;
  proxySuccess?: boolean;
  error?: string;
  // 兼容 request-handler 的 data 字段
  data?: string;
}

export interface RequestContext {
  requestId: string;
  clientIp: string;
  startTime: number;
  apiKey?: string;
}
