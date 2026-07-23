/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * User-Agent 轮换模块
 *
 * 提供：
 * - 真实浏览器 UA 池（Chrome / Firefox / Safari，主流 OS）
 * - 随机选取（避免被识别为自动化请求）
 * - 稳定默认 UA（向后兼容）
 * - 索引选取（用于确定性测试与调试）
 *
 * 设计原则：
 * - 仅包含主流浏览器的最新稳定版本 UA
 * - 平台分布均衡（Windows / Mac / Linux）
 * - 避免过时 UA（< Chrome 120），避免被目标站标记为可疑
 */

/**
 * 主流浏览器 UA 池（截至 2026 年中的稳定版本）
 */
export const USER_AGENTS: readonly string[] = Object.freeze([
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  // Firefox on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  // Firefox on Linux
  "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
]);

/**
 * 默认 UA（稳定不变，用于测试与默认配置）
 */
const DEFAULT_USER_AGENT = USER_AGENTS[0];

/**
 * 获取随机 User-Agent
 * 用于反检测场景：每次请求使用不同 UA，避免被识别为自动化请求
 *
 * @returns 随机选取的 UA 字符串
 */
export function getRandomUserAgent(): string {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index]!;
}

/**
 * 获取默认 User-Agent（稳定不变）
 * 用于：默认配置、测试断言、向后兼容场景
 *
 * @returns 默认 UA 字符串
 */
export function getDefaultUserAgent(): string {
  return DEFAULT_USER_AGENT;
}

/**
 * 按索引获取 User-Agent（用于测试与确定性场景）
 *
 * 处理边界：
 * - 负索引：取最后一个
 * - 超界索引：回环到开头（mod 运算）
 *
 * @param index UA 池索引
 * @returns 指定索引处的 UA 字符串
 */
export function getUserAgentByIndex(index: number): string {
  if (USER_AGENTS.length === 0) {
    return DEFAULT_USER_AGENT;
  }

  if (index < 0) {
    return USER_AGENTS[USER_AGENTS.length - 1]!;
  }

  const normalizedIndex = index % USER_AGENTS.length;
  return USER_AGENTS[normalizedIndex]!;
}
