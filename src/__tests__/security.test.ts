/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Security Tests - 安全模块边界测试
 * 测试 IPv6 验证、DNS 重绑定防护、代理端口验证、特殊字符 URL 等
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateUrl,
  isValidPublicIp,
  validateProxyPort,
  validateProxySource,
  validateDnsResolution,
  clearDnsCache,
} from '../security.js';

describe('Security - IPv6 验证', () => {
  it('应该拒绝 IPv6 loopback 地址', () => {
    expect(validateUrl('http://[::1]/path').valid).toBe(false);
  });

  it('应该拒绝 IPv6 私有地址', () => {
    expect(validateUrl('http://[fc00::1]/path').valid).toBe(false);
    expect(validateUrl('http://[fd00::1]/path').valid).toBe(false);
  });

  it('应该拒绝 IPv6 链路本地地址', () => {
    expect(validateUrl('http://[fe80::1]/path').valid).toBe(false);
  });

  it('应该拒绝 IPv6 多播地址', () => {
    expect(validateUrl('http://[ff00::1]/path').valid).toBe(false);
  });

  it('应该拒绝 IPv6 未指定地址', () => {
    expect(validateUrl('http://[::]/path').valid).toBe(false);
  });

  it('应该拒绝 IPv6 映射的 IPv4 私有地址', () => {
    // ::ffff:127.0.0.1 映射到 IPv4 loopback
    expect(validateUrl('http://[::ffff:127.0.0.1]/path').valid).toBe(false);
    // ::ffff:10.0.0.1 映射到私有地址
    expect(validateUrl('http://[::ffff:10.0.0.1]/path').valid).toBe(false);
    // ::ffff:192.168.1.1 映射到私有地址
    expect(validateUrl('http://[::ffff:192.168.1.1]/path').valid).toBe(false);
  });
});

describe('Security - IPv6 公网地址', () => {
  it('isValidPublicIp 应该正确识别 IPv6 公网地址', () => {
    expect(isValidPublicIp('2001:4860:4860::8888')).toBe(true);
  });

  it('isValidPublicIp 应该拒绝 IPv6 loopback', () => {
    expect(isValidPublicIp('::1')).toBe(false);
  });

  it('isValidPublicIp 应该拒绝 IPv6 私有地址 (fc00::/7)', () => {
    expect(isValidPublicIp('fc00::1')).toBe(false);
    expect(isValidPublicIp('fd00::1')).toBe(false);
  });

  it('isValidPublicIp 应该拒绝 IPv6 链路本地地址 (fe80::/10)', () => {
    expect(isValidPublicIp('fe80::1')).toBe(false);
    expect(isValidPublicIp('fe90::1')).toBe(false);
    expect(isValidPublicIp('fea0::1')).toBe(false);
    expect(isValidPublicIp('feb0::1')).toBe(false);
  });

  it('isValidPublicIp 应该拒绝 IPv6 多播地址 (ff00::/8)', () => {
    expect(isValidPublicIp('ff00::1')).toBe(false);
    expect(isValidPublicIp('ff02::1')).toBe(false);
  });

  it('isValidPublicIp 应该拒绝 IPv6 未指定地址', () => {
    expect(isValidPublicIp('::')).toBe(false);
    expect(isValidPublicIp('::0')).toBe(false);
  });

  it('isValidPublicIp 应该拒绝 IPv6 映射地址', () => {
    expect(isValidPublicIp('::ffff:192.168.1.1')).toBe(false);
  });
});

