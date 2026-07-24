/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 加密工具模块测试
 */

import { describe, it, expect } from 'vitest';
import {
  timingSafeEqualString,
  generateSecureRandomString,
  generateRequestId,
  simpleHash,
  __resetCryptoCacheForTesting,
} from '../../src/utils/crypto.js';

describe('Crypto Utils', () => {
  describe('timingSafeEqualString', () => {
    it('应该对相等的字符串返回 true', () => {
      expect(timingSafeEqualString('hello', 'hello')).toBe(true);
      expect(timingSafeEqualString('', '')).toBe(true);
      expect(timingSafeEqualString('test123', 'test123')).toBe(true);
    });

    it('应该对不相等的字符串返回 false', () => {
      expect(timingSafeEqualString('hello', 'world')).toBe(false);
      expect(timingSafeEqualString('hello', 'Hello')).toBe(false);
      expect(timingSafeEqualString('test', 'test1')).toBe(false);
    });

    it('应该对不同长度的字符串返回 false', () => {
      expect(timingSafeEqualString('short', 'longer')).toBe(false);
      expect(timingSafeEqualString('a', 'ab')).toBe(false);
      expect(timingSafeEqualString('', 'a')).toBe(false);
    });
  });

  describe('generateSecureRandomString', () => {
    it('应该生成指定长度的字符串', () => {
      const result = generateSecureRandomString(16);
      expect(result.length).toBe(16);
    });

    it('应该生成不同的字符串', () => {
      const result1 = generateSecureRandomString(16);
      const result2 = generateSecureRandomString(16);
      expect(result1).not.toBe(result2);
    });

    it('应该使用默认长度', () => {
      const result = generateSecureRandomString();
      expect(result.length).toBe(16);
    });

    it('应该只包含字母和数字', () => {
      const result = generateSecureRandomString(100);
      expect(result).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  describe('generateRequestId', () => {
    it('应该生成正确格式的请求 ID', () => {
      const result = generateRequestId();
      expect(result).toMatch(/^req_[a-z0-9]+_[A-Za-z0-9]+$/);
    });

    it('应该生成唯一的请求 ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('simpleHash', () => {
    it('应该对相同输入产生相同输出', async () => {
      const result1 = await simpleHash('test');
      const result2 = await simpleHash('test');
      expect(result1).toBe(result2);
    });

    it('应该对不同输入产生不同输出', async () => {
      const result1 = await simpleHash('test1');
      const result2 = await simpleHash('test2');
      expect(result1).not.toBe(result2);
    });

    it('应该返回十六进制字符串', async () => {
      const result = await simpleHash('test');
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('应该处理空字符串', async () => {
      const result = await simpleHash('');
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('SHA-256 应返回 64 字符长度（Node.js 路径严格断言）', async () => {
      const result = await simpleHash('test-input-for-hash');
      // SHA-256 输出 64 位十六进制字符
      // djb2 fallback 已移除（安全 L2：fail-closed），不再可能返回 8 字符
      expect(result.length).toBe(64);
    });

    it('不同输入应产生不同 SHA-256 哈希（无碰撞）', async () => {
      const result1 = await simpleHash('input-a');
      const result2 = await simpleHash('input-b');
      expect(result1).not.toBe(result2);
    });

    it('长字符串应正确哈希', async () => {
      const longStr = 'x'.repeat(10000);
      const result = await simpleHash(longStr);
      expect(result).toMatch(/^[0-9a-f]+$/);
      expect(result.length).toBe(64); // SHA-256 固定 64 字符
    });
  });

  describe('simpleHash - Edge Runtime 路径', () => {
    it('process.versions.node 不存在时应走 Web Crypto API 路径', async () => {
      // 临时屏蔽 process.versions.node 模拟 Edge Runtime
      const originalVersions = process.versions;
      Object.defineProperty(process, 'versions', {
        value: {},
        configurable: true,
      });

      try {
        // 重置模块级缓存，让环境检测重新生效
        __resetCryptoCacheForTesting();
        const result = await simpleHash('edge-test');
        expect(result).toMatch(/^[0-9a-f]+$/);
        expect(result.length).toBe(64); // SHA-256
      } finally {
        Object.defineProperty(process, 'versions', {
          value: originalVersions,
          configurable: true,
        });
        // 恢复后再次重置，让后续测试使用真实环境
        __resetCryptoCacheForTesting();
      }
    });
  });

  describe('simpleHash - fail-closed 行为', () => {
    // 当既无 node:crypto 也无 Web Crypto API 时应抛错（安全 L2）
    it('node:crypto 和 crypto.subtle 都不可用时应抛错', async () => {
      const originalVersions = process.versions;
      const originalCrypto = globalThis.crypto;

      Object.defineProperty(process, 'versions', {
        value: {},
        configurable: true,
      });
      // 屏蔽 crypto.subtle
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: originalCrypto.getRandomValues },
        configurable: true,
      });

      try {
        __resetCryptoCacheForTesting();
        await expect(simpleHash('no-crypto')).rejects.toThrow(
          /No secure hash implementation available/,
        );
      } finally {
        Object.defineProperty(process, 'versions', {
          value: originalVersions,
          configurable: true,
        });
        Object.defineProperty(globalThis, 'crypto', {
          value: originalCrypto,
          configurable: true,
        });
        // 恢复后再次重置，让后续测试使用真实环境
        __resetCryptoCacheForTesting();
      }
    });
  });
});
