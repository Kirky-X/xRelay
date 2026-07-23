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
 * 实现说明：将两个字符串用 0 填充到相同长度后逐字节 XOR 比较，
 * 长度差异也参与结果计算，避免通过响应时间泄漏长度信息。
 *
 * @param a 第一个字符串
 * @param b 第二个字符串
 * @returns 是否相等
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // 长度差异参与比较结果（长度不等时必为 false）
  let result = aBytes.length ^ bBytes.length;

  // 用 0 填充到较长长度，逐字节常量时间比较
  const maxLen = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < maxLen; i++) {
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    result |= aByte ^ bByte;
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
