/**
 * 缓存提供者接口
 * 定义统一的缓存接口，支持多种实现（KV、内存等）
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  ttlMs: number;
  hitRate: number;
}

export interface CacheProvider<T = unknown> {
  /**
   * 获取缓存值
   */
  get(key: string): Promise<T | null>;

  /**
   * 设置缓存值
   */
  set(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * 删除缓存值
   */
  delete(key: string): Promise<void>;

  /**
   * 清空缓存
   */
  clear(): Promise<void>;

  /**
   * 获取缓存统计信息
   */
  getStats(): Promise<CacheStats>;

  /**
   * 检查键是否存在
   */
  has(key: string): Promise<boolean>;
}
