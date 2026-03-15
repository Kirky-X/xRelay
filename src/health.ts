/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Health Check - 健康检查端点
 * 用于监控服务状态和代理池健康度
 */

import { getPoolStatus } from "./proxy-manager.js";

/**
 * 健康检查
 * 返回服务的整体健康状态
 */
export async function healthCheck(): Promise<Response> {
  const startTime = Date.now();

  try {
    const poolStatus = await getPoolStatus();

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: "0.1.2",
      proxyPool: {
        availableCount: poolStatus.availableCount,
        mode: poolStatus.mode,
      },
      responseTime: Date.now() - startTime,
    };

    return new Response(JSON.stringify(health), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const health = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - startTime,
    };

    return new Response(JSON.stringify(health), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
  }
}

/**
 * 就绪检查
 * 检查服务是否准备好接收请求
 */
export async function readinessCheck(): Promise<Response> {
  try {
    const poolStatus = await getPoolStatus();

    if (poolStatus.availableCount === 0) {
      return new Response(
        JSON.stringify({
          status: "not_ready",
          reason: "No proxies available",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ status: "ready" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: "not_ready",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
