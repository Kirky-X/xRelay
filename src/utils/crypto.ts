/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 加密工具模块
 * 提供 Edge Runtime 兼容的安全加密函数
 */

/**
 * 常量时间字符串比较（防止时序攻击）
 * 兼容 Edge Runtime，不依赖 Node.js crypto 模块
 * 
 * @param a 第一个字符串
 * @param b 第二个字符串
 * @returns 是否相等
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  
  return result === 0;
}

/**
 * 生成安全的随机字符串
 * 兼容 Edge Runtime
 * 
 * @param length 字符串长度（默认 16）
 * @returns 随机字符串
 */
export function generateSecureRandomString(length: number = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  
  return result;
}

/**
 * 生成请求 ID
 * 格式: req_{timestamp}_{random}
 * 
 * @returns 请求 ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = generateSecureRandomString(9);
  return `req_${timestamp}_${random}`;
}

/**
 * 简单的哈希函数（用于缓存键生成）
 * 使用 djb2 算法
 * 
 * @param str 输入字符串
 * @returns 哈希值（十六进制字符串）
 */
export function simpleHash(str: string): string {
  let hash = 5381;
  
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  
  return (hash >>> 0).toString(16);
}
