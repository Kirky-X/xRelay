/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration?: number;
}

class Logger {
  private service = 'xRelay';
  private version = '0.2.0';
  private environment = process.env.NODE_ENV || 'production';

  private format(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.DEBUG === 'true') {
      this.log('debug', message, context);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: 'error',
      message,
      context: {
        service: this.service,
        version: this.version,
        environment: this.environment,
        ...context,
      },
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    console.error(this.format(entry));
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level,
      message,
      context: {
        service: this.service,
        version: this.version,
        environment: this.environment,
        ...context,
      },
    };

    console.log(this.format(entry));
  }

  // Performance logging
  logPerformance(operation: string, duration: number, metadata?: Record<string, unknown>): void {
    this.info(`Performance: ${operation}`, {
      duration_ms: duration,
      ...metadata,
    });
  }

  // Request logging
  logRequest(requestId: string, method: string, url: string, statusCode: number, duration: number): void {
    this.info('Request completed', {
      requestId,
      method,
      url: this.sanitizeUrl(url),
      statusCode,
      duration_ms: duration,
    });
  }

  // Sanitize URL for logging (redact all query parameters by default)
  // 安全策略：默认遮蔽全部查询参数，避免 token/key/签名等敏感信息进入日志
  // 仅保留 host + pathname，query 以 [REDACTED] 占位
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.search) {
        return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}?[REDACTED]`;
      }
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return url;
    }
  }
}

export const logger = new Logger();
