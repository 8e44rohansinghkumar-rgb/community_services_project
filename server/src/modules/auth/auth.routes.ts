/**
 * Auth routes. Each binds middleware (rate limit -> validation -> auth) to a
 * controller; no logic lives here.
 */
import { Router } from 'express';
import * as controller from './auth.controller';
import * as schemas from './auth.validators';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/http';
import {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  authenticatedLimiter,
  publicLimiter,
} from '../../middleware/rateLimit';

export const authRouter = Router();

/**
 * Safe GET that issues a CSRF token. The SPA calls this on start-up so it can
 * satisfy the double-submit check on its very first POST (including login,
 * which is itself protected against login-CSRF).
 */
authRouter.get('/csrf', publicLimiter, asyncHandler(controller.csrfBootstrap));

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: schemas.registerSchema }),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: schemas.loginSchema }),
  asyncHandler(controller.login),
);

// No auth middleware: the whole point is that the access token has expired.
// Protected by the refresh cookie + CSRF double-submit.
authRouter.post('/refresh', asyncHandler(controller.refresh));

authRouter.post('/logout', asyncHandler(controller.logout));

authRouter.post('/logout-all', requireAuth, asyncHandler(controller.logoutAll));

authRouter.get('/me', requireAuth, authenticatedLimiter, asyncHandler(controller.me));

authRouter.patch(
  '/me',
  requireAuth,
  authenticatedLimiter,
  validate({ body: schemas.updateProfileSchema }),
  asyncHandler(controller.updateProfile),
);

authRouter.post(
  '/change-password',
  requireAuth,
  passwordResetLimiter,
  validate({ body: schemas.changePasswordSchema }),
  asyncHandler(controller.changePassword),
);

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validate({ body: schemas.forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validate({ body: schemas.resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);
