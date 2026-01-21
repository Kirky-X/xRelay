/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Available Proxies DAO - 可用代理数据访问层
 * 提供可用代理的 CRUD 操作
 */

import { query, transaction } from "./connection.js";

export interface AvailableProxy {
  id?: number;
  ip: string;
  port: number;
  source: string;
  failure_count: number;
  success_count: number;
  last_used_at?: Date;
  last_checked_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export interface ProxyWithWeight extends AvailableProxy {
  weight: number;
}

/**
 * 插入或更新代理
 */
export async function upsertProxy(proxy: Omit<AvailableProxy, "id" | "created_at" | "updated_at">): Promise<AvailableProxy> {
  const text = `
    INSERT INTO xrelay.available_proxies (ip, port, source, failure_count, success_count, last_used_at, last_checked_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (ip, port)
    DO UPDATE SET
      source = EXCLUDED.source,
      failure_count = EXCLUDED.failure_count,
      success_count = EXCLUDED.success_count,
      last_used_at = EXCLUDED.last_used_at,
      last_checked_at = EXCLUDED.last_checked_at,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const values = [
    proxy.ip,
    proxy.port,
    proxy.source,
    proxy.failure_count,
    proxy.success_count,
    proxy.last_used_at || null,
    proxy.last_checked_at || null,
  ];

  const result = await query(text, values);
  return result.rows[0];
}

/**
 * 批量插入代理
 */
export async function batchInsertProxies(proxies: Omit<AvailableProxy, "id" | "created_at" | "updated_at">[]): Promise<number> {
  if (proxies.length === 0) {
    return 0;
  }

  const text = `
    INSERT INTO xrelay.available_proxies (ip, port, source, failure_count, success_count)
    VALUES ${proxies.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, 0)`).join(", ")}
    ON CONFLICT (ip, port) DO NOTHING
  `;

  const values: (string | number)[] = [];
  for (const proxy of proxies) {
    values.push(proxy.ip, proxy.port, proxy.source, proxy.failure_count);
  }

  const result = await query(text, values);
  return result.rowCount || 0;
}

/**
 * 获取所有可用代理
 */
export async function getAllProxies(): Promise<AvailableProxy[]> {
  const text = "SELECT * FROM xrelay.available_proxies ORDER BY updated_at DESC";
  const result = await query(text);
  return result.rows;
}

/**
 * 获取带权重的代理列表
 */
export async function getProxiesWithWeight(): Promise<ProxyWithWeight[]> {
  const text = "SELECT * FROM xrelay.available_proxies";
  const result = await query(text);

  return result.rows.map((proxy) => ({
    ...proxy,
    weight: calculateWeight(proxy),
  }));
}

/**
 * 计算代理权重
 */
function calculateWeight(proxy: AvailableProxy): number {
  const total = proxy.success_count + proxy.failure_count + 1;
  return proxy.success_count / total;
}

/**
 * 根据权重获取 N 个代理（加权随机选择）
 */
export async function getWeightedProxies(count: number): Promise<AvailableProxy[]> {
  const proxies = await getProxiesWithWeight();

  if (proxies.length === 0) {
    return [];
  }

  // 计算总权重
  const totalWeight = proxies.reduce((sum, p) => sum + p.weight, 0);

  // 如果所有权重都是 0，则随机选择
  if (totalWeight === 0) {
    const shuffled = [...proxies].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  // 加权随机选择
  const selected: AvailableProxy[] = [];
  const remaining = [...proxies];

  for (let i = 0; i < count && remaining.length > 0; i++) {
    let random = Math.random() * totalWeight;
    let index = 0;

    for (let j = 0; j < remaining.length; j++) {
      random -= remaining[j].weight;
      if (random <= 0) {
        index = j;
        break;
      }
    }

    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return selected;
}

/**
 * 获取代理数量
 */
export async function getProxyCount(): Promise<number> {
  const text = "SELECT COUNT(*) as count FROM xrelay.available_proxies";
  const result = await query(text);
  return parseInt(result.rows[0].count, 10);
}

/**
 * 增加失败次数
 */
export async function incrementFailureCount(ip: string, port: number): Promise<AvailableProxy | null> {
  const text = `
    UPDATE xrelay.available_proxies
    SET failure_count = failure_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE ip = $1 AND port = $2
    RETURNING *
  `;

  const result = await query(text, [ip, port]);
  return result.rows[0] || null;
}

/**
 * 增加成功次数
 */
export async function incrementSuccessCount(ip: string, port: number): Promise<AvailableProxy | null> {
  const text = `
    UPDATE xrelay.available_proxies
    SET success_count = success_count + 1,
        last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE ip = $1 AND port = $2
    RETURNING *
  `;

  const result = await query(text, [ip, port]);
  return result.rows[0] || null;
}

/**
 * 更新最后检查时间
 */
export async function updateLastChecked(ip: string, port: number): Promise<void> {
  const text = `
    UPDATE xrelay.available_proxies
    SET last_checked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE ip = $1 AND port = $2
  `;

  await query(text, [ip, port]);
}

/**
 * 删除代理
 */
export async function deleteProxy(ip: string, port: number): Promise<boolean> {
  const text = "DELETE FROM xrelay.available_proxies WHERE ip = $1 AND port = $2";
  const result = await query(text, [ip, port]);
  return (result.rowCount || 0) > 0;
}

/**
 * 清空所有代理
 */
export async function clearAllProxies(): Promise<number> {
  const text = "DELETE FROM xrelay.available_proxies";
  const result = await query(text);
  return result.rowCount || 0;
}

/**
 * 获取失败次数超过阈值的代理
 */
export async function getFailedProxies(threshold: number = 10): Promise<AvailableProxy[]> {
  const text = "SELECT * FROM xrelay.available_proxies WHERE failure_count >= $1";
  const result = await query(text, [threshold]);
  return result.rows;
}