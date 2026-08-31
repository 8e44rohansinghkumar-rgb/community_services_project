/**
 * Token and cookie mechanics.
 *
 * Access token  — JWT, short lived, HttpOnly cookie. Carries tokenVersion so a
 *                 password change / deactivation / logout-all invalidates it
 *                 without a database round-trip on every request.
 * Refresh token — 256 bits of CSPRNG randomness, stored ONLY as a SHA-256 hash.
 *                 Rotated on every use; replaying a consumed token revokes the
 *                 whole family (theft detection).
 * CSRF token    — random value in a readable cookie, echoed in a header by the
 *                 SPA (double-submit). See middleware/csrf.ts.
 */
import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { config } from '../../config/env';
import { AuthenticationError } from '../../utils/errors';
import type { UserRole } from '../../types';

export const ACCESS_COOKIE = 'civic_access';
export const REFRESH_COOKIE = 'civic_refresh';
export const CSRF_COOKIE = 'civic_csrf';

/** Refresh cookie is scoped to the auth routes so it is not sent on every call. */
const REFRESH_COOKIE_PATH = '/api/auth';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  tv: number; // token version
}

const accessTtlSeconds = config.ACCESS_TOKEN_TTL_MINUTES * 60;
const refreshTtlSeconds = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: accessTtlSeconds,
    issuer: 'civic-api',
    audience: 'civic-web',
    algorithm: 'HS256',
  };
  return jwt.sign(payload, config.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    // Algorithm is pinned: prevents the "alg: none" / algorithm-confusion class.
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'civic-api',
      audience: 'civic-web',
    });
    if (typeof decoded === 'string') throw new Error('Unexpected token payload');
    return decoded as AccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Your session has expired', 'TOKEN_EXPIRED');
    }
    throw new AuthenticationError('Invalid authentication token', 'INVALID_TOKEN');
  }
}

/** Opaque refresh token; only its hash is persisted. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Lax keeps top-level navigation working while blocking cross-site POSTs.
    sameSite: 'lax',
    // Secure requires HTTPS; enabling it in dev over http:// would drop cookies.
    secure: config.isProduction,
    path: '/',
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, csrfToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: accessTtlSeconds * 1000,
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTtlSeconds * 1000,
  });

  setCsrfCookie(res, csrfToken);
}

/**
 * Readable by JavaScript on purpose: the SPA must echo it in the X-CSRF-Token
 * header. It is not a credential on its own — an attacker on another origin can
 * neither read this cookie nor set the header (same-origin policy).
 */
export function setCsrfCookie(res: Response, csrfToken: string): void {
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: refreshTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const opts = baseCookieOptions();
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

export function refreshExpiryDate(): Date {
  return new Date(Date.now() + refreshTtlSeconds * 1000);
}
