/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 加密工具模块
 * 提供 Edge Runtime 兼容的安全加密函数
 */

import { logger } from "../logger.js";

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
 * node:crypto 的 createHash 函数类型
 *
 * 仅在 Node.js 环境可用；Edge Runtime 通过 lazy import + 缓存避免重复动态 import。
 */
type CreateHashFunc = (algorithm: string) => {
  update(data: string): { digest(encoding: "hex"): string };
};

/**
 * 模块级缓存的 createHash 函数
 *
 * - 初次调用 simpleHash 时通过 lazy import 加载并缓存
 * - 后续调用直接使用缓存，避免热路径上每次都 await import（性能反模式）
 * - null 表示尚未尝试加载；false 表示尝试失败（不应再重试）
 */
let cachedCreateHash: CreateHashFunc | null | false = null;

/**
 * 加载并缓存 node:crypto 的 createHash 函数
 *
 * @returns createHash 函数，或 null（环境不支持 node:crypto）
 */
async function loadCreateHash(): Promise<CreateHashFunc | null> {
  // 已缓存（成功或失败）
  if (cachedCreateHash !== null) {
    return cachedCreateHash === false ? null : cachedCreateHash;
  }

  // 检测 Node.js 环境
  if (typeof process === "undefined" || !process.versions?.node) {
    cachedCreateHash = false;
    return null;
  }

  try {
    const { createHash } = await import("node:crypto");
    cachedCreateHash = createHash as CreateHashFunc;
    return cachedCreateHash;
  } catch (error) {
    // node:crypto 不可用（罕见，可能是受限环境）
    // 失败必须显性化（规则12）：记录警告，避免静默退化
    logger.warn(
      `node:crypto 不可用，simpleHash 将回退到 Web Crypto API 或抛错: ${error instanceof Error ? error.message : String(error)}`,
      { module: "CryptoUtils" },
    );
    cachedCreateHash = false;
    return null;
  }
}

/**
 * 缓存键哈希函数
 *
 * 使用 SHA-256（Web Crypto API，Edge Runtime 兼容）替代 djb2，
 * 避免哈希碰撞导致缓存错误命中（不同 URL 返回相同缓存）。
 *
 * 实现策略（按优先级）：
 * 1. Node.js 环境：node:crypto.createHash("sha256")，同步、最快（顶层缓存）
 * 2. Edge Runtime：crypto.subtle.digest("SHA-256", ...)，异步
 * 3. 两者都不可用：抛错（fail-closed，规则12：失败必须显性化）
 *
 * 历史变更：原 djb2 fallback（32 位弱哈希）已移除，避免生产环境静默使用弱哈希
 * 导致缓存碰撞（安全 L2）。
 *
 * @param str 输入字符串
 * @returns 哈希值（十六进制字符串，64 字符）
 * @throws Error 当运行时既不支持 node:crypto 也不支持 Web Crypto API
 */
export async function simpleHash(str: string): Promise<string> {
  // 优先使用 node:crypto（同步、最快）
  const createHash = await loadCreateHash();
  if (createHash) {
    return createHash("sha256").update(str).digest("hex");
  }

  // Edge Runtime：使用 Web Crypto API 异步计算
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // fail-closed：无可用加密实现时抛错，禁止静默使用弱哈希
  throw new Error(
    "No secure hash implementation available (neither node:crypto nor Web Crypto API)",
  );
}

/**
 * 重置 simpleHash 模块级缓存（仅用于测试跨环境行为）
 *
 * 业务代码不应调用此函数。测试中切模拟 Node/Edge Runtime 时，
 * 需要先重置缓存才能让环境检测重新生效。
 */
export function __resetCryptoCacheForTesting(): void {
  cachedCreateHash = null;
}

