/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint - Vercel Cron 清理端点
 * 由 Vercel Cron Jobs 定期调用，清理过期的废弃代理
 */

import { runCleanup } from "../database/cleanup.js";

export const config = {
  runtime: "nodejs",
};

/**
 * 验证 Cron 请求授权
 */
function validateCronAuth(request: Request): boolean {
  // Vercel Cron Jobs 会自动添加这个 header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // 如果没有配置 CRON_SECRET，则只允许来自 Vercel 内部的请求
  if (!cronSecret) {
    // Vercel Cron Jobs 会设置这个 header
    const isVercelCron = request.headers.get("x-vercel-cron") === "true";
    return isVercelCron;
  }

  // 如果配置了 CRON_SECRET，则验证 Authorization header
  const expectedAuth = `Bearer ${cronSecret}`;
  return authHeader === expectedAuth;
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
  if (!validateCronAuth(request)) {
    console.log("[Cron] Unauthorized request");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
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
