/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * KV Client - 共享 KV 客户端模块
 * 统一管理 Vercel KV 连接，避免重复初始化
 */

import type { createClient } from "@vercel/kv";

type KVClient = ReturnType<typeof createClient>;

let kvClient: KVClient | null = null;
let kvClientPromise: Promise<KVClient | null> | null = null;

/**
 * 获取 KV 客户端实例（单例模式）
 */
export async function getKV(): Promise<KVClient | null> {
  if (kvClient) {
    return kvClient;
  }

  if (kvClientPromise) {
    return kvClientPromise;
  }

  kvClientPromise = (async () => {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      console.log("[KV] KV 未配置，使用降级模式");
      return null;
    }

    try {
      const { createClient } = await import("@vercel/kv");
      
      kvClient = createClient({
        url,
        token,
      });

      console.log("[KV] KV 客户端初始化成功");
      return kvClient;
    } catch (error) {
      console.error("[KV] KV 客户端初始化失败:", error);
      return null;
    }
  })();

  return kvClientPromise;
}

/**
 * 重置 KV 客户端（用于测试）
 */
export function resetKV(): void {
  kvClient = null;
  kvClientPromise = null;
}

/**
 * 检查 KV 是否可用
 */
export async function isKVAvailable(): Promise<boolean> {
  const kv = await getKV();
  return kv !== null;
}
