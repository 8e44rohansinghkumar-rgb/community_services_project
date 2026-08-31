/**
 * Refresh-token and login-attempt persistence.
 * Tokens are stored as SHA-256 hashes only, never in plaintext.
 */
import { pool, type Executor } from '../../db/pool';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function insertRefreshToken(
  input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
  db: Executor = pool,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.userId,
      input.tokenHash,
      input.familyId,
      input.expiresAt,
      input.userAgent?.slice(0, 255) ?? null,
      input.ipAddress ?? null,
    ],
  );
  return rows[0].id;
}

export async function findByHash(tokenHash: string, db: Executor = pool): Promise<RefreshTokenRow | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    `SELECT id, user_id, family_id, expires_at, revoked_at
       FROM refresh_tokens
      WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeToken(
  id: string,
  reason: string,
  replacedBy: string | null = null,
  db: Executor = pool,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2, replaced_by = $3
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, reason, replacedBy],
  );
}

/** Token theft response: kill every token in the rotation chain. */
export async function revokeFamily(familyId: string, reason: string, db: Executor = pool): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
}

export async function revokeAllForUser(userId: string, reason: string, db: Executor = pool): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

export async function deleteExpiredTokens(db: Executor = pool): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - interval '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`,
  );
  return rowCount ?? 0;
}

export async function recordLoginAttempt(
  input: { email: string; ipAddress: string | null; successful: boolean },
  db: Executor = pool,
): Promise<void> {
  await db.query(
    'INSERT INTO login_attempts (email, ip_address, successful) VALUES ($1, $2, $3)',
    [input.email, input.ipAddress, input.successful],
  );
}

/**
 * Per-account failure count. Complements IP rate limiting: distributed
 * credential stuffing rotates IPs but still hammers one account.
 */
export async function countRecentFailures(
  email: string,
  windowMinutes: number,
  db: Executor = pool,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM login_attempts
      WHERE email = $1
        AND NOT successful
        AND created_at > now() - ($2 || ' minutes')::interval`,
    [email, String(windowMinutes)],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function clearFailures(email: string, db: Executor = pool): Promise<void> {
  await db.query('DELETE FROM login_attempts WHERE email = $1 AND NOT successful', [email]);
}
