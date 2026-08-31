/**
 * Authentication: registration, login, session lifecycle, CSRF, refresh
 * rotation and password change.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, RUN_ID, Session, TEST_PASSWORD, cleanupRun, createUser, signedInAs } from './helpers';
import { pool } from '../src/db/pool';

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('POST /api/auth/register', () => {
  it('creates a CITIZEN account and returns the profile without the password hash', async () => {
    const session = new Session();
    await session.bootstrapCsrf();

    const response = await session.post('/api/auth/register').send({
      name: 'Registration Test',
      email: `register.${RUN_ID}@test.local`,
      password: TEST_PASSWORD,
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('CITIZEN');
    // A leaked hash is a serious problem; assert on the whole payload.
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
    expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
  });

  it('rejects a self-assigned privileged role (mass assignment)', async () => {
    const session = new Session();
    await session.bootstrapCsrf();

    const response = await session.post('/api/auth/register').send({
      name: 'Escalation Attempt',
      email: `escalate.${RUN_ID}@test.local`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
    });

    // .strict() rejects the unknown key outright rather than silently dropping it.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate email address', async () => {
    const email = `dupe.${RUN_ID}@test.local`;
    const first = new Session();
    await first.bootstrapCsrf();
    await first.post('/api/auth/register').send({ name: 'First User', email, password: TEST_PASSWORD });

    const second = new Session();
    await second.bootstrapCsrf();
    const response = await second.post('/api/auth/register').send({
      name: 'Second User',
      email,
      password: TEST_PASSWORD,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a password below the minimum length', async () => {
    const session = new Session();
    await session.bootstrapCsrf();
    const response = await session.post('/api/auth/register').send({
      name: 'Weak Password',
      email: `weak.${RUN_ID}@test.local`,
      password: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with valid credentials and sets HttpOnly auth cookies', async () => {
    const user = await createUser({ role: 'CITIZEN', label: 'login-ok' });
    const session = new Session();
    const response = await session.login(user.email);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.email);

    const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
    const access = cookies.find((c) => c.startsWith('civic_access='));
    const refresh = cookies.find((c) => c.startsWith('civic_refresh='));

    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    // The whole point of the cookie strategy: JavaScript must not be able to
    // read the tokens, which is what makes XSS token theft impossible.
    expect(access).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    // The refresh cookie is scoped so it is not sent on every ordinary request.
    expect(refresh).toMatch(/Path=\/api\/auth/i);
  });

  it('returns an identical error for an unknown email and a wrong password', async () => {
    const user = await createUser({ role: 'CITIZEN', label: 'enumeration' });

    const wrongPassword = new Session();
    await wrongPassword.bootstrapCsrf();
    const a = await wrongPassword.post('/api/auth/login').send({ email: user.email, password: 'WrongPassword!99' });

    const unknownEmail = new Session();
    await unknownEmail.bootstrapCsrf();
    const b = await unknownEmail.post('/api/auth/login').send({
      email: `nobody.${RUN_ID}@test.local`,
      password: 'WrongPassword!99',
    });

    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    // Differing messages would let an attacker enumerate registered addresses.
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(a.body.error.code).toBe(b.body.error.code);
  });

  it('refuses a deactivated account', async () => {
    const user = await createUser({ role: 'CITIZEN', label: 'deactivated', isActive: false });
    const session = new Session();
    const response = await session.login(user.email);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request with no CSRF header', async () => {
    const { session } = await signedInAs('CITIZEN', 'csrf-missing');
    const response = await session.postWithoutCsrf('/api/auth/logout').send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('rejects a mismatched CSRF token', async () => {
    const { session } = await signedInAs('CITIZEN', 'csrf-wrong');
    const response = await session
      .postWithoutCsrf('/api/auth/logout')
      .set('X-CSRF-Token', 'not-the-right-token')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('allows safe methods without a CSRF token', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });

  it('bootstraps a readable CSRF cookie for a first-time visitor', async () => {
    const response = await request(app).get('/api/auth/csrf');
    const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
    const csrf = cookies.find((c) => c.startsWith('civic_csrf='));

    expect(response.status).toBe(200);
    expect(csrf).toBeDefined();
    // This one MUST be readable by JavaScript — that is how double-submit works.
    expect(csrf).not.toMatch(/HttpOnly/i);
  });
});

describe('Session lifecycle', () => {
  it('returns the current user from /auth/me while signed in', async () => {
    const { session, user } = await signedInAs('CITIZEN', 'me');
    const response = await session.get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.id);
  });

  it('rejects /auth/me without a session', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const { session } = await signedInAs('CITIZEN', 'logout');
    expect((await session.get('/api/auth/me')).status).toBe(200);

    const logout = await session.logout();
    expect(logout.status).toBe(200);

    expect((await session.get('/api/auth/me')).status).toBe(401);
  });

  it('rotates the refresh token and issues a new access cookie', async () => {
    const { session } = await signedInAs('CITIZEN', 'refresh');
    const response = await session.post('/api/auth/refresh').send({});

    expect(response.status).toBe(200);
    const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
    // Rotation on every use is what makes stolen-token reuse detectable.
    expect(cookies.some((c) => c.startsWith('civic_refresh='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('civic_access='))).toBe(true);

    // The rotated session must still work.
    expect((await session.get('/api/auth/me')).status).toBe(200);
  });

  it('signs out every device with logout-all', async () => {
    const user = await createUser({ role: 'CITIZEN', label: 'logout-all' });

    const deviceA = new Session();
    await deviceA.login(user.email);
    const deviceB = new Session();
    await deviceB.login(user.email);

    expect((await deviceB.get('/api/auth/me')).status).toBe(200);

    await deviceA.post('/api/auth/logout-all').send({});

    // token_version was bumped, so B's access token is now rejected too.
    expect((await deviceB.get('/api/auth/me')).status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password and revokes other sessions', async () => {
    const user = await createUser({ role: 'CITIZEN', label: 'pwchange' });
    const primary = new Session();
    await primary.login(user.email);
    const other = new Session();
    await other.login(user.email);

    const newPassword = 'BrandNewPassw0rd!2026';
    const response = await primary.post('/api/auth/change-password').send({
      currentPassword: TEST_PASSWORD,
      newPassword,
    });

    expect(response.status).toBe(200);
    // Other devices must not survive a password change.
    expect((await other.get('/api/auth/me')).status).toBe(401);

    // The new password works, the old one does not.
    const fresh = new Session();
    expect((await fresh.login(user.email, newPassword)).status).toBe(200);
    const stale = new Session();
    expect((await stale.login(user.email, TEST_PASSWORD)).status).toBe(401);
  });

  it('rejects an incorrect current password', async () => {
    const { session } = await signedInAs('CITIZEN', 'pwwrong');
    const response = await session.post('/api/auth/change-password').send({
      currentPassword: 'DefinitelyNotIt!1',
      newPassword: 'AnotherPassw0rd!2026',
    });

    expect(response.status).toBe(401);
  });
});
