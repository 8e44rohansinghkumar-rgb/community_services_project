/**
 * Shared test utilities.
 *
 * These tests run against a REAL PostgreSQL database, not mocks. Mocking the
 * database here would test the mock: most of the behaviour worth verifying —
 * constraints, partial unique indexes, transaction rollback, cascade rules —
 * lives in PostgreSQL itself.
 */
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { hashPassword } from '../src/modules/auth/password.service';
import type { UserRole } from '../src/types';

export const app: Express = createApp();

/** Unique suffix so repeated runs never collide on unique constraints. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const TEST_PASSWORD = 'TestPassw0rd!2026';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** An authenticated agent that keeps its own cookie jar. */
export class Session {
  private readonly agent: ReturnType<typeof request.agent>;
  private csrf = '';
  public user: TestUser | null = null;

  constructor() {
    this.agent = request.agent(app);
  }

  /** Reads the CSRF cookie the server just set; it rotates on login. */
  private captureCsrf(response: Response): void {
    const raw = response.headers['set-cookie'];
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [raw];
    for (const cookie of cookies) {
      const match = /^civic_csrf=([^;]+)/.exec(cookie);
      if (match) this.csrf = decodeURIComponent(match[1]!);
    }
  }

  async bootstrapCsrf(): Promise<void> {
    const response = await this.agent.get('/api/auth/csrf');
    this.captureCsrf(response);
  }

  get(path: string): request.Test {
    return this.agent.get(path);
  }

  post(path: string): request.Test {
    return this.agent.post(path).set('X-CSRF-Token', this.csrf);
  }

  patch(path: string): request.Test {
    return this.agent.patch(path).set('X-CSRF-Token', this.csrf);
  }

  del(path: string): request.Test {
    return this.agent.delete(path).set('X-CSRF-Token', this.csrf);
  }

  /** POST without the CSRF header — used to prove the guard actually fires. */
  postWithoutCsrf(path: string): request.Test {
    return this.agent.post(path);
  }

  async login(email: string, password = TEST_PASSWORD): Promise<Response> {
    await this.bootstrapCsrf();
    const response = await this.post('/api/auth/login').send({ email, password });
    this.captureCsrf(response);
    if (response.status === 200) {
      this.user = response.body.data.user;
    }
    return response;
  }

  async logout(): Promise<Response> {
    return this.post('/api/auth/logout').send({});
  }
}

/** Creates a user directly in the database, bypassing the HTTP layer. */
export async function createUser(options: {
  role: UserRole;
  label: string;
  isActive?: boolean;
  departmentId?: string | null;
}): Promise<TestUser> {
  const email = `${options.label}.${RUN_ID}@test.local`;
  const name = `Test ${options.label}`;
  const passwordHash = await hashPassword(TEST_PASSWORD);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, is_active, email_verified, department_id)
     VALUES ($1, $2, $3, $4::user_role, $5, TRUE, $6)
     RETURNING id`,
    [name, email, passwordHash, options.role, options.isActive ?? true, options.departmentId ?? null],
  );

  return { id: rows[0]!.id, email, name, role: options.role };
}

/** Signs in as a freshly created user of the given role. */
export async function signedInAs(role: UserRole, label: string): Promise<{ session: Session; user: TestUser }> {
  const user = await createUser({ role, label });
  const session = new Session();
  const response = await session.login(user.email);
  if (response.status !== 200) {
    throw new Error(`Test login failed for ${user.email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { session, user };
}

/** First active category id — seeded by migration, always present. */
export async function anyCategoryId(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM issue_categories WHERE is_active ORDER BY sort_order, id LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No active categories — run the migrations first.');
  return rows[0].id;
}

let issueCounter = 0;

/** Creates an issue through the API so all the real side effects happen. */
export async function createIssue(
  session: Session,
  overrides: Partial<{
    title: string;
    description: string;
    categoryId: number;
    citizenSeverity: string;
    latitude: number;
    longitude: number;
    isPublic: boolean;
  }> = {},
): Promise<{ id: string; publicId: string; body: Record<string, unknown> }> {
  issueCounter += 1;
  const categoryId = overrides.categoryId ?? (await anyCategoryId());

  const response = await session
    .post('/api/issues')
    // Multipart, because that is how the real client submits (files optional).
    .field('title', overrides.title ?? `Test issue ${RUN_ID}-${issueCounter}`)
    .field('description', overrides.description ?? `Automated test issue ${RUN_ID} number ${issueCounter}.`)
    .field('categoryId', String(categoryId))
    .field('citizenSeverity', overrides.citizenSeverity ?? 'MEDIUM')
    // Offsets keep each issue outside the 150 m duplicate radius of the last.
    .field('latitude', String(overrides.latitude ?? 28.2 + issueCounter * 0.01))
    .field('longitude', String(overrides.longitude ?? 77.05 + issueCounter * 0.01))
    .field('isPublic', String(overrides.isPublic ?? true));

  if (response.status !== 201) {
    throw new Error(`createIssue failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return {
    id: response.body.data.issue.id,
    publicId: response.body.data.issue.publicId,
    body: response.body.data.issue,
  };
}

/** A minimal but VALID PNG (correct magic bytes), for upload tests. */
export function pngFixture(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** Bytes that are NOT an image, regardless of the filename claimed. */
export function fakeImageFixture(): Buffer {
  return Buffer.from('<?php system($_GET["cmd"]); ?>', 'utf8');
}

/** Removes everything this run created, in FK-safe order. */
export async function cleanupRun(): Promise<void> {
  await pool.query(
    `DELETE FROM issues
      WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`%${RUN_ID}@test.local`],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${RUN_ID}@test.local`]);
}
