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
    it('应该对相同输入产生相同输出', () => {
      const result1 = simpleHash('test');
      const result2 = simpleHash('test');
      expect(result1).toBe(result2);
    });

    it('应该对不同输入产生不同输出', () => {
      const result1 = simpleHash('test1');
      const result2 = simpleHash('test2');
      expect(result1).not.toBe(result2);
    });

    it('应该返回十六进制字符串', () => {
      const result = simpleHash('test');
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('应该处理空字符串', () => {
      const result = simpleHash('');
      expect(result).toMatch(/^[0-9a-f]+$/);
    });
  });
});
