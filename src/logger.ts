/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Logger - 统一日志模块
 * 提供结构化日志输出，支持不同日志级别
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  [key: string]: unknown;
}

/**
 * 检查是否启用详细日志
 */
function isVerboseLogging(): boolean {
  return process.env.NODE_ENV !== 'production' || 
         process.env.ENABLE_VERBOSE_LOGGING === 'true';
}

/**
 * 格式化日志条目
 */
function formatEntry(entry: LogEntry): string {
  const { timestamp, level, module, message, ...rest } = entry;
  const extra = Object.keys(rest).length > 0 ? rest : undefined;
  
  // 生产环境使用 JSON 格式，开发环境使用可读格式
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify({ timestamp, level, module, message, ...extra });
  }
  
  // 开发环境：简洁可读格式
  const levelStr = level.toUpperCase().padEnd(5);
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  return `[${timestamp}] ${levelStr} [${module}] ${message}${extraStr}`;
}

/**
 * 创建日志器
 */
export function createLogger(module: string) {
  return {
    debug(message: string, data?: Record<string, unknown>): void {
      if (!isVerboseLogging()) return;
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'debug',
        module,
        message,
        ...data,
      };
      console.log(formatEntry(entry));
    },

    info(message: string, data?: Record<string, unknown>): void {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        module,
        message,
        ...data,
      };
      console.log(formatEntry(entry));
    },

    warn(message: string, data?: Record<string, unknown>): void {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'warn',
        module,
        message,
        ...data,
      };
      console.warn(formatEntry(entry));
    },

    error(message: string, data?: Record<string, unknown>): void {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        module,
        message,
        ...data,
      };
      console.error(formatEntry(entry));
    },

    /**
     * 仅在详细日志模式下输出
     */
    verbose(message: string, data?: Record<string, unknown>): void {
      if (!isVerboseLogging()) return;
      this.debug(message, data);
    },
  };
}

// 预创建常用模块的日志器
export const logger = {
  main: createLogger('Main'),
  cache: createLogger('Cache'),
  config: createLogger('Config'),
  cron: createLogger('Cron'),
  database: createLogger('Database'),
  kv: createLogger('KV'),
  proxyManager: createLogger('ProxyManager'),
  proxyFetcher: createLogger('ProxyFetcher'),
  proxyTester: createLogger('ProxyTester'),
  requestHandler: createLogger('RequestHandler'),
  rateLimit: createLogger('RateLimit'),
  security: createLogger('Security'),
  middleware: createLogger('Middleware'),
  cleanup: createLogger('Cleanup'),
  migration: createLogger('Migration'),
};
