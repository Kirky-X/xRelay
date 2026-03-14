/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

import { AppError, ErrorCode } from '../errors/index.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableStatusCodes: number[];
  jitter: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  jitter: true,
};

export class RetryStrategy {
  constructor(private config: RetryConfig = DEFAULT_CONFIG) {}

  shouldRetry(statusCode: number, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) return false;
    return this.config.retryableStatusCodes.includes(statusCode);
  }

  calculateDelay(attempt: number): number {
    const exponentialDelay = this.config.baseDelay * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);
    
    if (this.config.jitter) {
      const jitter = cappedDelay * 0.25 * Math.random();
      return cappedDelay + jitter;
    }
    
    return cappedDelay;
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    shouldRetry: (error: Error, attempt: number) => boolean
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.maxRetries && shouldRetry(lastError, attempt)) {
          const delay = this.calculateDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
}
