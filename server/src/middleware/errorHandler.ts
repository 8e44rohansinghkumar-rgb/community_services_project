/**
 * Centralised error handling.
 *
 * Rule: only AppError instances have client-safe messages. Everything else is
 * logged in full server-side and returned as a generic 500, so stack traces,
 * SQL text, driver messages and file paths never reach the client.
 */
import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, PayloadTooLargeError, ValidationError } from '../utils/errors';
import { PG_ERROR, isPgError } from '../db/pool';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

function normalise(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new ValidationError(
      'The submitted data is invalid',
      error.issues.map((i) => ({ field: i.path.join('.') || undefined, message: i.message })),
    );
  }

  // Multer upload failures -> precise, safe messages.
  if (error instanceof MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new PayloadTooLargeError(
          `Each image must be ${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))} MB or smaller`,
        );
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new ValidationError(`You can upload at most ${config.MAX_FILES_PER_ISSUE} images per issue`);
      default:
        return new ValidationError('The uploaded file could not be processed');
    }
  }

  // Body-parser: malformed JSON and oversized payloads.
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { type?: string; status?: number; statusCode?: number; message?: string };
    if (candidate.type === 'entity.parse.failed') {
      return new ValidationError('Request body is not valid JSON');
    }
    if (candidate.type === 'entity.too.large') {
      return new PayloadTooLargeError();
    }
  }

  // Postgres errors are translated to safe domain errors. The raw driver message
  // (which can contain column values) is never forwarded.
  if (isPgError(error, PG_ERROR.INVALID_TEXT_REPRESENTATION)) {
    return new ValidationError('A supplied identifier or value has an invalid format');
  }
  if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
    return new AppError(409, 'CONFLICT', 'That record already exists');
  }
  if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
    return new ValidationError('A referenced record does not exist');
  }
  if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
    return new ValidationError('A submitted value is outside the permitted range');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = normalise(err);

  const logPayload = {
    err,
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
    userId: req.user?.id,
  };

  if (appError.statusCode >= 500) {
    logger.error(logPayload, 'Unhandled request error');
  } else {
    logger.warn(logPayload, 'Request rejected');
  }

  if (res.headersSent) return;

  const body: Record<string, unknown> = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      ...(req.requestId ? { requestId: req.requestId } : {}),
    },
  };

  // Stack traces are exposed in development only, and never in production.
  if (!config.isProduction && appError.statusCode >= 500 && err instanceof Error) {
    (body.error as Record<string, unknown>).debug = { name: err.name, message: err.message, stack: err.stack };
  }

  res.status(appError.statusCode).json(body);
}
