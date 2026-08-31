/**
 * Request correlation id + structured HTTP access logging.
 *
 * Every request gets an id, echoed in the X-Request-Id response header and
 * included in error payloads, so a user-reported failure can be traced to the
 * exact log line. Health checks are not logged (noise).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../utils/logger';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  // Accept a caller-supplied id only if it looks sane, to keep logs clean.
  const id = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export const httpLogger: RequestHandler = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId ?? crypto.randomUUID(),
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url === '/api/health/ready',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  // Only non-sensitive fields are serialised; cookies/authorization are also
  // covered by the redaction list in utils/logger.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
