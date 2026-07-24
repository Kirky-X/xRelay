/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Security - 安全工具函数
 * 提供 URL 验证、IP 验证等安全功能
 */

import { SECURITY_CONFIG } from "./config.js";
import { logger } from "./logger.js";

/**
 * 将 IPv6 映射地址转换为 IPv4 地址
 * 例如: ::ffff:127.0.0.1 -> 127.0.0.1
 * 也支持十六进制格式: ::ffff:7f00:1 -> 127.0.0.1
 */
function normalizeIPv6Mapping(hostname: string): string {
  // 处理 IPv6 映射地址 ::ffff:x.x.x.x（点分十进制格式）
  const v4MappedDecimal = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
  const decimalMatch = hostname.match(v4MappedDecimal);
  if (decimalMatch) {
    return decimalMatch[1];
  }

  // 处理 IPv6 映射地址 ::ffff:xxxx:xxxx（十六进制格式）
  // IPv4 映射地址范围是 ::ffff:0:0/96
  const v4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
  const hexMatch = hostname.match(v4MappedHex);
  if (hexMatch) {
    // 将两个 16 位十六进制数转换为 IPv4 地址
    const part1 = parseInt(hexMatch[1], 16);
    const part2 = parseInt(hexMatch[2], 16);
    // 第一个部分是 IP 的高 16 位，第二个部分是低 16 位
    const a = (part1 >> 8) & 0xff;
    const b = part1 & 0xff;
    const c = (part2 >> 8) & 0xff;
    const d = part2 & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return hostname;
}

/**
 * 检查 IP 是否为被阻止的私有地址
 */
function isBlockedPrivateIP(a: number, b: number, c: number, d: number): { blocked: boolean; reason?: string } {
  // 使用无符号右移避免 32 位有符号整数问题
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

  // 0.0.0.0/8 (保留地址)
  if ((ip & 0xff000000) >>> 0 === 0x00000000) {
    return { blocked: true, reason: "Reserved address (0.0.0.0/8) not allowed" };
  }
  // 127.0.0.0/8 (Loopback)
  if ((ip & 0xff000000) >>> 0 === 0x7f000000) {
    return { blocked: true, reason: "Loopback address not allowed" };
  }
  // 10.0.0.0/8 (Private Class A)
  if ((ip & 0xff000000) >>> 0 === 0x0a000000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 172.16.0.0/12 (Private Class B)
  if ((ip & 0xfff00000) >>> 0 === 0xac100000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 192.168.0.0/16 (Private Class C)
  if ((ip & 0xffff0000) >>> 0 === 0xc0a80000) {
    return { blocked: true, reason: "Private network not allowed" };
  }
  // 169.254.0.0/16 (Link-local)
  if ((ip & 0xffff0000) >>> 0 === 0xa9fe0000) {
    return { blocked: true, reason: "Link-local address not allowed" };
  }
  // 224.0.0.0/4 (Multicast)
  if ((ip & 0xf0000000) >>> 0 === 0xe0000000) {
    return { blocked: true, reason: "Multicast address not allowed" };
  }
  // 240.0.0.0/4 (Reserved for future use)
  if ((ip & 0xf0000000) >>> 0 === 0xf0000000) {
    return { blocked: true, reason: "Reserved address not allowed" };
  }

  return { blocked: false };
}

/**
 * 验证协议是否允许
 * @param url 解析后的 URL 对象
 * @returns 验证结果
 */
export function validateProtocol(url: URL): { valid: boolean; error?: string } {
  if (!SECURITY_CONFIG.allowedProtocols.includes(url.protocol)) {
    return {
      valid: false,
      error: `Protocol not allowed: ${url.protocol}`,
    };
  }
  return { valid: true };
}

/**
 * 验证域名是否在白名单中
 * @param url 解析后的 URL 对象
 * @returns 验证结果
 */
export function validateDomainWhitelist(url: URL): { valid: boolean; error?: string } {
  if (SECURITY_CONFIG.allowedDomains.length > 0) {
    if (!SECURITY_CONFIG.allowedDomains.includes(url.hostname)) {
      return {
        valid: false,
        error: `Domain not allowed: ${url.hostname}`,
      };
    }
  }
  return { valid: true };
}

/**
 * 验证 IPv4 地址是否为被阻止的私有地址
 * @param hostname 主机名（已标准化）
 * @returns 验证结果
 */
export function validateIPv4Address(hostname: string): { valid: boolean; error?: string } {
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!ipv4Match) {
    return { valid: true }; // 不是 IPv4 地址，继续其他验证
  }

  const [, a, b, c, d] = ipv4Match.map(Number);

  // 检查每个部分是否在 0-255 范围内
  if (a > 255 || b > 255 || c > 255 || d > 255) {
    return { valid: false, error: "Invalid IPv4 address" };
  }

  const result = isBlockedPrivateIP(a, b, c, d);
  if (result.blocked) {
    return { valid: false, error: result.reason };
  }

  return { valid: true };
}

/**
 * 验证 IPv6 地址是否为被阻止的私有地址
 *
 * 覆盖以下私有/内网/保留 IPv6 地址段：
 * - :: (未指定地址)
 * - ::1 (loopback)
 * - fc00::/7 (唯一本地地址 ULA)
 * - fe80::/10 (链路本地地址)
 * - ff00::/8 (多播地址)
 * - ::ffff:x.x.x.x (IPv4 映射地址，递归校验内嵌 IPv4)
 * - ::x.x.x.x / 0:0:0:0:0:0:x.x.x.x (IPv4 兼容地址，递归校验内嵌 IPv4)
 * - 2002:xxxx:xxxx::/16 (6to4 隧道，内嵌 IPv4 递归校验)
 * - 64:ff9b::/96 (NAT64 well-known prefix，内嵌 IPv4 递归校验)
 *
 * @param hostname 主机名（已标准化）
 * @returns 验证结果
 */
export function validateIPv6Address(hostname: string): { valid: boolean; error?: string } {
  if (!hostname.includes(":")) {
    return { valid: true }; // 不是 IPv6 地址，继续其他验证
  }

  // 移除方括号（URL 中的 IPv6 地址格式为 [::1]）
  // 统一小写以便前缀匹配大小写不敏感
  const ipv6Address = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // :: (未指定地址)
  if (ipv6Address === "::" || ipv6Address === "::0") {
    return { valid: false, error: "Unspecified address not allowed" };
  }

  // ::1 (loopback) - 也会匹配 0:0:0:0:0:0:0:1 等展开形式
  if (ipv6Address === "::1" || ipv6Address === "0:0:0:0:0:0:0:1") {
    return { valid: false, error: "IPv6 loopback not allowed" };
  }

  // fc00::/7 (private) - 匹配 fc/fd 开头
  if (ipv6Address.startsWith("fc") || ipv6Address.startsWith("fd")) {
    return { valid: false, error: "IPv6 private network not allowed" };
  }

  // fe80::/10 (link-local) - 匹配 fe8/fe9/fea/feb 开头
  if (/^fe[89ab]/.test(ipv6Address)) {
    return { valid: false, error: "IPv6 link-local not allowed" };
  }

  // ff00::/8 (multicast)
  if (ipv6Address.startsWith("ff")) {
    return { valid: false, error: "IPv6 multicast address not allowed" };
  }

  // 2002::/16 (6to4 隧道) - 内嵌的 IPv4 地址可能是私有地址
  // 格式: 2002:XXYY:ZZWW:: 其中 XX.XX.YY.ZZ.WW.WW 是内嵌 IPv4
  // 实际格式: 2002:abcd:efgh:: 表示内嵌 IPv4 为 ab.cd.ef.gh
  if (ipv6Address.startsWith("2002:")) {
    const embeddedIpv4 = extractEmbeddedIPv4From6to4(ipv6Address);
    if (embeddedIpv4) {
      const ipv4Result = validateIPv4Address(embeddedIpv4);
      if (!ipv4Result.valid) {
        return { valid: false, error: `6to4 tunnel embeds blocked IPv4: ${ipv4Result.error}` };
      }
    }
  }

  // 64:ff9b::/96 (NAT64 well-known prefix) - 内嵌 IPv4 在最后 32 位
  if (ipv6Address.startsWith("64:ff9b:") || ipv6Address.startsWith("64:ff9b::")) {
    const embeddedIpv4 = extractEmbeddedIPv4FromNAT64(ipv6Address);
    if (embeddedIpv4) {
      const ipv4Result = validateIPv4Address(embeddedIpv4);
      if (!ipv4Result.valid) {
        return { valid: false, error: `NAT64 tunnel embeds blocked IPv4: ${ipv4Result.error}` };
      }
    }
  }

  // 2001:0000::/32 (Teredo 隧道) - 已废弃（RFC 4380），按前缀直接拒绝
  // Teredo 内嵌 IPv4 在最后 32 位，但 URL 标准化会把点分 IPv4 转为 hex
  // 并把 "2001:0000::" 压缩为 "2001::"，提取逻辑易出错；
  // 且 Teredo 在生产环境不应使用，按前缀拒绝更安全。
  // 注意：仅匹配 2001:0000::/32（Teredo），不影响 2001:db8::/32（文档）等
  if (
    ipv6Address.startsWith("2001::") ||
    ipv6Address.startsWith("2001:0:0:") ||
    ipv6Address.startsWith("2001:0000:")
  ) {
    return { valid: false, error: "Teredo tunnel address not allowed" };
  }

  // IPv4 映射地址 ::ffff:x.x.x.x 或 IPv4 兼容地址 ::x.x.x.x
  // （normalizeIPv6Mapping 已处理部分格式，但这里再次检查所有变体）
  const ipv4MappedMatch = ipv6Address.match(/(?:^|:)ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4MappedMatch) {
    const embeddedIpv4 = ipv4MappedMatch[1];
    const ipv4Result = validateIPv4Address(embeddedIpv4);
    if (!ipv4Result.valid) {
      return { valid: false, error: `IPv4-mapped IPv6 address embeds blocked IPv4: ${ipv4Result.error}` };
    }
  }

  // ::x.x.x.x (IPv4 兼容地址，已废弃但仍有风险)
  const ipv4CompatibleMatch = ipv6Address.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4CompatibleMatch) {
    const embeddedIpv4 = ipv4CompatibleMatch[1];
    const ipv4Result = validateIPv4Address(embeddedIpv4);
    if (!ipv4Result.valid) {
      return { valid: false, error: `IPv4-compatible IPv6 address embeds blocked IPv4: ${ipv4Result.error}` };
    }
  }

  return { valid: true };
}

/**
 * 从 6to4 隧道地址中提取内嵌的 IPv4 地址
 * 6to4 格式: 2002:XXYY:ZZWW:: 表示内嵌 IPv4 为 XX.XX.YY.ZZ
 * 其中 XXYY 是 IPv4 前 16 位的十六进制表示
 *
 * @param ipv6Address 6to4 IPv6 地址（小写）
 * @returns 内嵌的 IPv4 地址（点分十进制），或 null（无法提取）
 */
function extractEmbeddedIPv4From6to4(ipv6Address: string): string | null {
  // 2002:XXYY:ZZWW::... 或 2002:XXYY:ZZWW:...:...
  const match = ipv6Address.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (!match) return null;

  const part1 = parseInt(match[1], 16);
  const part2 = parseInt(match[2], 16);
  const a = (part1 >> 8) & 0xff;
  const b = part1 & 0xff;
  const c = (part2 >> 8) & 0xff;
  const d = part2 & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * 从 NAT64 地址中提取内嵌的 IPv4 地址
 * NAT64 well-known prefix: 64:ff9b::/96
 * IPv4 地址在最后 32 位
 *
 * @param ipv6Address NAT64 IPv6 地址（小写）
 * @returns 内嵌的 IPv4 地址（点分十进制），或 null（无法提取）
 */
function extractEmbeddedIPv4FromNAT64(ipv6Address: string): string | null {
  // 64:ff9b::xxxx:xxxx 或 64:ff9b:0:0:0:0:xxxx:xxxx
  // 或 64:ff9b::a.b.c.d （某些表示法）
  // 先尝试末尾 IPv4 点分格式
  const dottedMatch = ipv6Address.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }

  // 尝试从最后两个 16 位段提取
  // 格式: 64:ff9b:0:0:0:0:XXXX:YYYY
  const hexMatch = ipv6Address.match(/^64:ff9b:[0:]*([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const part1 = parseInt(hexMatch[1], 16);
    const part2 = parseInt(hexMatch[2], 16);
    const a = (part1 >> 8) & 0xff;
    const b = part1 & 0xff;
    const c = (part2 >> 8) & 0xff;
    const d = part2 & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

/**
 * 验证是否为 localhost
 * @param hostname 主机名
 * @returns 验证结果
 */
export function validateLocalhost(hostname: string): { valid: boolean; error?: string } {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { valid: false, error: "Localhost not allowed" };
  }
  return { valid: true };
}

/**
 * 验证 URL 是否安全（防止 SSRF）
 * 
 * 注意：此函数仅进行静态 URL 分析。对于更严格的 SSRF 防护，
 * 建议在 DNS 解析后再次验证解析后的 IP 地址，以防止 DNS 重绑定攻击。
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  // 检查 URL 中是否包含控制字符（防止 CRLF 注入和其他注入攻击）
  const controlCharPattern = /[\x00-\x1F\x7F]/;
  if (controlCharPattern.test(url)) {
    return { valid: false, error: "URL contains control characters" };
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid URL",
    };
  }

  // 1. 验证协议
  const protocolResult = validateProtocol(parsedUrl);
  if (!protocolResult.valid) {
    return protocolResult;
  }

  // 2. 验证域名白名单
  const domainResult = validateDomainWhitelist(parsedUrl);
  if (!domainResult.valid) {
    return domainResult;
  }

  // 3. 标准化主机名
  let hostname = parsedUrl.hostname;
  hostname = hostname.replace(/^\[|\]$/g, ""); // 移除 IPv6 地址的方括号
  hostname = normalizeIPv6Mapping(hostname); // 处理 IPv6 映射地址

  // 4. 验证 IPv4 地址
  const ipv4Result = validateIPv4Address(hostname);
  if (!ipv4Result.valid) {
    return ipv4Result;
  }

  // 5. 验证 IPv6 地址
  const ipv6Result = validateIPv6Address(hostname);
  if (!ipv6Result.valid) {
    return ipv6Result;
  }

  // 6. 验证 localhost
  const localhostResult = validateLocalhost(hostname);
  if (!localhostResult.valid) {
    return localhostResult;
  }

  return { valid: true };
}

/**
 * 验证是否为有效的公网 IP
 * 支持 IPv4 和 IPv6 地址验证
 */
export function isValidPublicIp(ip: string): boolean {
  // 处理 IPv6 映射地址
  ip = normalizeIPv6Mapping(ip);

  // IPv4 验证
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;

    const ipNum = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

    // 排除内网地址
    if ((ipNum & 0xff000000) >>> 0 === 0x00000000) return false; // 0.0.0.0/8 (Reserved)
    if ((ipNum & 0xff000000) >>> 0 === 0x7f000000) return false; // 127.0.0.0/8 (Loopback)
    if ((ipNum & 0xff000000) >>> 0 === 0x0a000000) return false; // 10.0.0.0/8 (Private A)
    if ((ipNum & 0xfff00000) >>> 0 === 0xac100000) return false; // 172.16.0.0/12 (Private B)
    if ((ipNum & 0xffff0000) >>> 0 === 0xc0a80000) return false; // 192.168.0.0/16 (Private C)
    if ((ipNum & 0xffff0000) >>> 0 === 0xa9fe0000) return false; // 169.254.0.0/16 (Link-local)
    if ((ipNum & 0xf0000000) >>> 0 === 0xe0000000) return false; // 224.0.0.0/4 (Multicast)
    if ((ipNum & 0xf0000000) >>> 0 === 0xf0000000) return false; // 240.0.0.0/4 (Reserved)

    return true;
  }

  // IPv6 验证
  if (ip.includes(':')) {
    const ipv6 = ip.replace(/^\[|\]$/g, '').toLowerCase();

    // 未指定地址 :: 或 ::0
    if (ipv6 === '::' || ipv6 === '::0') return false;
    // Loopback ::1
    if (ipv6 === '::1') return false;
    // 唯一本地地址 fc00::/7 (fc00::/8 和 fd00::/8)
    if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return false;
    // 链路本地地址 fe80::/10
    if (/^fe[89ab]/.test(ipv6)) return false;
    // 多播地址 ff00::/8
    if (ipv6.startsWith('ff')) return false;
    // IPv4 映射地址 (已通过 normalizeIPv6Mapping 处理，但再次检查以防遗漏)
    if (ipv6.includes('::ffff:')) return false;
    // 6to4 隧道：内嵌 IPv4 可能是私有地址（详见 validateIPv6Address）
    if (ipv6.startsWith('2002:')) return false;
    // NAT64：内嵌 IPv4 可能是私有地址
    if (ipv6.startsWith('64:ff9b:')) return false;
    // Teredo：内嵌 IPv4 可能是私有地址
    // 与 validateIPv6Address 保持一致，覆盖三种压缩形式：
    // - 2001::（最短压缩）
    // - 2001:0:0:（部分压缩）
    // - 2001:0000:（未压缩）
    if (
      ipv6.startsWith('2001::') ||
      ipv6.startsWith('2001:0:0:') ||
      ipv6.startsWith('2001:0000:') ||
      ipv6.startsWith('2001:0:')
    ) return false;

    return true;
  }

  return false;
}

/**
 * DNS 解析结果缓存
 * 用于防止 DNS 重绑定攻击
 *
 * LRU 淘汰策略：与 AdvancedCache、ProxyAgent 池一致（规则8），
 * 命中时移到末尾，热点域名优先保留。
 */
const MAX_DNS_CACHE_SIZE = 500;
const dnsCache = new Map<string, { ips: string[]; timestamp: number }>();
const DNS_CACHE_TTL = 60 * 1000; // 60 秒缓存

/**
 * 删除最旧缓存条目的辅助函数（LRU 淘汰）
 */
function evictOldestDnsCacheEntry(): void {
  const firstKey = dnsCache.keys().next().value;
  if (firstKey !== undefined) {
    dnsCache.delete(firstKey);
  }
}

/**
 * 使用 DNS-over-HTTPS 解析域名
 * 防止 DNS 重绑定攻击
 * 同时查询 A 和 AAAA 记录，防止攻击者仅通过 IPv6 绕过
 */
export async function resolveDns(hostname: string): Promise<string[]> {
  // 检查缓存
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    // LRU：命中时移到末尾（最近使用），与 AdvancedCache 一致
    dnsCache.delete(hostname);
    dnsCache.set(hostname, cached);
    return cached.ips;
  }

  // 如果是 IPv4 地址，直接返回
  const ipv4Match = hostname.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4Match) {
    return [hostname];
  }

  // IPv6 地址
  if (hostname.includes(':')) {
    return [hostname];
  }

  try {
    // 并行查询 A 和 AAAA 记录，防止攻击者仅通过 IPv6 私有地址绕过校验
    const dohUrl = (type: 'A' | 'AAAA') =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;

    // DoH 请求超时控制：5 秒内未完成则中止
    // 防止 DoH 服务不可达时请求长时间挂起
    const DOH_TIMEOUT_MS = 5000;
    const fetchWithTimeout = (url: string): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
      return fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
    };

    const [aResp, aaaaResp] = await Promise.allSettled([
      fetchWithTimeout(dohUrl('A')),
      fetchWithTimeout(dohUrl('AAAA')),
    ]);

    const ips: string[] = [];

    const extractAnswers = async (resp: PromiseSettledResult<Response>) => {
      if (resp.status !== 'fulfilled' || !resp.value.ok) return;
      const data = await resp.value.json() as { Answer?: { data: string }[] };
      const records = data.Answer?.map(a => a.data).filter(Boolean) || [];
      ips.push(...records);
    };

    await extractAnswers(aResp);
    await extractAnswers(aaaaResp);

    // 去重
    let uniqueIps = [...new Set(ips)];

    // 开发模式 fallback：DoH 不可达时回退到系统 DNS
    // 生产环境保持 fail-closed（仅信任 DoH，防止 DNS 重绑定攻击）
    if (uniqueIps.length === 0 && process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
      try {
        const dnsPromises = await import('node:dns/promises');
        const lookupResult = await dnsPromises.lookup(hostname, { all: true });
        uniqueIps = lookupResult.map(r => r.address);
        if (uniqueIps.length > 0) {
          logger.warn(
            `DoH 失败，开发模式回退到系统 DNS: ${hostname}`,
            { module: 'Security', fallback: 'system-dns' },
          );
        }
      } catch (fallbackError) {
        logger.debug(
          `系统 DNS 也失败: ${hostname}: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
          { module: 'Security' },
        );
      }
    }

    // 检查缓存大小限制，超过则删除最旧的条目
    if (dnsCache.size >= MAX_DNS_CACHE_SIZE) {
      evictOldestDnsCacheEntry();
    }
    // 缓存结果
    dnsCache.set(hostname, { ips: uniqueIps, timestamp: Date.now() });

    return uniqueIps;
  } catch (error) {
    logger.error(
      `DNS 解析失败: ${hostname}`,
      error instanceof Error ? error : undefined,
      { module: 'Security' }
    );
    return [];
  }
}

/**
 * 验证 DNS 解析后的 IP 地址是否安全
 * 用于防止 DNS 重绑定攻击
 * 
 * @param hostname 要验证的主机名
 * @returns 验证结果
 */
export async function validateDnsResolution(hostname: string): Promise<{ valid: boolean; ips?: string[]; error?: string }> {
  try {
    const ips = await resolveDns(hostname);
    
    if (ips.length === 0) {
      return { valid: false, error: 'DNS resolution returned no results' };
    }

    // 检查所有解析的 IP 是否为公网地址
    for (const ip of ips) {
      if (!isValidPublicIp(ip)) {
        return { 
          valid: false, 
          error: `DNS resolved to blocked IP: ${ip}`,
          ips 
        };
      }
    }

    return { valid: true, ips };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'DNS resolution failed' 
    };
  }
}

/**
 * 清除 DNS 缓存
 */
export function clearDnsCache(): void {
  dnsCache.clear();
}

/**
 * 验证代理端口是否有效
 *
 * 代理服务常运行在 80/443/3128/8080/8888 等端口，< 1024 的端口中
 * 80 与 443 是常见的合法代理端口，不应被标记为可疑。
 * 仅对非标准特权端口（如 1-79, 81-442, 444-1023）发出 warn。
 *
 * @param port 端口号（字符串或数字）
 * @returns 验证结果
 */
export function validateProxyPort(port: string | number): { valid: boolean; port?: number; error?: string } {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (isNaN(portNum)) {
    return { valid: false, error: 'Port is not a valid number' };
  }

  if (!Number.isInteger(portNum)) {
    return { valid: false, error: 'Port must be an integer' };
  }

  if (portNum < 1 || portNum > 65535) {
    return { valid: false, error: `Port ${portNum} is out of valid range (1-65535)` };
  }

  // 仅对非标准特权端口（1-79, 81-442, 444-1023）发出 warn
  // 80 (HTTP) 和 443 (HTTPS) 是合法的代理端口，许多代理服务运行于此
  if (portNum < 1024 && portNum !== 80 && portNum !== 443) {
    logger.warn(`端口号 ${portNum} 是非常规特权端口，通常不应用作代理端口`, { module: 'Security' });
  }

  return { valid: true, port: portNum };
}

/**
 * 验证代理信息是否有效
 * @param ip IP 地址
 * @param port 端口号
 * @returns 验证结果
 */
export function validateProxyInfo(ip: string, port: string | number): { valid: boolean; error?: string } {
  // 验证端口
  const portResult = validateProxyPort(port);
  if (!portResult.valid) {
    return portResult;
  }
  
  // 验证 IP 格式
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) {
      return { valid: false, error: 'Invalid IPv4 address format' };
    }
  } else if (ip.includes(':')) {
    // IPv6 地址基本格式检查
    const ipv6 = ip.replace(/^\[|\]$/g, '');
    if (!ipv6.match(/^[0-9a-f:]+$/i)) {
      return { valid: false, error: 'Invalid IPv6 address format' };
    }
  } else {
    return { valid: false, error: 'Invalid IP address format' };
  }
  
  return { valid: true };
}

/**
 * 验证代理来源字符串
 * @param source 来源字符串
 * @returns 验证结果
 */
export function validateProxySource(source: string | undefined | null): { valid: boolean; source?: string; error?: string } {
  if (!source) {
    // 来源可以为空，使用默认值
    return { valid: true, source: 'unknown' };
  }
  
  // 长度限制
  if (source.length > 50) {
    return { valid: false, error: 'Source string too long (max 50 characters)' };
  }
  
  // 只允许安全字符：字母、数字、下划线、连字符
  if (!source.match(/^[a-zA-Z0-9_-]+$/)) {
    return { valid: false, error: 'Source contains invalid characters (only a-zA-Z0-9_- allowed)' };
  }
  
  return { valid: true, source };
}
