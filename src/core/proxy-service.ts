/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 代理服务模块
 * 封装代理请求执行逻辑，集成缓存
 */

import {
  sendProxyRequest,
  sendRequestWithMultipleProxies,
  filterDangerousHeaders,
} from "../request-handler.js";
import { FEATURES, DATABASE_CONFIG, CACHE_CONFIG } from "../config.js";
import { AdvancedCache } from "../cache/advanced-cache.js";
import { simpleHash } from "../utils/crypto.js";
import { logger } from "../logger.js";
import type { ProxyRequest, ProxyResponse } from "../types/index.js";

/**
 * 代理服务配置
 */
export interface ProxyServiceConfig {
  useCache?: boolean;
  useFallback?: boolean;
  maxProxyAttempts?: number;
  proxyCount?: number;
}

/**
 * 缓存响应类型
 */
interface CachedProxyResponse extends ProxyResponse {
  cached?: boolean;
}

/**
 * 将 request-handler 的响应转换为标准 ProxyResponse
 */
function normalizeResponse(response: {
  success: boolean;
  data?: string;
  status?: number;
  headers?: Record<string, string>;
  proxyUsed: boolean;
  proxyIp?: string | null;
  proxySuccess?: boolean;
  fallbackUsed: boolean;
  error?: string;
}): ProxyResponse {
  return {
    success: response.success,
    status: response.status ?? 0,
    statusText: response.success ? "OK" : (response.error ?? "Error"),
    headers: response.headers ?? {},
    body: response.data ?? "",
    proxyUsed: response.proxyUsed,
    fallbackUsed: response.fallbackUsed,
    proxyIp: response.proxyIp,
    proxySuccess: response.proxySuccess,
    error: response.error,
  };
}

/**
 * 代理服务类
 * 提供统一的代理请求接口
 */
export class ProxyService {
  private defaultConfig: ProxyServiceConfig;
  private cache: AdvancedCache<CachedProxyResponse>;

  constructor(config?: ProxyServiceConfig) {
    this.defaultConfig = {
      useCache: FEATURES.enableCache,
      useFallback: FEATURES.enableFallback,
      maxProxyAttempts: 3,
      proxyCount: DATABASE_CONFIG.proxiesPerRequest,
      ...config,
    };
    
    // 初始化缓存
    this.cache = new AdvancedCache<CachedProxyResponse>(
      CACHE_CONFIG.maxSize,
      CACHE_CONFIG.ttl
    );
  }

  /**
   * 执行代理请求
   * @param request 代理请求参数
   * @param config 可选的配置覆盖
   * @returns 代理响应
   */
  async execute(
    request: ProxyRequest,
    config?: ProxyServiceConfig
  ): Promise<CachedProxyResponse> {
    const mergedConfig = { ...this.defaultConfig, ...config };

    // 规范化请求
    const normalizedRequest = this.normalizeRequest(request);

    // 生成缓存键（仅对 GET 请求缓存）
    const cacheKey = this.generateCacheKey(normalizedRequest);
    
    // 检查缓存（仅 GET 请求）
    if (mergedConfig.useCache && normalizedRequest.method === "GET") {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug(`缓存命中: ${this.maskUrl(normalizedRequest.url)}`, { module: 'ProxyService' });
        return { ...cached, cached: true };
      }
    }

    // 记录请求日志
    logger.info(
      `执行代理请求: ${normalizedRequest.method} ${this.maskUrl(normalizedRequest.url)}`,
      { module: 'ProxyService' }
    );

    try {
      // 使用多代理竞速模式
      const response = await sendRequestWithMultipleProxies(
        {
          url: normalizedRequest.url,
          method: normalizedRequest.method || "GET",
          headers: normalizedRequest.headers,
          body: normalizedRequest.body,
        },
        mergedConfig.proxyCount,
        mergedConfig.useFallback
      );

      // 记录响应日志
      logger.info(
        `代理请求完成: 状态=${response.status}, 代理=${response.proxyUsed}, 回退=${response.fallbackUsed}`,
        { module: 'ProxyService' }
      );

      const normalizedResponse = normalizeResponse(response);
      
      // 缓存成功的 GET 请求响应
      if (mergedConfig.useCache && normalizedRequest.method === "GET" && response.success) {
        this.cache.set(cacheKey, normalizedResponse, CACHE_CONFIG.ttl);
        logger.debug(`已缓存响应: ${this.maskUrl(normalizedRequest.url)}`, { module: 'ProxyService' });
      }

      return normalizedResponse;
    } catch (error) {
      logger.error(
        `代理请求失败: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
        { module: 'ProxyService' }
      );

      return {
        success: false,
        status: 0,
        statusText: "Error",
        headers: {},
        body: "",
        proxyUsed: false,
        fallbackUsed: false,
      };
    }
  }

  /**
   * 执行单代理请求（顺序尝试）
   * @param request 代理请求参数
   * @param config 可选的配置覆盖
   * @returns 代理响应
   */
  async executeSequential(
    request: ProxyRequest,
    config?: ProxyServiceConfig
  ): Promise<CachedProxyResponse> {
    const mergedConfig = { ...this.defaultConfig, ...config };

    // 规范化请求
    const normalizedRequest = this.normalizeRequest(request);

    try {
      const response = await sendProxyRequest(
        {
          url: normalizedRequest.url,
          method: normalizedRequest.method || "GET",
          headers: normalizedRequest.headers,
          body: normalizedRequest.body,
        },
        {
          maxProxyAttempts: mergedConfig.maxProxyAttempts,
          useFallback: mergedConfig.useFallback,
        }
      );

      return normalizeResponse(response);
    } catch (error) {
      logger.error(
        `顺序代理请求失败: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined,
        { module: 'ProxyService' }
      );

      return {
        success: false,
        status: 0,
        statusText: "Error",
        headers: {},
        body: "",
        proxyUsed: false,
        fallbackUsed: false,
      };
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("缓存已清除", { module: 'ProxyService' });
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return this.cache.getStats();
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(request: { url: string; method: string; body?: string }): string {
    const key = `${request.method}:${request.url}:${request.body || ""}`;
    return simpleHash(key);
  }

  /**
   * 规范化请求参数
   */
  private normalizeRequest(request: ProxyRequest): {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  } {
    // 过滤危险 headers
    const headers = request.headers
      ? filterDangerousHeaders(request.headers)
      : undefined;

    return {
      url: request.url,
      method: request.method || "GET",
      headers,
      body: request.body,
    };
  }

  /**
   * 遮蔽 URL 中的敏感信息（用于日志）
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // 只显示域名和路径，隐藏查询参数
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return url;
    }
  }
}

/**
 * 创建默认代理服务实例
 */
export function createProxyService(config?: ProxyServiceConfig): ProxyService {
  return new ProxyService(config);
}
