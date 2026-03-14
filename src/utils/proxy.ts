/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 代理工具函数
 * 提供代理相关的通用操作
 */

import type { ProxyInfo } from "../types/index";

/**
 * 生成代理键
 * 用于断路器、缓存等场景的唯一标识
 * 
 * @param proxy 代理信息
 * @returns 代理键字符串 (ip:port)
 */
export function proxyKey(proxy: ProxyInfo | { ip: string; port: string | number }): string {
  return `${proxy.ip}:${proxy.port}`;
}

/**
 * 解析代理键
 * 
 * @param key 代理键字符串
 * @returns 代理信息对象
 */
export function parseProxyKey(key: string): { ip: string; port: number } | null {
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  
  const port = parseInt(parts[1], 10);
  if (isNaN(port)) return null;
  
  return { ip: parts[0], port };
}

/**
 * 遮蔽代理 IP（用于日志）
 * 隐藏部分 IP 地址以保护隐私
 * 
 * @param proxy 代理信息
 * @returns 遮蔽后的代理字符串
 */
export function maskProxy(proxy: ProxyInfo | { ip: string; port: string | number }): string {
  const ip = proxy.ip;
  const parts = ip.split(".");
  
  if (parts.length === 4) {
    // IPv4: 遮蔽最后一段
    return `${parts[0]}.${parts[1]}.${parts[2]}.***:${proxy.port}`;
  }
  
  // IPv6 或其他格式: 遮蔽一半
  const halfLength = Math.floor(ip.length / 2);
  return `${ip.substring(0, halfLength)}***:${proxy.port}`;
}

/**
 * 比较两个代理是否相同
 * 
 * @param a 第一个代理
 * @param b 第二个代理
 * @returns 是否相同
 */
export function isSameProxy(
  a: ProxyInfo | { ip: string; port: string | number },
  b: ProxyInfo | { ip: string; port: string | number }
): boolean {
  return a.ip === b.ip && String(a.port) === String(b.port);
}

/**
 * 代理信息转换为字符串
 * 
 * @param proxy 代理信息
 * @returns 代理字符串
 */
export function proxyToString(proxy: ProxyInfo | { ip: string; port: string | number }): string {
  return `http://${proxy.ip}:${proxy.port}`;
}

/**
 * 从字符串解析代理信息
 * 
 * @param str 代理字符串 (http://ip:port 或 ip:port)
 * @returns 代理信息对象
 */
export function parseProxyString(str: string): ProxyInfo | null {
  try {
    let ip: string;
    let port: string;
    
    if (str.startsWith("http://") || str.startsWith("https://")) {
      const url = new URL(str);
      ip = url.hostname;
      port = url.port || (url.protocol === "https:" ? "443" : "80");
    } else {
      const parts = str.split(":");
      if (parts.length !== 2) return null;
      ip = parts[0];
      port = parts[1];
    }
    
    return {
      ip,
      port,
      source: "parsed",
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}
