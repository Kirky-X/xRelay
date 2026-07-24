/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Cron Cleanup Endpoint - Vercel Cron 清理端点
 * 由 Vercel Cron Jobs 定期调用，清理过期的废弃代理
 *
 * 鉴权策略（优先级递减）：
 *   1. 配置了 CRON_SECRET：必须 Authorization: Bearer <CRON_SECRET>（常量时间比较）
 *   2. 未配置 CRON_SECRET：
 *      - 生产环境：拒绝（防止未授权触发）
 *      - 非生产环境：仅允许 Vercel Cron 内部触发（x-vercel-cron: true）
 *
 * 安全考虑：
 * - 拒绝除 POST/GET 外的方法，防止被滥用为通用 webhook
 * - GET 方法仅用于人工触发调试，生产仍由 Vercel Cron POST 调用
 * - 使用常量时间比较 Bearer token，防止时序攻击
 *
 * 签名：使用 @vercel/node 的 (req, res) 签名，与 api/index.ts 入口一致。
 * 此前版本误用 Web API (Request → Response) 签名配合 nodejs runtime，
 * 导致返回的 Response 被 Vercel 忽略、连接挂起至 30s 超时（HTTP 000）。
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runCleanup } from "../../src/database/cleanup.js";
import { timingSafeEqualString } from "../../src/utils/crypto.js";

export const config = {
  runtime: "nodejs",
};

/**
 * 验证 Cron 请求授权
 */
function validateCronAuth(req: VercelRequest): boolean {
  // 1. Vercel 平台 Cron 调用始终信任（x-vercel-cron 头由 Vercel 注入）。
  //    Vercel Cron 不支持自定义 Authorization 头，配置 CRON_SECRET 时也必须放行
  //    平台调用，否则每日定时清理任务会被拒（401）。手动/外部调用仍需 Bearer。
  if (req.headers?.["x-vercel-cron"] === "true") {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;

  // 2. 外部/手动调用：配置了 CRON_SECRET 时必须匹配 Bearer token（常量时间比较）
  if (cronSecret) {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }
    const providedToken = authHeader.slice(7); // 移除 "Bearer " 前缀
    return timingSafeEqualString(providedToken, cronSecret);
  }

  // 3. 未配置 CRON_SECRET 的外部调用：拒绝（生产环境防止未授权触发清理任务）
  return false;
}

/**
 * Cron Cleanup Handler
 *
 * 使用 @vercel/node (req, res) 签名，通过 res.json()/res.status() 写响应，
 * 避免 Web Response 在 nodejs runtime 下被忽略。
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 仅允许 POST（Vercel Cron 默认）和 GET（人工调试）
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!validateCronAuth(req)) {
    console.log("[Cron] Unauthorized cleanup request");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.log("[Cron] Starting scheduled cleanup...");

  try {
    const result = await runCleanup();
    console.log("[Cron] Cleanup completed successfully");

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      deletedCount: result.deletedCount,
      stats: result.stats,
    });
  } catch (error) {
    console.error("[Cron] Cleanup failed:", error);
    res.status(500).json({
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
