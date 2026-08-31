/**
 * Consistent API envelopes.
 *
 * Success:    { success: true, data, meta? }
 * Paginated:  { success: true, data: [...], pagination: {...} }
 * Error:      { success: false, error: { code, message, details? } }
 *
 * Every controller uses these helpers so clients can rely on one shape.
 */
import type { Response } from 'express';
import type { PaginationMeta } from '../types';

export function sendOk<T>(res: Response, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data });
}

export function sendCreated<T>(res: Response, data: T): Response {
  return sendOk(res, data, 201);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

export function sendPaginated<T>(res: Response, rows: T[], pagination: PaginationMeta): Response {
  return res.status(200).json({ success: true, data: rows, pagination });
}

export function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Async route wrapper: forwards rejected promises to the central error handler. */
import type { NextFunction, Request, RequestHandler } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
