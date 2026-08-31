/**
 * PostgreSQL connection pool and transaction helper.
 *
 * Everything that touches the database goes through here. Repositories accept an
 * optional `Executor`, which is either the pool (auto-commit) or a checked-out
 * client inside a transaction — that is what lets a service compose several
 * repository calls into one atomic unit without repositories knowing about
 * transactions at all.
 */
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/** Anything able to run a parameterised query: the pool or a transaction client. */
export interface Executor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  application_name: 'civic-api',
});

pool.on('error', (err) => {
  // An idle client failed (e.g. the database restarted). pg removes it from the
  // pool automatically; log it rather than letting it become an unhandled error.
  logger.error({ err }, 'Unexpected PostgreSQL client error');
});

/** Slow-query visibility without logging parameter values (they may be personal data). */
const SLOW_QUERY_MS = 300;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  const startedAt = process.hrtime.bigint();
  try {
    return await pool.query<T>(text, params as unknown[]);
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (elapsedMs > SLOW_QUERY_MS) {
      logger.warn({ elapsedMs: Math.round(elapsedMs), sql: text.replace(/\s+/g, ' ').slice(0, 160) }, 'Slow query');
    }
  }
}

/**
 * Run `fn` inside a transaction. Commits on success, rolls back on any thrown
 * error, and always returns the client to the pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Transaction rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database connectivity check failed');
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** PostgreSQL error codes the service layer translates into domain errors. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  INVALID_TEXT_REPRESENTATION: '22P02',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

export function isPgError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

export function pgConstraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { constraint?: string }).constraint
    : undefined;
}
