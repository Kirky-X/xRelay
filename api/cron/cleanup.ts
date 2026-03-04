/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint - Vercel Cron 清理端点
 * 由 Vercel Cron Jobs 定期调用，清理过期的废弃代理
 */

import { runCleanup } from "../database/cleanup.js";
import { isProduction } from "../config.js";

export const config = {
  runtime: "nodejs",
};

/**
 * 验证 Cron 请求授权
 * 安全策略：
 * 1. 生产环境必须配置 CRON_SECRET
 * 2. 非生产环境允许 Vercel Cron header
 */
function validateCronAuth(request: Request): { valid: boolean; error?: string } {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = request.headers.get("x-vercel-cron") === "true";

  // 生产环境必须配置 CRON_SECRET
  if (isProduction()) {
    if (!cronSecret) {
      console.error("[Cron] CRON_SECRET must be configured in production");
      return { valid: false, error: "Server misconfigured: CRON_SECRET not set" };
    }
    
    // 验证 Authorization header
    const expectedAuth = `Bearer ${cronSecret}`;
    if (authHeader !== expectedAuth) {
      return { valid: false, error: "Invalid authorization" };
    }
    
    return { valid: true };
  }

  // 非生产环境：允许 CRON_SECRET 或 Vercel Cron header
  if (cronSecret) {
    const expectedAuth = `Bearer ${cronSecret}`;
    if (authHeader !== expectedAuth) {
      return { valid: false, error: "Invalid authorization" };
    }
    return { valid: true };
  }

  // 非生产环境且无 CRON_SECRET：信任 Vercel Cron header
  if (isVercelCron) {
    return { valid: true };
  }

  return { valid: false, error: "Missing authentication" };
}

/**
 * Cron Cleanup Handler
 */
export default async function handler(request: Request): Promise<Response> {
  // 只允许 POST 请求
  if (request.method !== "POST" && request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 验证授权
  const authResult = validateCronAuth(request);
  if (!authResult.valid) {
    console.log("[Cron] Unauthorized request:", authResult.error);
    return new Response(JSON.stringify({ error: authResult.error || "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[Cron] Starting scheduled cleanup...");

  try {
    const result = await runCleanup();

    console.log("[Cron] Cleanup completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        deletedCount: result.deletedCount,
        stats: result.stats,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Cron] Cleanup failed:", error);

    return new Response(
      JSON.stringify({
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
