/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Pinned DNS Agent 工厂
 *
 * SSRF TOCTOU 防护：将 DNS 解析固定到上层已验证的公网 IP，
 * 防止第二次 DNS 解析返回内网地址（DNS 重绑定攻击）。
 *
 * 本模块统一所有 pinned DNS Agent 的创建逻辑，避免在多个文件
 * 重复实现导致策略变更时遗漏。
 */

import { Agent } from "undici";
import { isIP as netIsIP } from "node:net";

/**
 * Pinned DNS lookup 函数签名（兼容 Node.js dns.lookup 调用约定）
 *
 * 注：undici 的 connect.lookup 类型签名与 Node.js dns.lookup 不直接兼容，
 * 因此调用方需通过 `as unknown as undici.ConnectOptions["lookup"]` 断言。
 * 这里定义明确的函数类型，避免使用 `as never` 完全放弃类型检查。
 */
export type PinnedLookupFunc = (
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) => void;

/**
 * 创建 pinned DNS lookup 函数
 *
 * @param resolvedIp 已验证的公网 IP（IPv4 或 IPv6）
 * @returns lookup 函数（始终返回 resolvedIp，不进行真实 DNS 查询）
 */
export function createPinnedLookup(resolvedIp: string): PinnedLookupFunc {
  return (
    _hostname: string,
    _options: unknown,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ): void => {
    // 防御性校验：resolvedIp 必须是有效 IP 地址。
    // 生产环境曾出现 resolvedIp 为 undefined 导致 node:net 抛 "Invalid IP address: undefined"
    // （DoH 解析路径下偶发透传异常，本地系统 DNS 路径无法复现）。
    // 无效时通过 callback 返回错误，由上层捕获并回退标准 fetch（规则12：失败显性化）。
    if (typeof resolvedIp !== "string" || netIsIP(resolvedIp) === 0) {
      callback(
        new TypeError(
          `Invalid resolvedIp for pinned DNS lookup: ${String(resolvedIp)}`,
        ),
        "",
        4,
      );
      return;
    }
    // family 4 = IPv4, 6 = IPv6；根据 IP 格式判断
    const family = resolvedIp.includes(":") ? 6 : 4;
    callback(null, resolvedIp, family);
  };
}

/**
 * 创建一次性 pinned DNS Agent
 *
 * 用于降级路径或不频繁的请求（如 fetch 兜底、单次资源抓取）。
 * 调用方负责在结束时调用 `agent.close()` 释放连接。
 *
 * @param resolvedIp 已验证的公网 IP
 * @returns 新的 Agent 实例（自定义 lookup 固定到 resolvedIp）
 */
export function createPinnedAgent(resolvedIp: string): Agent {
  const pinnedLookup = createPinnedLookup(resolvedIp);
  // undici Agent.Options.connect 类型来自 buildConnector.BuildOptions（含 lookup 字段），
  // 与 Node.js dns.lookup 签名不直接兼容。通过 unknown 中转后断言到目标类型。
  // 简化自原条件类型断言链，提升可读性（性能/架构 M6）。
  return new Agent({
    connect: {
      lookup: pinnedLookup as unknown as NonNullable<
        NonNullable<ConstructorParameters<typeof Agent>[0]>["connect"]
      > extends infer Conn
        ? Conn extends { lookup?: infer L }
          ? L
          : never
        : never,
    },
  });
}
