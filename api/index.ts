/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Vercel Function - 入口文件
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // 获取路径（去除查询字符串）
  const path = req.url?.split("?")[0] || "";

  // Health check endpoint
  if (req.method === "GET" && (path === "/api/health" || path === "/api/ready")) {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      message: "xRelay is running",
    });
    return;
  }

  // Default response
  res.status(405).json({
    error: "Method not allowed",
    code: "METHOD_NOT_ALLOWED",
  });
}
