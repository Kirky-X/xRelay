/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 依赖注入容器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceContainer, ScopedContainer } from '../../src/core/container.js';

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('registerSingleton', () => {
    it('应该注册单例服务', () => {
      container.registerSingleton('test', () => ({ value: 1 }));
      expect(container.has('test')).toBe(true);
    });

    it('应该返回相同实例', () => {
      let callCount = 0;
      container.registerSingleton('test', () => {
        callCount++;
        return { value: callCount };
      });

      const instance1 = container.resolve<{ value: number }>('test');
      const instance2 = container.resolve<{ value: number }>('test');

      expect(instance1).toBe(instance2);
      expect(callCount).toBe(1);
    });
  });

  describe('registerTransient', () => {
    it('应该每次返回新实例', () => {
      let callCount = 0;
      container.registerTransient('test', () => {
        callCount++;
        return { value: callCount };
      });

      const instance1 = container.resolve<{ value: number }>('test');
      const instance2 = container.resolve<{ value: number }>('test');

      expect(instance1).not.toBe(instance2);
      expect(instance1.value).toBe(1);
      expect(instance2.value).toBe(2);
    });
  });

  describe('registerInstance', () => {
    it('应该注册并返回实例', () => {
      const instance = { value: 'test' };
      container.registerInstance('test', instance);

      const resolved = container.resolve<{ value: string }>('test');
      expect(resolved).toBe(instance);
    });
  });

  describe('resolve', () => {
    it('应该解析已注册的服务', () => {
      container.registerSingleton('test', () => 'hello');
      expect(container.resolve<string>('test')).toBe('hello');
    });

    it('应该对未注册服务抛出错误', () => {
      expect(() => container.resolve('unknown')).toThrow("Service 'unknown' is not registered");
    });

    it('应该检测循环依赖', () => {
      container.registerSingleton('a', (c) => ({ b: c.resolve('b') }));
      container.registerSingleton('b', (c) => ({ a: c.resolve('a') }));

      expect(() => container.resolve('a')).toThrow('Circular dependency detected');
    });

    it('应该支持依赖注入', () => {
      container.registerSingleton('db', () => ({ connected: true }));
      container.registerSingleton('service', (c) => ({
        db: c.resolve<{ connected: boolean }>('db'),
      }));

      const service = container.resolve<{ db: { connected: boolean } }>('service');
      expect(service.db.connected).toBe(true);
    });
  });

  describe('tryResolve', () => {
    it('应该返回已注册的服务', () => {
      container.registerSingleton('test', () => 'hello');
      expect(container.tryResolve<string>('test')).toBe('hello');
    });

    it('应该对未注册服务返回 undefined', () => {
      expect(container.tryResolve('unknown')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('应该正确检测服务是否存在', () => {
      expect(container.has('test')).toBe(false);
      container.registerSingleton('test', () => ({}));
      expect(container.has('test')).toBe(true);
    });
  });

  describe('getServiceNames', () => {
    it('应该返回所有已注册的服务名称', () => {
      container.registerSingleton('a', () => ({}));
      container.registerSingleton('b', () => ({}));
      expect(container.getServiceNames()).toEqual(expect.arrayContaining(['a', 'b']));
    });
  });

  describe('clearInstances', () => {
    it('应该清除所有单例实例', () => {
      let callCount = 0;
      container.registerSingleton('test', () => {
        callCount++;
        return { count: callCount };
      });

      container.resolve('test');
      container.clearInstances();
      container.resolve('test');

      expect(callCount).toBe(2);
    });
  });

  describe('createScope', () => {
    it('应该创建子容器', () => {
      const scope = container.createScope();
      expect(scope).toBeInstanceOf(ScopedContainer);
    });
  });
});

describe('ScopedContainer', () => {
  let parent: ServiceContainer;
  let scope: ScopedContainer;

  beforeEach(() => {
    parent = new ServiceContainer();
    scope = parent.createScope();
  });

  it('应该继承父容器的单例服务', () => {
    parent.registerSingleton('singleton', () => ({ value: 1 }));
    expect(scope.resolve<{ value: number }>('singleton').value).toBe(1);
  });

  it('应该有自己的作用域服务', () => {
    scope.registerScoped('scoped', () => ({ value: Date.now() }));
    expect(scope.has('scoped')).toBe(true);
  });
});
