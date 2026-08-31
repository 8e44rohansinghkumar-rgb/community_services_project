/**
 * Authentication and role authorization middleware.
 *
 * requireAuth      — verifies the access cookie and attaches req.user
 * requireRole(...) — coarse route-level RBAC (the FIRST gate, never the only one)
 * optionalAuth     — attaches req.user when present, but never rejects
 *
 * Object-level authorization (can THIS user touch THIS row) lives in the
 * services, because only they know the resource.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ACCESS_COOKIE, verifyAccessToken } from '../modules/auth/token.service';
import { AuthenticationError, AuthorizationError } from '../utils/errors';
import type { AuthUser, UserRole } from '../types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

function readAccessToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  // Bearer is accepted for API clients and tests, but the browser SPA always
  // uses the HttpOnly cookie — tokens are never placed in localStorage.
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  return null;
}

export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = readAccessToken(req);
  if (!token) {
    next(new AuthenticationError('You must be signed in to do that'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      tokenVersion: payload.tv,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = readAccessToken(req);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      tokenVersion: payload.tv,
    };
  } catch {
    // An expired token on a public endpoint simply means "anonymous".
  }
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new AuthenticationError('You must be signed in to do that'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AuthorizationError('Your account does not have access to this resource'));
      return;
    }
    next();
  };
}

/** Convenience guard used by controllers after requireAuth. */
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) throw new AuthenticationError('You must be signed in to do that');
  return req.user;
}
