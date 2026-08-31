/**
 * CSRF protection — double-submit cookie + Origin validation.
 *
 * Because sessions ride on cookies, the browser attaches them to cross-site
 * requests automatically. Two independent checks are applied to every
 * state-changing request:
 *
 *   1. Origin/Referer must be absent (same-origin non-browser client) or present
 *      in the configured allowlist.
 *   2. The X-CSRF-Token header must equal the civic_csrf cookie, compared with
 *      timingSafeEqual. A cross-origin attacker cannot read the cookie, so they
 *      cannot forge the header — the same-origin policy is what makes this work.
 *
 * "CORS prevents CSRF" is false: CORS restricts reading a *response*; a simple
 * POST is still delivered. Hence this middleware.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config/env';
import { CSRF_COOKIE } from '../modules/auth/token.service';
import { AppError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';

export class CsrfError extends AppError {
  constructor(message = 'CSRF validation failed. Refresh the page and try again.') {
    super(403, 'CSRF_VALIDATION_FAILED', message);
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function originAllowed(rawOrigin: string): boolean {
  try {
    const url = new URL(rawOrigin);
    return config.CORS_ORIGIN.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        return allowedUrl.origin === url.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export const csrfProtection: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Layer 1 — Origin / Referer allowlist.
  const origin = req.get('origin');
  const referer = req.get('referer');
  const originToCheck = origin ?? referer;
  if (originToCheck && !originAllowed(originToCheck)) {
    next(new CsrfError('Request origin is not allowed'));
    return;
  }

  // Layer 2 — double-submit token.
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (typeof cookieToken !== 'string' || cookieToken.length === 0) {
    next(new CsrfError('Missing CSRF cookie. Please sign in again.'));
    return;
  }
  if (typeof headerToken !== 'string' || headerToken.length === 0) {
    next(new CsrfError('Missing CSRF token header'));
    return;
  }
  if (!safeEqual(cookieToken, headerToken)) {
    next(new CsrfError());
    return;
  }

  next();
};