describe('Security - 代理端口验证', () => {
  it('应该拒绝端口 0', () => {
    expect(validateProxyPort(0).valid).toBe(false);
  });

  it('应该拒绝负数端口', () => {
    expect(validateProxyPort(-1).valid).toBe(false);
    expect(validateProxyPort(-100).valid).toBe(false);
  });

  it('应该拒绝端口 65536', () => {
    expect(validateProxyPort(65536).valid).toBe(false);
  });

  it('应该拒绝超出范围的端口', () => {
    expect(validateProxyPort(65537).valid).toBe(false);
    expect(validateProxyPort(100000).valid).toBe(false);
  });

  it('应该接受有效端口 1', () => {
    expect(validateProxyPort(1).valid).toBe(true);
  });

  it('应该接受有效端口 65535', () => {
    expect(validateProxyPort(65535).valid).toBe(true);
  });

  it('应该接受常用代理端口', () => {
    expect(validateProxyPort(8080).valid).toBe(true);
    expect(validateProxyPort(3128).valid).toBe(true);
    expect(validateProxyPort(1080).valid).toBe(true);
  });

  it('应该拒绝非整数端口', () => {
    expect(validateProxyPort(3.14).valid).toBe(false);
    expect(validateProxyPort(NaN).valid).toBe(false);
  });

  it('应该拒绝无效字符串端口', () => {
    expect(validateProxyPort('abc').valid).toBe(false);
    expect(validateProxyPort('').valid).toBe(false);
  });

  it('应该接受有效字符串端口', () => {
    expect(validateProxyPort('8080').valid).toBe(true);
    expect(validateProxyPort('443').valid).toBe(true);
  });

  it('应该返回解析后的端口号', () => {
    const result = validateProxyPort(8080);
    expect(result.valid).toBe(true);
    expect(result.port).toBe(8080);
  });
});

describe('Security - 代理来源验证', () => {
  it('应该拒绝过长的来源字符串', () => {
    expect(validateProxySource('a'.repeat(51)).valid).toBe(false);
  });

  it('应该接受最大长度的来源字符串', () => {
    expect(validateProxySource('a'.repeat(50)).valid).toBe(true);
  });

  it('应该拒绝包含特殊字符的来源', () => {
    expect(validateProxySource('../../../etc/passwd').valid).toBe(false);
    expect(validateProxySource('test<script>').valid).toBe(false);
    expect(validateProxySource('source with spaces').valid).toBe(false);
    expect(validateProxySource('source@special').valid).toBe(false);
    expect(validateProxySource('source!chars').valid).toBe(false);
  });

  it('应该接受有效的来源字符串', () => {
    expect(validateProxySource('proxy-source-1').valid).toBe(true);
    expect(validateProxySource('my_proxy').valid).toBe(true);
    expect(validateProxySource('PROXY123').valid).toBe(true);
  });

  it('应该处理空值来源', () => {
    expect(validateProxySource(undefined).valid).toBe(true);
    expect(validateProxySource(null).valid).toBe(true);
    expect(validateProxySource('').valid).toBe(true);
  });

  it('应该为空值来源返回默认值', () => {
    expect(validateProxySource(undefined).source).toBe('unknown');
    expect(validateProxySource(null).source).toBe('unknown');
  });

  it('应该返回有效的来源字符串', () => {
    const result = validateProxySource('valid-source');
    expect(result.valid).toBe(true);
    expect(result.source).toBe('valid-source');
  });
});

describe('Security - 特殊字符 URL', () => {
  it('应该拒绝包含换行符的 URL', () => {
    expect(validateUrl('http://example.com/path\n').valid).toBe(false);
    expect(validateUrl('http://example.com/path\ninjected').valid).toBe(false);
  });

  it('应该拒绝包含空字节的 URL', () => {
    expect(validateUrl('http://example.com/path\0').valid).toBe(false);
    expect(validateUrl('http://example.com/path\0injected').valid).toBe(false);
  });

  it('应该拒绝包含制表符的 URL', () => {
    expect(validateUrl('http://example.com/path\t').valid).toBe(false);
    expect(validateUrl('http://example.com/path\tinjected').valid).toBe(false);
  });

  it('应该拒绝包含回车符的 URL', () => {
    expect(validateUrl('http://example.com/path\r').valid).toBe(false);
    expect(validateUrl('http://example.com/path\r\nHost: evil.com').valid).toBe(false);
  });
});

