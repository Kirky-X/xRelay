/**
 * 统一错误处理器
 */

import { AppError, ErrorCode } from "../errors/index.js";
import { logger } from "../logger.js";

export interface ErrorContext {
  module?: string;
  requestId?: string;
  path?: string;
  method?: string;
  [key: string]: unknown;
}

export class ErrorHandler {
  constructor(private loggerInstance: typeof logger) {}

  handle(error: unknown, context: ErrorContext): AppError {
    if (error instanceof AppError) {
      this.loggerInstance.error(error.message, error, context);
      return error;
    }

    const appError = this.wrapError(error);
    this.loggerInstance.error(appError.message, error instanceof Error ? error : undefined, context);
    return appError;
  }

  private wrapError(error: unknown): AppError {
    if (error instanceof Error) {
      return new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Internal server error",
        500,
        {
          originalMessage: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        }
      );
    }

    return new AppError(ErrorCode.INTERNAL_ERROR, "Internal server error", 500);
  }
}

export const errorHandler = new ErrorHandler(logger);
