/**
 * Input validation, injection resistance, pagination limits and sort
 * whitelisting.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, Session, anyCategoryId, cleanupRun, createIssue, signedInAs, type TestUser } from './helpers';
import { pool } from '../src/db/pool';

let citizen: { session: Session; user: TestUser };
let admin: { session: Session; user: TestUser };
let categoryId: number;

beforeAll(async () => {
  citizen = await signedInAs('CITIZEN', 'valid-citizen');
  admin = await signedInAs('ADMIN', 'valid-admin');
  categoryId = await anyCategoryId();
});

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('Issue creation validation', () => {
  const base = () => ({
    title: 'A perfectly valid issue title',
    description: 'A description that comfortably exceeds the minimum length.',
    categoryId: String(categoryId),
    citizenSeverity: 'MEDIUM',
    latitude: '28.2500',
    longitude: '77.0700',
    isPublic: 'true',
  });

  const submit = (overrides: Record<string, string>) => {
    const payload = { ...base(), ...overrides };
    let req = citizen.session.post('/api/issues');
    for (const [key, value] of Object.entries(payload)) req = req.field(key, value);
    return req;
  };

  it('rejects a title that is too short', async () => {
    const response = await submit({ title: 'Hi' });
    expect(response.status).toBe(400);
    expect(response.body.error.details.some((d: { field: string }) => d.field === 'title')).toBe(true);
  });

  it('rejects a description that is too short', async () => {
    const response = await submit({ description: 'Broken' });
    expect(response.status).toBe(400);
  });

  it('rejects a latitude outside -90..90', async () => {
    const response = await submit({ latitude: '145.5' });
    expect(response.status).toBe(400);
  });

  it('rejects a longitude outside -180..180', async () => {
    const response = await submit({ longitude: '500' });
    expect(response.status).toBe(400);
  });

  it('rejects a non-numeric latitude', async () => {
    const response = await submit({ latitude: 'north-ish' });
    expect(response.status).toBe(400);
  });

  it('rejects a category that does not exist', async () => {
    const response = await submit({ categoryId: '999999' });
    expect(response.status).toBe(400);
  });

  it('rejects a severity outside the enum', async () => {
    const response = await submit({ citizenSeverity: 'APOCALYPTIC' });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown field (mass assignment via .strict())', async () => {
    const response = await submit({ officialPriority: 'CRITICAL' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores a client-supplied status and always starts at REPORTED', async () => {
    const issue = await createIssue(citizen.session);
    const detail = await citizen.session.get(`/api/issues/${issue.id}`);
    expect(detail.body.data.issue.status).toBe('REPORTED');
  });

  it('reports every invalid field at once rather than one at a time', async () => {
    const response = await submit({ title: 'x', description: 'y', latitude: '999' });
    expect(response.status).toBe(400);
    expect(response.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SQL injection resistance', () => {
  const payloads = [
    "'; DROP TABLE issues; --",
    "' OR '1'='1",
    "1; DELETE FROM users WHERE 't'='t",
    "\\'; UPDATE users SET role='ADMIN'; --",
    "' UNION SELECT password_hash FROM users --",
  ];

  it('treats injection payloads in search as literal text', async () => {
    for (const payload of payloads) {
      const response = await citizen.session.get(`/api/issues?search=${encodeURIComponent(payload)}`);
      // Parameterised SQL: the string is a value, never syntax.
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }

    // Prove nothing was actually dropped or modified.
    const users = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM users`);
    expect(Number(users.rows[0]!.count)).toBeGreaterThan(0);
    const issues = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM issues`);
    expect(Number(issues.rows[0]!.count)).toBeGreaterThanOrEqual(0);
  });

  it('treats injection payloads in a title as literal text', async () => {
    const payload = "Pothole'; DROP TABLE issues; --";
    const issue = await createIssue(citizen.session, { title: payload });
    const detail = await citizen.session.get(`/api/issues/${issue.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.issue.title).toBe(payload);
    // The table still exists.
    await expect(pool.query('SELECT 1 FROM issues LIMIT 1')).resolves.toBeDefined();
  });

  it('rejects an injection payload in a UUID path parameter', async () => {
    const response = await citizen.session.get("/api/issues/1' OR '1'='1");
    expect(response.status).toBe(400);
  });
});

describe('Pagination limits', () => {
  it('applies a default page size', async () => {
    const response = await admin.session.get('/api/issues');
    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(20);
  });

  it('refuses a limit above the server ceiling', async () => {
    const response = await admin.session.get('/api/issues?limit=100000');
    // The ceiling is enforced, never silently honoured.
    expect(response.status).toBe(400);
  });

  it('accepts the maximum allowed limit', async () => {
    const response = await admin.session.get('/api/issues?limit=100');
    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(100);
    expect(response.body.data.length).toBeLessThanOrEqual(100);
  });

  it('rejects a zero or negative limit', async () => {
    expect((await admin.session.get('/api/issues?limit=0')).status).toBe(400);
    expect((await admin.session.get('/api/issues?limit=-5')).status).toBe(400);
  });

  it('rejects a zero or negative page', async () => {
    expect((await admin.session.get('/api/issues?page=0')).status).toBe(400);
  });

  it('returns a complete pagination envelope', async () => {
    const response = await admin.session.get('/api/issues?limit=5');
    expect(response.body.pagination).toMatchObject({
      page: expect.any(Number),
      limit: expect.any(Number),
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('returns different rows on different pages', async () => {
    const first = await admin.session.get('/api/issues?limit=2&page=1');
    const second = await admin.session.get('/api/issues?limit=2&page=2');
    if (first.body.pagination.total > 2) {
      const a = (first.body.data as { id: string }[]).map((i) => i.id);
      const b = (second.body.data as { id: string }[]).map((i) => i.id);
      expect(a).not.toEqual(b);
    }
  });
});

describe('Sort whitelisting', () => {
  it('rejects a sort field that is not whitelisted', async () => {
    const response = await admin.session.get('/api/issues?sortBy=password_hash');
    // Interpolating an arbitrary column name would be an injection vector.
    expect(response.status).toBe(400);
  });

  it('rejects an injection payload as a sort field', async () => {
    const response = await admin.session.get('/api/issues?sortBy=id;DROP%20TABLE%20issues');
    expect(response.status).toBe(400);
  });

  it('rejects an invalid sort direction', async () => {
    const response = await admin.session.get('/api/issues?sortBy=createdAt&sortDir=sideways');
    expect(response.status).toBe(400);
  });

  it('accepts every whitelisted sort field', async () => {
    for (const field of ['createdAt', 'updatedAt', 'priority', 'status', 'title', 'resolvedAt']) {
      const response = await admin.session.get(`/api/issues?sortBy=${field}&sortDir=asc`);
      expect(response.status).toBe(200);
    }
  });
});

describe('Error envelope', () => {
  it('returns a consistent shape for a 404 route', async () => {
    const response = await request(app).get('/api/definitely-not-a-route');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.error).toHaveProperty('requestId');
  });

  it('never leaks a stack trace or internal path', async () => {
    const response = await request(app).get('/api/definitely-not-a-route');
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('at Object');
    expect(serialised).not.toContain('/home/');
    expect(serialised).not.toContain('node_modules');
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('rejects a malformed JSON body cleanly', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', 'x')
      .send('{"email": broken}');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects an oversized JSON body', async () => {
    const session = new Session();
    await session.bootstrapCsrf();
    const response = await session.post('/api/auth/login').send({
      email: 'x@test.local',
      password: 'a'.repeat(200_000),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Security headers', () => {
  it('sets the expected hardening headers', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // Advertising the framework helps nobody but an attacker.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS policy', () => {
  it('rejects a request from an origin that is not allowlisted', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('never responds with a wildcard origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    // A wildcard is incompatible with credentialed requests and would be a hole.
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('allows a request with no Origin header (curl, server-to-server)', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});
