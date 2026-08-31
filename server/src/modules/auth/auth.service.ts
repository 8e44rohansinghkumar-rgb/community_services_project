/**
 * Authentication business logic: registration, login, refresh rotation, logout,
 * password change. All multi-table writes run in transactions.
 */
import crypto from 'node:crypto';
import { withTransaction, pool, isPgError, PG_ERROR } from '../../db/pool';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
  AuthorizationError,
} from '../../utils/errors';
import * as userRepo from '../users/user.repository';
import * as authRepo from './auth.repository';
import * as audit from '../audit/audit.service';
import {
  generateRefreshToken,
  generateCsrfToken,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
} from './token.service';
import { hashPassword, verifyPassword, verifyDummyPassword, passwordPolicyIssues } from './password.service';
import type { User } from '../../types';

/** Account-level throttle: independent of IP, so rotating IPs does not help. */
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_WINDOW_MINUTES = 15;

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

function buildAccessToken(user: User, tokenVersion: number): string {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    tv: tokenVersion,
  });
}

async function issueSession(
  user: User,
  tokenVersion: number,
  meta: RequestMeta,
  familyId = crypto.randomUUID(),
): Promise<AuthTokens> {
  const { token, hash } = generateRefreshToken();
  await authRepo.insertRefreshToken({
    userId: user.id,
    tokenHash: hash,
    familyId,
    expiresAt: refreshExpiryDate(),
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return {
    accessToken: buildAccessToken(user, tokenVersion),
    refreshToken: token,
    csrfToken: generateCsrfToken(),
  };
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string | null;
}

export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const policyIssues = passwordPolicyIssues(input.password, email);
  if (policyIssues.length > 0) {
    throw new ValidationError(
      'Password does not meet the security requirements',
      policyIssues.map((message) => ({ field: 'password', message })),
    );
  }

  // Self-registration ALWAYS produces a CITIZEN. Role is never taken from the
  // request body — this is the primary privilege-escalation guard.
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await withTransaction(async (client) => {
      const created = await userRepo.createUser(
        {
          name: input.name.trim(),
          email,
          passwordHash,
          phone: input.phone?.trim() || null,
          role: 'CITIZEN',
        },
        client,
      );

      await audit.record(
        {
          actorId: created.id,
          actorEmail: created.email,
          action: audit.AUDIT_ACTIONS.USER_REGISTERED,
          entityType: 'user',
          entityId: created.id,
          metadata: { role: created.role },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        client,
      );

      return created;
    });

    const tokens = await issueSession(user, 0, meta);
    return { user, tokens };
  } catch (error) {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      // The address is already registered. This is unavoidable disclosure on a
      // self-service signup form (the user must be told), but account-recovery
      // flows below stay deliberately generic.
      throw new ConflictError('An account with that email address already exists', 'EMAIL_ALREADY_REGISTERED');
    }
    throw error;
  }
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const recentFailures = await authRepo.countRecentFailures(email, ACCOUNT_LOCK_WINDOW_MINUTES);
  if (recentFailures >= ACCOUNT_LOCK_THRESHOLD) {
    logger.warn({ email: '[redacted]', ip: meta.ipAddress }, 'Account temporarily locked after repeated failures');
    throw new AuthenticationError(
      'Too many failed sign-in attempts. Please wait a few minutes and try again.',
      'ACCOUNT_TEMPORARILY_LOCKED',
    );
  }

  const record = await userRepo.findByEmailWithSecret(email);

  if (!record) {
    // Spend comparable CPU so response time does not reveal account existence.
    await verifyDummyPassword(input.password);
    await authRepo.recordLoginAttempt({ email, ipAddress: meta.ipAddress, successful: false });
    throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const passwordValid = await verifyPassword(record.passwordHash, input.password);
  if (!passwordValid) {
    await authRepo.recordLoginAttempt({ email, ipAddress: meta.ipAddress, successful: false });
    // Identical message and status to the unknown-account case.
    throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (!record.isActive) {
    await authRepo.recordLoginAttempt({ email, ipAddress: meta.ipAddress, successful: false });
    throw new AuthorizationError('This account has been deactivated. Please contact an administrator.');
  }

  await authRepo.recordLoginAttempt({ email, ipAddress: meta.ipAddress, successful: true });
  await authRepo.clearFailures(email);
  await userRepo.touchLastLogin(record.id);

  const { passwordHash: _hash, tokenVersion, ...user } = record;
  const tokens = await issueSession(user, tokenVersion, meta);
  return { user, tokens };
}

/**
 * Refresh rotation with re-use detection.
 *
 * A refresh token is single-use. Presenting one that was already rotated means
 * either a replay or a stolen cookie, so the entire family is revoked and the
 * user must sign in again.
 */
export async function refresh(rawToken: string, meta: RequestMeta): Promise<AuthResult> {
  const tokenHash = hashToken(rawToken);

  return withTransaction(async (client) => {
    const stored = await authRepo.findByHash(tokenHash, client);

    if (!stored) {
      throw new AuthenticationError('Your session is no longer valid. Please sign in again.', 'INVALID_REFRESH_TOKEN');
    }

    if (stored.revoked_at) {
      await authRepo.revokeFamily(stored.family_id, 'reuse_detected', client);
      logger.warn({ userId: stored.user_id, ip: meta.ipAddress }, 'Refresh token reuse detected — family revoked');
      throw new AuthenticationError('Your session is no longer valid. Please sign in again.', 'TOKEN_REUSE_DETECTED');
    }

    if (stored.expires_at.getTime() <= Date.now()) {
      throw new AuthenticationError('Your session has expired. Please sign in again.', 'REFRESH_TOKEN_EXPIRED');
    }

    const record = await userRepo.findByIdWithSecret(stored.user_id, client);
    if (!record || !record.isActive) {
      await authRepo.revokeFamily(stored.family_id, 'account_inactive', client);
      throw new AuthenticationError('Your session is no longer valid. Please sign in again.', 'ACCOUNT_INACTIVE');
    }

    const { token, hash } = generateRefreshToken();
    const newId = await authRepo.insertRefreshToken(
      {
        userId: record.id,
        tokenHash: hash,
        familyId: stored.family_id,
        expiresAt: refreshExpiryDate(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      client,
    );
    await authRepo.revokeToken(stored.id, 'rotated', newId, client);

    const { passwordHash: _hash, tokenVersion, ...user } = record;
    return {
      user,
      tokens: {
        accessToken: buildAccessToken(user, tokenVersion),
        refreshToken: token,
        csrfToken: generateCsrfToken(),
      },
    };
  });
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const stored = await authRepo.findByHash(hashToken(rawToken));
  // Revoke the family, not just the token: logging out on a device should not
  // leave a rotated descendant usable.
  if (stored) await authRepo.revokeFamily(stored.family_id, 'logout');
}

export async function logoutAllSessions(userId: string): Promise<void> {
  await withTransaction(async (client) => {
    await authRepo.revokeAllForUser(userId, 'logout_all', client);
    await userRepo.bumpTokenVersion(userId, client);
  });
}

/**
 * The access JWT carries tokenVersion; this confirms it still matches the
 * database. Called by /auth/me and before privileged mutations so a
 * deactivated or role-changed user cannot keep acting on a stale token.
 */
export async function loadActiveUser(userId: string, tokenVersion: number): Promise<User> {
  const record = await userRepo.findByIdWithSecret(userId);
  if (!record) throw new AuthenticationError('Your session is no longer valid', 'ACCOUNT_NOT_FOUND');
  if (!record.isActive) throw new AuthorizationError('This account has been deactivated');
  if (record.tokenVersion !== tokenVersion) {
    throw new AuthenticationError('Your session is no longer valid. Please sign in again.', 'SESSION_INVALIDATED');
  }
  const { passwordHash: _hash, tokenVersion: _tv, ...user } = record;
  return user;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
  const record = await userRepo.findByIdWithSecret(input.userId);
  if (!record) throw new AuthenticationError('Your session is no longer valid');

  const valid = await verifyPassword(record.passwordHash, input.currentPassword);
  if (!valid) throw new AuthenticationError('Your current password is incorrect', 'INVALID_CREDENTIALS');

  const policyIssues = passwordPolicyIssues(input.newPassword, record.email);
  if (policyIssues.length > 0) {
    throw new ValidationError(
      'Password does not meet the security requirements',
      policyIssues.map((message) => ({ field: 'newPassword', message })),
    );
  }

  if (await verifyPassword(record.passwordHash, input.newPassword)) {
    throw new ValidationError('Your new password must be different from the current one');
  }

  const newHash = await hashPassword(input.newPassword);

  await withTransaction(async (client) => {
    // updatePasswordHash bumps token_version, killing outstanding access tokens.
    await userRepo.updatePasswordHash(record.id, newHash, client);
    await authRepo.revokeAllForUser(record.id, 'password_changed', client);
    await audit.record(
      {
        actorId: record.id,
        actorEmail: record.email,
        action: audit.AUDIT_ACTIONS.PASSWORD_CHANGED,
        entityType: 'user',
        entityId: record.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );
  });
}

/**
 * Password reset request. Always resolves successfully regardless of whether the
 * address exists — the response must not confirm account existence (spec §50).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalised = email.trim().toLowerCase();
  const record = await userRepo.findByEmailWithSecret(normalised);
  if (!record || !record.isActive) return;

  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [record.id, hashToken(token)],
  );

  const resetUrl = `${config.APP_URL}/reset-password?token=${token}`;
  const { notifier } = await import('../notifications/notification.service');
  await notifier.send({
    to: record.email,
    subject: 'Reset your Civic Connect password',
    body: `A password reset was requested for your account. Use this link within one hour:\n${resetUrl}\n\nIf you did not request this, you can safely ignore this message.`,
  });
}

export async function resetPassword(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const tokenHash = hashToken(rawToken);

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
         FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [tokenHash],
    );
    const tokenRow = rows[0];
    if (!tokenRow) {
      throw new ValidationError('This password reset link is invalid or has expired');
    }

    const user = await userRepo.findByIdWithSecret(tokenRow.user_id, client);
    if (!user) throw new ValidationError('This password reset link is invalid or has expired');

    const policyIssues = passwordPolicyIssues(newPassword, user.email);
    if (policyIssues.length > 0) {
      throw new ValidationError(
        'Password does not meet the security requirements',
        policyIssues.map((message) => ({ field: 'newPassword', message })),
      );
    }

    const newHash = await hashPassword(newPassword);
    await userRepo.updatePasswordHash(user.id, newHash, client);
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [tokenRow.id]);
    await authRepo.revokeAllForUser(user.id, 'password_reset', client);
    await audit.record(
      {
        actorId: user.id,
        actorEmail: user.email,
        action: audit.AUDIT_ACTIONS.PASSWORD_CHANGED,
        entityType: 'user',
        entityId: user.id,
        metadata: { via: 'reset_token' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );
  });
}
