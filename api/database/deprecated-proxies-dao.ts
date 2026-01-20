/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Deprecated Proxies DAO - 废弃代理数据访问层
 * 提供废弃代理的 CRUD 操作
 */

import { query } from "./connection.js";

export interface DeprecatedProxy {
  id?: number;
  ip: string;
  port: number;
  source?: string;
  protocol?: string;
  failure_count: number;
  deprecated_at?: Date;
  created_at?: Date;
}

/**
 * 插入废弃代理
 */
export async function insertDeprecatedProxy(proxy: Omit<DeprecatedProxy, "id" | "deprecated_at">): Promise<DeprecatedProxy> {
  const text = `
    INSERT INTO xrelay.deprecated_proxies (ip, port, source, protocol, failure_count, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (ip, port)
    DO UPDATE SET
      failure_count = EXCLUDED.failure_count,
      deprecated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const values = [
    proxy.ip,
    proxy.port,
    proxy.source || null,
    proxy.protocol || "http",
    proxy.failure_count,
    proxy.created_at || new Date(),
  ];

  const result = await query(text, values);
  return result.rows[0];
}

/**
 * 检查代理是否已废弃
 */
export async function isProxyDeprecated(ip: string, port: number): Promise<boolean> {
  const text = "SELECT COUNT(*) as count FROM xrelay.deprecated_proxies WHERE ip = $1 AND port = $2";
  const result = await query(text, [ip, port]);
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * 获取所有废弃代理
 */
export async function getAllDeprecatedProxies(): Promise<DeprecatedProxy[]> {
  const text = "SELECT * FROM xrelay.deprecated_proxies ORDER BY deprecated_at DESC";
  const result = await query(text);
  return result.rows;
}

/**
 * 获取废弃代理数量
 */
export async function getDeprecatedProxyCount(): Promise<number> {
  const text = "SELECT COUNT(*) as count FROM xrelay.deprecated_proxies";
  const result = await query(text);
  return parseInt(result.rows[0].count, 10);
}

/**
 * 获取过期废弃代理
 */
export async function getExpiredDeprecatedProxies(days: number = 30): Promise<DeprecatedProxy[]> {
  const text = `
    SELECT * FROM xrelay.deprecated_proxies
    WHERE deprecated_at < NOW() - INTERVAL '${days} days'
    ORDER BY deprecated_at ASC
  `;
  const result = await query(text);
  return result.rows;
}

/**
 * 删除过期废弃代理
 */
export async function deleteExpiredDeprecatedProxies(days: number = 30): Promise<number> {
  const text = `
    DELETE FROM xrelay.deprecated_proxies
    WHERE deprecated_at < NOW() - INTERVAL '${days} days'
  `;
  const result = await query(text);
  return result.rowCount || 0;
}

/**
 * 清空所有废弃代理
 */
export async function clearAllDeprecatedProxies(): Promise<number> {
  const text = "DELETE FROM xrelay.deprecated_proxies";
  const result = await query(text);
  return result.rowCount || 0;
}

/**
 * 获取废弃代理统计信息
 */
export async function getDeprecatedProxyStats(): Promise<{
  total: number;
  expired: number;
  recent: number;
}> {
  const totalText = "SELECT COUNT(*) as count FROM xrelay.deprecated_proxies";
  const expiredText = "SELECT COUNT(*) as count FROM xrelay.deprecated_proxies WHERE deprecated_at < NOW() - INTERVAL '30 days'";
  const recentText = "SELECT COUNT(*) as count FROM xrelay.deprecated_proxies WHERE deprecated_at >= NOW() - INTERVAL '7 days'";

  const [totalResult, expiredResult, recentResult] = await Promise.all([
    query(totalText),
    query(expiredText),
    query(recentText),
  ]);

  return {
    total: parseInt(totalResult.rows[0].count, 10),
    expired: parseInt(expiredResult.rows[0].count, 10),
    recent: parseInt(recentResult.rows[0].count, 10),
  };
}