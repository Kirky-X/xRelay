/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint - Vercel Cron 清理端点
 * 由 Vercel Cron Jobs 定期调用，清理过期的废弃代理
 *
 * 鉴权策略（优先级递减）：
 *   1. 配置了 CRON_SECRET：必须 Authorization: Bearer <CRON_SECRET>
 *   2. 未配置 CRON_SECRET：仅允许 Vercel 内部触发（x-vercel-cron: true）
 *
 * 安全考虑：
 * - 拒绝除 POST/GET 外的方法，防止被滥用为通用 webhook
 * - GET 方法仅用于人工触发调试，生产仍由 Vercel Cron POST 调用
 */

import { runCleanup } from "../../src/database/cleanup.js";

export const config = {
  runtime: "nodejs",
};

/**
 * 验证 Cron 请求授权
 */
function validateCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  // 配置了 CRON_SECRET：必须匹配 Bearer token
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    return authHeader === `Bearer ${cronSecret}`;
  }

  // 未配置 CRON_SECRET：仅信任 Vercel Cron 内部标识
  return request.headers.get("x-vercel-cron") === "true";
}

/**
 * Cron Cleanup Handler
 */
export default async function handler(request: Request): Promise<Response> {
  // 仅允许 POST（Vercel Cron 默认）和 GET（人工调试）
  if (request.method !== "POST" && request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!validateCronAuth(request)) {
    console.log("[Cron] Unauthorized cleanup request");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
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
