/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Security - 安全工具函数
 * 提供 URL 验证、IP 验证等安全功能
 */

import { SECURITY_CONFIG } from "./config";

/**
 * 验证 URL 是否安全（防止 SSRF）
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);

    // 检查协议
    if (!SECURITY_CONFIG.allowedProtocols.includes(parsedUrl.protocol)) {
      return {
        valid: false,
        error: `Protocol not allowed: ${parsedUrl.protocol}`,
      };
    }

    // 检查域名白名单（如果配置了）
    if (SECURITY_CONFIG.allowedDomains.length > 0) {
      if (!SECURITY_CONFIG.allowedDomains.includes(parsedUrl.hostname)) {
        return {
          valid: false,
          error: `Domain not allowed: ${parsedUrl.hostname}`,
        };
      }
    }

    // 检查是否为内网地址
    const hostname = parsedUrl.hostname;

    // IPv4 检查
    const ipv4Match = hostname.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // 检查每个部分是否在 0-255 范围内
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return { valid: false, error: "Invalid IPv4 address" };
      }

      // 使用无符号右移避免 32 位有符号整数问题
      const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

      // 127.0.0.0/8 (Loopback)
      if ((ip & 0xff000000) >>> 0 === 0x7f000000) {
        return { valid: false, error: "Loopback address not allowed" };
      }
      // 10.0.0.0/8 (Private Class A)
      if ((ip & 0xff000000) >>> 0 === 0x0a000000) {
        return { valid: false, error: "Private network not allowed" };
      }
      // 172.16.0.0/12 (Private Class B)
      if ((ip & 0xfff00000) >>> 0 === 0xac100000) {
        return { valid: false, error: "Private network not allowed" };
      }
      // 192.168.0.0/16 (Private Class C)
      if ((ip & 0xffff0000) >>> 0 === 0xc0a80000) {
        return { valid: false, error: "Private network not allowed" };
      }
      // 169.254.0.0/16 (Link-local)
      if ((ip & 0xffff0000) >>> 0 === 0xa9fe0000) {
        return { valid: false, error: "Link-local address not allowed" };
      }
    }

    // IPv6 检查
    if (hostname.includes(":")) {
      // 移除方括号（URL 中的 IPv6 地址格式为 [::1]）
      const ipv6Address = hostname.replace(/^\[|\]$/g, "");

      // ::1 (loopback)
      if (ipv6Address === "::1") {
        return { valid: false, error: "IPv6 loopback not allowed" };
      }
      // fc00::/7 (private)
      if (ipv6Address.startsWith("fc") || ipv6Address.startsWith("fd")) {
        return { valid: false, error: "IPv6 private network not allowed" };
      }
      // fe80::/10 (link-local)
      if (
        ipv6Address.startsWith("fe") &&
        (ipv6Address[2] === "8" ||
          ipv6Address[2] === "9" ||
          ipv6Address[2] === "a" ||
          ipv6Address[2] === "b")
      ) {
        return { valid: false, error: "IPv6 link-local not allowed" };
      }
    }

    // 检查 localhost
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return { valid: false, error: "Localhost not allowed" };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid URL",
    };
  }
}

/**
 * 验证是否为有效的公网 IP
 */
export function isValidPublicIp(ip: string): boolean {
  // 简单的 IPv4 验证
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const [, a, b, c, d] = ipv4Match.map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;

  // 使用无符号右移避免 32 位有符号整数问题
  const ipNum = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

  // 排除内网地址
  if ((ipNum & 0xff000000) >>> 0 === 0x7f000000) return false; // 127.0.0.0/8
  if ((ipNum & 0xff000000) >>> 0 === 0x0a000000) return false; // 10.0.0.0/8
  if ((ipNum & 0xfff00000) >>> 0 === 0xac100000) return false; // 172.16.0.0/12
  if ((ipNum & 0xffff0000) >>> 0 === 0xc0a80000) return false; // 192.168.0.0/16

  return true;
}
