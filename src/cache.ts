/**
 * Cache - 缓存模块（向后兼容层）
 * 此文件重新导出新的模块化实现，保持向后兼容性
 */

export {
  getCache,
  resetCacheInstance,
} from './infrastructure/cache/factory.js';

export type { CacheProvider, CacheEntry, CacheStats } from './infrastructure/cache/types.js';
