/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * URL 验证器模块
 * 封装 URL 安全验证功能，防止 SSRF 攻击
 */

import { validateUrl as validateUrlSecurity } from "../security.js";
import { AppError, createInvalidUrlError, createMissingUrlError } from "../errors/index.js";

/**
 * URL 验证结果
 */
export interface UrlValidationResult {
  valid: boolean;
  url?: string;
  error?: string;
}

/**
 * 验证 URL 是否安全（防止 SSRF）
 * @param url 要验证的 URL
 * @throws AppError 如果 URL 无效或不安全
 */
export function validateUrl(url: unknown): asserts url is string {
  // 检查 URL 是否存在
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw createMissingUrlError();
  }

  // 使用安全模块验证 URL
  const result = validateUrlSecurity(url);

  if (!result.valid) {
    throw createInvalidUrlError(result.error);
  }
}

/**
 * 验证 URL 并返回结果（不抛出异常）
 * @param url 要验证的 URL
 * @returns 验证结果
 */
export function validateUrlSafe(url: unknown): UrlValidationResult {
  // 检查 URL 是否存在
  if (!url || typeof url !== "string" || url.trim() === "") {
    return {
      valid: false,
      error: "URL is required",
    };
  }

  // 使用安全模块验证 URL
  const result = validateUrlSecurity(url);

  return {
    valid: result.valid,
    url: result.valid ? url : undefined,
    error: result.error,
  };
}

/**
 * 检查 URL 是否为有效的 HTTP/HTTPS URL
 * @param url 要检查的 URL
 * @returns 是否有效
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 从 URL 中提取域名
 * @param url URL 字符串
 * @returns 域名或 null
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * 规范化 URL（移除尾部斜杠等）
 * @param url URL 字符串
 * @returns 规范化后的 URL
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // 移除默认端口
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * 检查 URL 是否为有效的公网 URL
 * 验证 URL 格式并检查是否指向公网地址
 * @param url 要检查的 URL
 * @returns 是否为有效的公网 URL
 */
export function isValidPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // 只允许 HTTP/HTTPS 协议
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // 检查是否为 localhost
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return false;
    }

    // 检查是否为 IPv4 私有地址
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return false;
      }

      // 检查是否为私有/保留地址
      const ipNum = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

      // 0.0.0.0/8 (Reserved)
      if ((ipNum & 0xff000000) >>> 0 === 0x00000000) return false;
      // 127.0.0.0/8 (Loopback)
      if ((ipNum & 0xff000000) >>> 0 === 0x7f000000) return false;
      // 10.0.0.0/8 (Private A)
      if ((ipNum & 0xff000000) >>> 0 === 0x0a000000) return false;
      // 172.16.0.0/12 (Private B)
      if ((ipNum & 0xfff00000) >>> 0 === 0xac100000) return false;
      // 192.168.0.0/16 (Private C)
      if ((ipNum & 0xffff0000) >>> 0 === 0xc0a80000) return false;
      // 169.254.0.0/16 (Link-local)
      if ((ipNum & 0xffff0000) >>> 0 === 0xa9fe0000) return false;
      // 224.0.0.0/4 (Multicast)
      if ((ipNum & 0xf0000000) >>> 0 === 0xe0000000) return false;
      // 240.0.0.0/4 (Reserved)
      if ((ipNum & 0xf0000000) >>> 0 === 0xf0000000) return false;
    }

    // 检查是否为 IPv6 私有地址
    if (hostname.includes(":")) {
      const ipv6 = hostname.replace(/^\[|\]$/g, "").toLowerCase();

      // :: (unspecified)
      if (ipv6 === "::" || ipv6 === "::0") return false;
      // ::1 (loopback)
      if (ipv6 === "::1") return false;
      // fc00::/7 (private)
      if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return false;
      // fe80::/10 (link-local)
      if (/^fe[89ab]/.test(ipv6)) return false;
      // ff00::/8 (multicast)
      if (ipv6.startsWith("ff")) return false;
    }

    return true;
  } catch {
    return false;
  }
}
