/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { Middleware, MiddlewareContext } from "./types.js";

/**
 * CORS 配置
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

/**
 * 默认 CORS 配置
 */
export const DEFAULT_CORS_CONFIG: CorsConfig = {
  allowedOrigins: [
    "https://vercel-proxy-shield.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  allowedMethods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 86400,
};

/**
 * 获取请求头值（兼容 Headers 对象和普通对象）
 */
function getHeaderValue(
  headers: Headers | Record<string, string>,
  name: string
): string | null {
  if (headers && typeof headers.get === "function") {
    return headers.get(name);
  } else if (headers && (headers as Record<string, string>)[name]) {
    return (headers as Record<string, string>)[name];
  }
  return null;
}

/**
 * 获取允许的 CORS origin
 */
function getAllowedOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[]
): string {
  return allowedOrigins.includes(requestOrigin || "") ? requestOrigin || "" : "";
}

/**
 * 创建 CORS 中间件
 * 
 * 处理 OPTIONS 预检请求并为所有响应添加 CORS 头
 */
export function corsMiddleware(config: CorsConfig = DEFAULT_CORS_CONFIG): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    const origin = getHeaderValue(context.request.headers, "origin");
    const corsOrigin = getAllowedOrigin(origin, config.allowedOrigins);

    // 处理 OPTIONS 预检请求
    if (context.request.method === "OPTIONS") {
      context.response = new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": config.allowedMethods.join(", "),
          "Access-Control-Allow-Headers": config.allowedHeaders.join(", "),
          "Access-Control-Max-Age": String(config.maxAge),
        },
      });
      return; // 不调用 next()，终止中间件链
    }

    // 继续执行后续中间件
    await next();

    // 为响应添加 CORS 头
    if (context.response && corsOrigin) {
      const originalHeaders = context.response.headers;
      context.response = new Response(context.response.body, {
        status: context.response.status,
        statusText: context.response.statusText,
        headers: {
          ...Object.fromEntries(originalHeaders.entries()),
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": config.allowedMethods.join(", "),
          "Access-Control-Allow-Headers": config.allowedHeaders.join(", "),
        },
      });
    }
  };
}

/**
 * 仅处理 OPTIONS 请求的中间件（轻量版）
 */
export function optionsMiddleware(config: CorsConfig = DEFAULT_CORS_CONFIG): Middleware {
  return async (context: MiddlewareContext, next: () => Promise<void>) => {
    if (context.request.method === "OPTIONS") {
      const origin = getHeaderValue(context.request.headers, "origin");
      const corsOrigin = getAllowedOrigin(origin, config.allowedOrigins);

      context.response = new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": config.allowedMethods.join(", "),
          "Access-Control-Allow-Headers": config.allowedHeaders.join(", "),
          "Access-Control-Max-Age": String(config.maxAge),
        },
      });
      return;
    }

    await next();
  };
}
