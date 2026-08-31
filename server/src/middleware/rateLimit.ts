/**
 * Endpoint-specific rate limiting.
 *
 * Deliberately NOT one global limit (spec §47): a strict limit that protects the
 * login endpoint would cripple normal browsing, and a limit loose enough for
 * browsing would not stop credential stuffing. Authenticated users are keyed by
 * user id so that several people behind one NAT/campus IP are not punished
 * collectively.
 */
import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config/env';

function keyByUserOrIp(req: Request): string {
  return req.user?.id ?? req.ip ?? 'unknown';
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Rate limiting is disabled under test so the suite is deterministic; the
  // limiter itself is covered by a dedicated test that re-enables it.
  skip: () => config.isTest,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
      },
    });
  },
};

/** Login: strict. Successful logins are not counted, so a legitimate user is never locked out by their own activity. */
export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/** Registration: moderate — blocks bulk account creation from one source. */
export const registerLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

/** Password reset requests: strict, to limit e-mail enumeration/abuse. */
export const passwordResetLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

/** Issue creation: moderate anti-spam ceiling per citizen. */
export const createIssueLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: keyByUserOrIp,
});

/** File uploads: bounded because each one costs CPU (re-encoding) and disk. */
export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: keyByUserOrIp,
});

/** Comments: prevents flooding an issue thread. */
export const commentLimiter = rateLimit({
  ...shared,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: keyByUserOrIp,
});

/** Authenticated general API traffic — generous, catches runaway clients. */
export const authenticatedLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: keyByUserOrIp,
});

/** Anonymous/public reads — higher ceiling, keyed by IP. */
export const publicLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 120,
});
