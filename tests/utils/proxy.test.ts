/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 代理工具模块测试
 */

import { describe, it, expect } from 'vitest';
import {
  proxyKey,
  parseProxyKey,
  maskProxy,
  isSameProxy,
  proxyToString,
  parseProxyString,
} from '../../src/utils/proxy.js';

describe('Proxy Utils', () => {
  describe('proxyKey', () => {
    it('应该生成正确的代理键', () => {
      expect(proxyKey({ ip: '1.2.3.4', port: '8080' })).toBe('1.2.3.4:8080');
      expect(proxyKey({ ip: '192.168.1.1', port: 80 })).toBe('192.168.1.1:80');
    });
  });

  describe('parseProxyKey', () => {
    it('应该正确解析代理键', () => {
      const result = parseProxyKey('1.2.3.4:8080');
      expect(result).toEqual({ ip: '1.2.3.4', port: 8080 });
    });

    it('应该对无效格式返回 null', () => {
      expect(parseProxyKey('invalid')).toBeNull();
      expect(parseProxyKey('1.2.3.4:abc')).toBeNull();
      expect(parseProxyKey('')).toBeNull();
    });
  });

  describe('maskProxy', () => {
    it('应该遮蔽 IPv4 地址的最后一段', () => {
      const result = maskProxy({ ip: '1.2.3.4', port: '8080' });
      expect(result).toBe('1.2.3.***:8080');
    });

    it('应该正确处理数字端口', () => {
      const result = maskProxy({ ip: '192.168.1.100', port: 80 });
      expect(result).toBe('192.168.1.***:80');
    });

    it('应该遮蔽 IPv6 地址的一半', () => {
      const result = maskProxy({ ip: '2001:db8::1', port: '8080' });
      // halfLength = Math.floor('2001:db8::1'.length / 2) = 5
      // substring(0, 5) = '2001:'
      expect(result).toBe('2001:***:8080');
    });

    it('应该遮蔽非 IP 格式字符串的一半', () => {
      const result = maskProxy({ ip: 'some-hostname', port: 3128 });
      // halfLength = Math.floor('some-hostname'.length / 2) = 6
      expect(result).toBe('some-h***:3128');
    });
  });

  describe('isSameProxy', () => {
    it('应该对相同代理返回 true', () => {
      expect(isSameProxy({ ip: '1.2.3.4', port: '8080' }, { ip: '1.2.3.4', port: '8080' })).toBe(true);
      expect(isSameProxy({ ip: '1.2.3.4', port: 8080 }, { ip: '1.2.3.4', port: '8080' })).toBe(true);
    });

    it('应该对不同代理返回 false', () => {
      expect(isSameProxy({ ip: '1.2.3.4', port: '8080' }, { ip: '1.2.3.4', port: '8081' })).toBe(false);
      expect(isSameProxy({ ip: '1.2.3.4', port: '8080' }, { ip: '5.6.7.8', port: '8080' })).toBe(false);
    });
  });

  describe('proxyToString', () => {
    it('应该生成正确的代理字符串', () => {
      expect(proxyToString({ ip: '1.2.3.4', port: '8080' })).toBe('http://1.2.3.4:8080');
      expect(proxyToString({ ip: '192.168.1.1', port: 80 })).toBe('http://192.168.1.1:80');
    });
  });

  describe('parseProxyString', () => {
    it('应该解析 http 格式的代理字符串', () => {
      const result = parseProxyString('http://1.2.3.4:8080');
      expect(result).toEqual({
        ip: '1.2.3.4',
        port: '8080',
        source: 'parsed',
        timestamp: expect.any(Number),
      });
    });

    it('应该解析 ip:port 格式的字符串', () => {
      const result = parseProxyString('1.2.3.4:8080');
      expect(result).toEqual({
        ip: '1.2.3.4',
        port: '8080',
        source: 'parsed',
        timestamp: expect.any(Number),
      });
    });

    it('应该对无效格式返回 null', () => {
      expect(parseProxyString('invalid')).toBeNull();
      expect(parseProxyString('')).toBeNull();
    });

    it('应该解析 https 格式且无端口时使用默认 443', () => {
      const result = parseProxyString('https://1.2.3.4');
      expect(result).toEqual({
        ip: '1.2.3.4',
        port: '443',
        source: 'parsed',
        timestamp: expect.any(Number),
      });
    });

    it('应该解析 http 格式且无端口时使用默认 80', () => {
      const result = parseProxyString('http://1.2.3.4');
      expect(result).toEqual({
        ip: '1.2.3.4',
        port: '80',
        source: 'parsed',
        timestamp: expect.any(Number),
      });
    });

    it('应该对畸形 URL 返回 null（catch 分支）', () => {
      // new URL('http://[invalid') 会抛 TypeError → catch → null
      expect(parseProxyString('http://[invalid')).toBeNull();
    });
  });
});
