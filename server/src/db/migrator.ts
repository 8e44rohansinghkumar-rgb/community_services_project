/**
 * SQL migration runner.
 *
 * Plain .sql files applied in filename order. Each migration runs inside its own
 * transaction together with the bookkeeping insert, so a failed migration leaves
 * no partial schema and no phantom version row. An advisory lock stops two
 * processes migrating at once (e.g. two app instances booting together).
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pool } from './pool';
import { logger } from '../utils/logger';

const MIGRATION_CANDIDATES = [
  process.env.MIGRATIONS_DIR,
  path.resolve(process.cwd(), '../database/migrations'),
  path.resolve(process.cwd(), 'database/migrations'),
  path.resolve(__dirname, '../../../database/migrations'),
  path.resolve(__dirname, '../../database/migrations'),
  '/database/migrations',
].filter(Boolean) as string[];

function resolveMigrationsDir(): string {
  for (const candidate of MIGRATION_CANDIDATES) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(process.cwd(), '../database/migrations');
}

const MIGRATIONS_DIR = resolveMigrationsDir();
const ADVISORY_LOCK_KEY = 4711_2026;

export interface MigrationFile {
  version: string;
  name: string;
  upPath: string;
  downPath: string | null;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await fs.readdir(dir);
  const upFiles = entries.filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();

  return upFiles.map((file) => {
    const version = file.split('_')[0] ?? file;
    const base = file.replace(/\.sql$/, '');
    const downFile = `${base}.down.sql`;
    return {
      version,
      name: base,
      upPath: path.join(dir, file),
      downPath: entries.includes(downFile) ? path.join(dir, downFile) : null,
    };
  });
}

async function appliedVersions(): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function withAdvisoryLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    client.release();
  }
}

export async function migrate(): Promise<string[]> {
  await ensureMigrationsTable();

  return withAdvisoryLock(async () => {
    const applied = await appliedVersions();
    const files = await listMigrationFiles();
    const pending = files.filter((f) => !applied.has(f.version));

    if (pending.length === 0) {
      logger.info('No pending migrations — database schema is up to date');
      return [];
    }

    const done: string[] = [];
    for (const migration of pending) {
      const sql = await fs.readFile(migration.upPath, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ]);
        await client.query('COMMIT');
        logger.info({ migration: migration.name }, 'Applied migration');
        done.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ err: error, migration: migration.name }, 'Migration failed — rolled back');
        throw error;
      } finally {
        client.release();
      }
    }
    return done;
  });
}

/** Roll back the most recently applied migration (one step). */
export async function rollback(steps = 1): Promise<string[]> {
  await ensureMigrationsTable();

  return withAdvisoryLock(async () => {
    const { rows } = await pool.query<{ version: string; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT $1',
      [steps],
    );
    if (rows.length === 0) {
      logger.info('Nothing to roll back');
      return [];
    }

    const files = await listMigrationFiles();
    const reverted: string[] = [];

    for (const row of rows) {
      const migration = files.find((f) => f.version === row.version);
      if (!migration?.downPath) {
        throw new Error(`No down migration available for ${row.name}`);
      }
      const sql = await fs.readFile(migration.downPath, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [row.version]);
        await client.query('COMMIT');
        logger.info({ migration: row.name }, 'Rolled back migration');
        reverted.push(row.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return reverted;
  });
}

export async function status(): Promise<{ version: string; name: string; applied: boolean }[]> {
  await ensureMigrationsTable();
  const applied = await appliedVersions();
  const files = await listMigrationFiles();
  return files.map((f) => ({ version: f.version, name: f.name, applied: applied.has(f.version) }));
}

/** Drop every application object and re-apply from zero (development only). */
export async function reset(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  logger.warn('Public schema dropped and recreated');
  await migrate();
}
