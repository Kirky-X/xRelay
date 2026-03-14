/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * 依赖注入容器
 * 提供服务注册、解析和生命周期管理
 */

export type ServiceFactory<T> = (container: ServiceContainer) => T;
export type ServiceLifetime = 'singleton' | 'transient' | 'scoped';

interface ServiceDescriptor<T = unknown> {
  factory: ServiceFactory<T>;
  lifetime: ServiceLifetime;
  instance?: T;
}

/**
 * 服务容器
 * 实现简单的依赖注入模式
 */
export class ServiceContainer {
  private services = new Map<string, ServiceDescriptor>();
  private resolving = new Set<string>();

  /**
   * 注册单例服务
   * 整个应用生命周期内只创建一个实例
   */
  registerSingleton<T>(name: string, factory: ServiceFactory<T>): this {
    this.services.set(name, {
      factory,
      lifetime: 'singleton',
    });
    return this;
  }

  /**
   * 注册瞬态服务
   * 每次解析都创建新实例
   */
  registerTransient<T>(name: string, factory: ServiceFactory<T>): this {
    this.services.set(name, {
      factory,
      lifetime: 'transient',
    });
    return this;
  }

  /**
   * 注册作用域服务
   * 在同一作用域内返回相同实例
   */
  registerScoped<T>(name: string, factory: ServiceFactory<T>): this {
    this.services.set(name, {
      factory,
      lifetime: 'scoped',
    });
    return this;
  }

  /**
   * 注册实例
   * 直接使用已有实例
   */
  registerInstance<T>(name: string, instance: T): this {
    this.services.set(name, {
      factory: () => instance,
      lifetime: 'singleton',
      instance,
    });
    return this;
  }

  /**
   * 解析服务
   */
  resolve<T>(name: string): T {
    const descriptor = this.services.get(name);
    
    if (!descriptor) {
      throw new Error(`Service '${name}' is not registered`);
    }

    // 检测循环依赖
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected while resolving '${name}'`);
    }

    // 单例模式：返回已有实例
    if (descriptor.lifetime === 'singleton' && descriptor.instance !== undefined) {
      return descriptor.instance as T;
    }

    // 创建新实例
    this.resolving.add(name);
    try {
      const instance = descriptor.factory(this) as T;
      
      // 单例模式：缓存实例
      if (descriptor.lifetime === 'singleton') {
        descriptor.instance = instance;
      }
      
      return instance;
    } finally {
      this.resolving.delete(name);
    }
  }

  /**
   * 尝试解析服务
   */
  tryResolve<T>(name: string): T | undefined {
    if (!this.services.has(name)) {
      return undefined;
    }
    return this.resolve<T>(name);
  }

  /**
   * 检查服务是否已注册
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * 获取所有已注册的服务名称
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * 清除所有单例实例（用于测试）
   */
  clearInstances(): void {
    for (const descriptor of this.services.values()) {
      descriptor.instance = undefined;
    }
  }

  /**
   * 创建子容器
   */
  createScope(): ScopedContainer {
    return new ScopedContainer(this);
  }
}

/**
 * 作用域容器
 * 继承父容器的服务，但有自己的作用域实例
 */
export class ScopedContainer extends ServiceContainer {
  private parentServices: Map<string, ServiceDescriptor>;

  constructor(private parent: ServiceContainer) {
    super();
    // 获取父容器的服务引用
    this.parentServices = (parent as unknown as { services: Map<string, ServiceDescriptor> }).services;
  }

  resolve<T>(name: string): T {
    // 先尝试从父容器解析单例
    if (this.parentServices.has(name)) {
      const descriptor = this.parentServices.get(name);
      if (descriptor?.lifetime === 'singleton') {
        return this.parent.resolve<T>(name);
      }
    }
    return super.resolve<T>(name);
  }
}

/**
 * 全局服务容器实例
 */
export const globalContainer = new ServiceContainer();

/**
 * 服务名称常量
 */
export const ServiceNames = {
  PROXY_SERVICE: 'ProxyService',
  PROXY_MANAGER: 'ProxyManager',
  CACHE_SERVICE: 'CacheService',
  RATE_LIMITER: 'RateLimiter',
  LOGGER: 'Logger',
  DATABASE_CONNECTION: 'DatabaseConnection',
} as const;
