/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(",") : [];
const ENABLE_API_KEY = process.env.ENABLE_API_KEY === "true";

function validateApiKey(req: VercelRequest): boolean {
  if (!ENABLE_API_KEY) return true;
  if (API_KEYS.length === 0) return false;

  const providedKey = req.headers["x-api-key"] as string | undefined;
  if (!providedKey) return false;

  return API_KEYS.some(key => {
    if (key.length !== providedKey.length) return false;
    return key.split("").every((char, i) => char === providedKey[i]);
  });
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;

    const hostname = parsed.hostname;

    // Block localhost
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;

    // Block private IP ranges
    if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname)) return false;

    // Block IPv6 private ranges
    if (/^(fc00:|fd00:|fe80:|::1|::$)/i.test(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const path = req.url?.split("?")[0] || "";

  // Health check endpoint
  if (req.method === "GET" && (path === "/api/health" || path === "/api/ready" || path === "/api")) {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      uptime: process.uptime ? Math.floor(process.uptime()) : 0,
    });
    return;
  }

  // Only POST to /api is allowed for proxy requests
  if (req.method !== "POST" || path !== "/api") {
    res.status(405).json({
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    });
    return;
  }

  // API Key validation
  if (!validateApiKey(req)) {
    res.status(401).json({
      error: "Unauthorized",
      code: "INVALID_API_KEY",
    });
    return;
  }

  // Parse request body
  const { url, method = "GET", headers = {}, body } = req.body || {};

  // Validate URL
  if (!url) {
    res.status(400).json({
      error: "URL is required",
      code: "MISSING_URL",
    });
    return;
  }

  if (!isValidUrl(url)) {
    res.status(400).json({
      error: "Invalid or blocked URL",
      code: "INVALID_URL",
    });
    return;
  }

  try {
    // Make the request
    const response = await fetch(url, {
      method,
      headers: {
        "User-Agent": "xRelay/1.0",
        ...headers,
      },
      body: method !== "GET" && method !== "HEAD" ? body : undefined,
    });

    // Get response body
    const responseText = await response.text();

    // Return response
    res.status(200).json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseText,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Request failed",
      code: "REQUEST_FAILED",
      message: errorMessage,
    });
  }
}
