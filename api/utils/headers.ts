/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 获取请求头值（兼容 Headers 对象和普通对象）
 */
export function getHeaderValue(
  headers: Headers | Record<string, string>,
  name: string
): string | null {
  if (headers && typeof headers.get === "function") {
    return headers.get(name);
  } else if (headers && (headers as Record<string, string>)[name]) {
    return (headers as Record<string, string>)[name];
  }
  return null;
}