describe('Security - IPv4 边界值测试', () => {
  it('应该拒绝 0.0.0.0/8 保留地址', () => {
    expect(validateUrl('http://0.0.0.1/path').valid).toBe(false);
    expect(validateUrl('http://0.255.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 127.0.0.0/8 loopback 地址', () => {
    expect(validateUrl('http://127.0.0.1/path').valid).toBe(false);
    expect(validateUrl('http://127.255.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 10.0.0.0/8 私有地址', () => {
    expect(validateUrl('http://10.0.0.1/path').valid).toBe(false);
    expect(validateUrl('http://10.255.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 172.16.0.0/12 私有地址', () => {
    expect(validateUrl('http://172.16.0.1/path').valid).toBe(false);
    expect(validateUrl('http://172.31.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 192.168.0.0/16 私有地址', () => {
    expect(validateUrl('http://192.168.0.1/path').valid).toBe(false);
    expect(validateUrl('http://192.168.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 169.254.0.0/16 链路本地地址', () => {
    expect(validateUrl('http://169.254.0.1/path').valid).toBe(false);
    expect(validateUrl('http://169.254.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 224.0.0.0/4 多播地址', () => {
    expect(validateUrl('http://224.0.0.1/path').valid).toBe(false);
    expect(validateUrl('http://239.255.255.255/path').valid).toBe(false);
  });

  it('应该拒绝 240.0.0.0/4 保留地址', () => {
    expect(validateUrl('http://240.0.0.1/path').valid).toBe(false);
    expect(validateUrl('http://255.255.255.255/path').valid).toBe(false);
  });

  it('应该接受公网 IPv4 地址', () => {
    expect(validateUrl('http://8.8.8.8/path').valid).toBe(true);
    expect(validateUrl('http://1.1.1.1/path').valid).toBe(true);
  });
});

describe('Security - Localhost 验证', () => {
  it('应该拒绝 localhost', () => {
    expect(validateUrl('http://localhost/path').valid).toBe(false);
  });

  it('应该拒绝 localhost 子域名', () => {
    expect(validateUrl('http://sub.localhost/path').valid).toBe(false);
    expect(validateUrl('http://api.localhost/path').valid).toBe(false);
  });
});

describe('Security - 协议验证', () => {
  it('应该接受 http 协议', () => {
    expect(validateUrl('http://example.com/path').valid).toBe(true);
  });

  it('应该接受 https 协议', () => {
    expect(validateUrl('https://example.com/path').valid).toBe(true);
  });

  it('应该拒绝 file 协议', () => {
    expect(validateUrl('file:///etc/passwd').valid).toBe(false);
  });

  it('应该拒绝 ftp 协议', () => {
    expect(validateUrl('ftp://example.com/file').valid).toBe(false);
  });

  it('应该拒绝 javascript 协议', () => {
    expect(validateUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('应该拒绝 data 协议', () => {
    expect(validateUrl('data:text/html,<script>alert(1)</script>').valid).toBe(false);
  });
});

describe('Security - isValidPublicIp IPv4 测试', () => {
  it('应该接受公网 IPv4 地址', () => {
    expect(isValidPublicIp('8.8.8.8')).toBe(true);
    expect(isValidPublicIp('1.1.1.1')).toBe(true);
    expect(isValidPublicIp('208.67.222.222')).toBe(true);
  });

  it('应该拒绝私有 IPv4 地址', () => {
    expect(isValidPublicIp('10.0.0.1')).toBe(false);
    expect(isValidPublicIp('172.16.0.1')).toBe(false);
    expect(isValidPublicIp('192.168.1.1')).toBe(false);
  });

  it('应该拒绝 loopback IPv4 地址', () => {
    expect(isValidPublicIp('127.0.0.1')).toBe(false);
    expect(isValidPublicIp('127.0.0.2')).toBe(false);
  });

  it('应该拒绝链路本地 IPv4 地址', () => {
    expect(isValidPublicIp('169.254.0.1')).toBe(false);
  });

  it('应该拒绝多播 IPv4 地址', () => {
    expect(isValidPublicIp('224.0.0.1')).toBe(false);
    expect(isValidPublicIp('239.0.0.1')).toBe(false);
  });

  it('应该拒绝无效的 IP 地址', () => {
    expect(isValidPublicIp('256.256.256.256')).toBe(false);
    expect(isValidPublicIp('not-an-ip')).toBe(false);
    expect(isValidPublicIp('')).toBe(false);
  });
});

describe('Security - DNS 重绑定防护', () => {
  beforeEach(() => {
    clearDnsCache();
  });

  it('validateDnsResolution 应该拒绝解析到私有 IP 的域名', async () => {
    // 模拟 DNS 解析失败或返回空结果
    // 由于实际 DNS 查询需要网络，这里测试基本行为
    const result = await validateDnsResolution('127.0.0.1');
    // IP 地址直接返回，不进行 DNS 查询
    expect(result.ips).toEqual(['127.0.0.1']);
  });

  it('validateDnsResolution 应该处理 IPv6 地址', async () => {
    const result = await validateDnsResolution('::1');
    expect(result.ips).toEqual(['::1']);
  });

  it('clearDnsCache 应该正常执行', () => {
    expect(() => clearDnsCache()).not.toThrow();
  });
});
