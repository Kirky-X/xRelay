/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Security - 安全工具函数
 * 提供 URL 验证、IP 验证等安全功能
 */

import { SECURITY_CONFIG } from "./config.js";

/**
 * 将 IPv6 映射地址转换为 IPv4 地址
 * 例如: ::ffff:127.0.0.1 -> 127.0.0.1
 */
function normalizeIPv6Mapping(hostname: string): string {
  // 处理 IPv6 映射地址 ::ffff:x.x.x.x
  const v4Mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
  const match = hostname.match(v4Mapped);
  if (match) {
    return match[1];
  }
  return hostname;
}

/**
 * 检查 IP 是否为被阻止的私有地址
 */
function isBlockedPrivateIP(a: number, b: number, c: number, d: number): { blocked: boolean; reason?: string } {
  // 使用无符号右移避免 32 位有符号整数问题
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

  // 0.0.0.0/8 (保留地址)
  if ((ip & 0xff000000) >>> 0 === 0x00000000) {
    return { blocked: true, reason: "Reserved address (0.0.0.0/8) not allowed" };
  }
  // 127.0.0.0/8 (Loopback)
  if ((ip & 0xff000000) >>> 0 === 0x7f000000) {
    return { blocked: true, reason: "Loopback address not allowed" };
  }
  // 10.0.0.0/8 (Private Class A)
  if ((ip & 0xff000000) >>> 0 === 0x0a000000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 172.16.0.0/12 (Private Class B)
  if ((ip & 0xfff00000) >>> 0 === 0xac100000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 192.168.0.0/16 (Private Class C)
  if ((ip & 0xffff0000) >>> 0 === 0xc0a80000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 169.254.0.0/16 (Link-local)
  if ((ip & 0xffff0000) >>> 0 === 0xa9fe0000) {
    return { blocked: true, reason: "Link-local address not allowed" };
  }
  // 224.0.0.0/4 (Multicast)
  if ((ip & 0xf0000000) >>> 0 === 0xe0000000) {
    return { blocked: true, reason: "Multicast address not allowed" };
  }
  // 240.0.0.0/4 (Reserved for future use)
  if ((ip & 0xf0000000) >>> 0 === 0xf0000000) {
    return { blocked: true, reason: "Reserved address not allowed" };
  }

  return { blocked: false };
}

/**
 * 验证 URL 是否安全（防止 SSRF）
 * 
 * 注意：此函数仅进行静态 URL 分析。对于更严格的 SSRF 防护，
 * 建议在 DNS 解析后再次验证解析后的 IP 地址，以防止 DNS 重绑定攻击。
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
    let hostname = parsedUrl.hostname;

    // 处理 IPv6 映射地址
    hostname = normalizeIPv6Mapping(hostname);

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

      const result = isBlockedPrivateIP(a, b, c, d);
      if (result.blocked) {
        return { valid: false, error: result.reason };
      }
    }

    // IPv6 检查
    if (hostname.includes(":")) {
      // 移除方括号（URL 中的 IPv6 地址格式为 [::1]）
      const ipv6Address = hostname.replace(/^\[|\]$/g, "");

      // :: (未指定地址)
      if (ipv6Address === "::" || ipv6Address === "::0") {
        return { valid: false, error: "Unspecified address not allowed" };
      }
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
