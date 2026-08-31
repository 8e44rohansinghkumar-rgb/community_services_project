/**
 * Auth HTTP layer. Controllers stay thin: read validated input, call the
 * service, set/clear cookies, format the response.
 */
import type { Request, Response } from 'express';
import * as authService from './auth.service';
import * as userRepo from '../users/user.repository';
import { getAuthUser } from '../../middleware/auth';
import {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  setCsrfCookie,
  generateCsrfToken,
} from './token.service';
import { sendCreated, sendOk } from '../../utils/http';
import { ValidationError } from '../../utils/errors';

function requestMeta(req: Request): authService.RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

function applySession(res: Response, tokens: authService.AuthTokens): void {
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.csrfToken);
}

/**
 * CSRF bootstrap.
 *
 * The double-submit check applies to EVERY state-changing request, including
 * login — otherwise an attacker could force a victim's browser to sign in as
 * the attacker (login CSRF). A first-time visitor has no token yet, so the SPA
 * calls this safe GET at start-up to obtain one.
 */
export async function csrfBootstrap(req: Request, res: Response): Promise<void> {
  const existing = req.cookies?.[CSRF_COOKIE];
  // Reuse an existing token so opening a second tab does not invalidate the first.
  const token = typeof existing === 'string' && existing.length >= 20 ? existing : generateCsrfToken();
  setCsrfCookie(res, token);
  sendOk(res, { csrfToken: token });
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body, requestMeta(req));
  applySession(res, result.tokens);
  // csrfToken is returned so a fresh SPA can send the header immediately without
  // waiting for a cookie round-trip. It is not a credential by itself.
  sendCreated(res, { user: result.user, csrfToken: result.tokens.csrfToken });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body, requestMeta(req));
  applySession(res, result.tokens);
  sendOk(res, { user: result.user, csrfToken: result.tokens.csrfToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || !token) {
    clearAuthCookies(res);
    throw new ValidationError('No active session to refresh');
  }
  const result = await authService.refresh(token, requestMeta(req));
  applySession(res, result.tokens);
  sendOk(res, { user: result.user, csrfToken: result.tokens.csrfToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  sendOk(res, { message: 'Signed out successfully' });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const user = getAuthUser(req);
  await authService.logoutAllSessions(user.id);
  clearAuthCookies(res);
  sendOk(res, { message: 'Signed out of all devices' });
}

export async function me(req: Request, res: Response): Promise<void> {
  const auth = getAuthUser(req);
  // Re-reads from the database so deactivation/role changes take effect at once.
  const user = await authService.loadActiveUser(auth.id, auth.tokenVersion);
  sendOk(res, { user });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const auth = getAuthUser(req);
  // Only name/phone are accepted by the schema — role/isActive cannot be set here.
  const updated = await userRepo.updateProfile(auth.id, req.body);
  sendOk(res, { user: updated });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const auth = getAuthUser(req);
  await authService.changePassword(
    { userId: auth.id, currentPassword: req.body.currentPassword, newPassword: req.body.newPassword },
    requestMeta(req),
  );
  clearAuthCookies(res);
  sendOk(res, { message: 'Password changed. Please sign in again.' });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.requestPasswordReset(req.body.email);
  // Identical response whether or not the account exists.
  sendOk(res, {
    message: 'If an account exists for that address, a reset link has been sent.',
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body.token, req.body.newPassword, requestMeta(req));
  sendOk(res, { message: 'Password reset successfully. You can now sign in.' });
}
