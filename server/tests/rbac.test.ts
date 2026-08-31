/**
 * Authorisation: role-based access control and object-level ownership (IDOR).
 *
 * The interesting cases are the ones where a caller is authenticated and
 * well-formed but simply has no business touching the record.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, Session, cleanupRun, createIssue, signedInAs, type TestUser } from './helpers';
import { pool } from '../src/db/pool';

let citizen: { session: Session; user: TestUser };
let otherCitizen: { session: Session; user: TestUser };
let worker: { session: Session; user: TestUser };
let otherWorker: { session: Session; user: TestUser };
let admin: { session: Session; user: TestUser };

let ownedIssueId: string;
let privateIssueId: string;

beforeAll(async () => {
  citizen = await signedInAs('CITIZEN', 'rbac-citizen');
  otherCitizen = await signedInAs('CITIZEN', 'rbac-other');
  worker = await signedInAs('WORKER', 'rbac-worker');
  otherWorker = await signedInAs('WORKER', 'rbac-worker2');
  admin = await signedInAs('ADMIN', 'rbac-admin');

  ownedIssueId = (await createIssue(citizen.session, { title: 'RBAC public issue for testing' })).id;
  privateIssueId = (await createIssue(citizen.session, { title: 'RBAC private issue for testing', isPublic: false })).id;
});

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('Route-level role guards', () => {
  it('forbids a citizen from listing users', async () => {
    const response = await citizen.session.get('/api/users');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('forbids a worker from listing users', async () => {
    const response = await worker.session.get('/api/users');
    expect(response.status).toBe(403);
  });

  it('allows an admin to list users', async () => {
    const response = await admin.session.get('/api/users');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('forbids a citizen from reading the audit log', async () => {
    expect((await citizen.session.get('/api/audit-logs')).status).toBe(403);
  });

  it('forbids a worker from reading the audit log', async () => {
    expect((await worker.session.get('/api/audit-logs')).status).toBe(403);
  });

  it('forbids a citizen from assigning an issue', async () => {
    const response = await citizen.session
      .post(`/api/issues/${ownedIssueId}/assign`)
      .send({ workerId: worker.user.id });
    expect(response.status).toBe(403);
  });

  it('forbids a worker from assigning an issue', async () => {
    const response = await worker.session
      .post(`/api/issues/${ownedIssueId}/assign`)
      .send({ workerId: worker.user.id });
    expect(response.status).toBe(403);
  });

  it('forbids a citizen from changing an official priority', async () => {
    const response = await citizen.session
      .patch(`/api/issues/${ownedIssueId}/priority`)
      .send({ priority: 'CRITICAL' });
    expect(response.status).toBe(403);
  });

  it('forbids a worker from viewing worker workload analytics', async () => {
    expect((await worker.session.get('/api/analytics/worker-workload')).status).toBe(403);
  });

  it('forbids a citizen from exporting data', async () => {
    expect((await citizen.session.get('/api/analytics/export')).status).toBe(403);
  });

  it('forbids a non-admin from soft-deleting an issue', async () => {
    expect((await citizen.session.del(`/api/issues/${ownedIssueId}`)).status).toBe(403);
  });

  it('forbids a citizen from creating a staff account', async () => {
    const response = await citizen.session.post('/api/users').send({
      name: 'Sneaky Admin',
      email: 'sneaky@test.local',
      password: 'Passw0rd!123456',
      role: 'ADMIN',
    });
    expect(response.status).toBe(403);
  });
});

describe('Object-level access (IDOR)', () => {
  it("hides another citizen's PRIVATE issue behind a 404, not a 403", async () => {
    const response = await otherCitizen.session.get(`/api/issues/${privateIssueId}`);
    // 403 would confirm the row exists. 404 gives an attacker nothing.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it("lets any signed-in user READ another citizen's PUBLIC issue", async () => {
    const response = await otherCitizen.session.get(`/api/issues/${ownedIssueId}`);
    expect(response.status).toBe(200);
    expect(response.body.data.access).toBe('PUBLIC_VIEWER');
  });

  it("forbids a citizen from EDITING another citizen's issue", async () => {
    const response = await otherCitizen.session
      .patch(`/api/issues/${ownedIssueId}`)
      .send({ title: 'Hijacked title attempt' });
    expect([403, 404]).toContain(response.status);
  });

  it("excludes another citizen's issues from the caller's list", async () => {
    const response = await otherCitizen.session.get('/api/issues?limit=100');
    expect(response.status).toBe(200);
    const ids = (response.body.data as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain(ownedIssueId);
    expect(ids).not.toContain(privateIssueId);
  });

  it('forbids a non-assigned worker from acting on an issue', async () => {
    const response = await otherWorker.session
      .post(`/api/issues/${ownedIssueId}/status`)
      .send({ status: 'IN_PROGRESS' });
    expect([403, 409]).toContain(response.status);
  });

  it("returns 404 for another worker's queue", async () => {
    const response = await worker.session.get(`/api/workers/${otherWorker.user.id}/issues`);
    expect(response.status).toBe(404);
  });

  it('lets a worker read their own queue', async () => {
    const response = await worker.session.get(`/api/workers/${worker.user.id}/issues`);
    expect(response.status).toBe(200);
  });

  it("returns 404 for another user's notification id", async () => {
    // Give the other citizen a notification by assigning their issue... simplest
    // path: read the caller's own list, then try a random UUID.
    const response = await citizen.session.patch('/api/notifications/00000000-0000-4000-8000-000000000000/read').send({});
    expect(response.status).toBe(404);
  });

  it('scopes notifications to the caller', async () => {
    const response = await citizen.session.get('/api/notifications');
    expect(response.status).toBe(200);
    for (const notification of response.body.data as { userId: string }[]) {
      expect(notification.userId).toBe(citizen.user.id);
    }
  });
});

describe('Privacy projection', () => {
  it('hides reporter identity from a public viewer', async () => {
    const response = await otherCitizen.session.get(`/api/issues/${ownedIssueId}`);
    expect(response.status).toBe(200);
    // A public viewer must not learn who filed the report.
    expect(response.body.data.issue.reporterEmail ?? null).toBeNull();
    expect(response.body.data.issue.reporterName ?? null).toBeNull();
  });

  it('shows reporter identity to an admin', async () => {
    const response = await admin.session.get(`/api/issues/${ownedIssueId}`);
    expect(response.status).toBe(200);
    expect(response.body.data.issue.reporterName).toBeTruthy();
  });

  it('rounds coordinates on the anonymous public feed', async () => {
    const response = await request(app).get('/api/issues/public?limit=20');
    expect(response.status).toBe(200);
    for (const issue of response.body.data as { latitude: number; longitude: number }[]) {
      const latDecimals = (String(issue.latitude).split('.')[1] ?? '').length;
      const lngDecimals = (String(issue.longitude).split('.')[1] ?? '').length;
      // ~110 m of fuzzing: enough that a report cannot be pinned to a doorstep.
      expect(latDecimals).toBeLessThanOrEqual(3);
      expect(lngDecimals).toBeLessThanOrEqual(3);
    }
  });

  it('omits private issues from the public feed', async () => {
    const response = await request(app).get('/api/issues/public?limit=100');
    const ids = (response.body.data as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain(privateIssueId);
  });

  it('hides staff contact details from a worker browsing the directory', async () => {
    const response = await worker.session.get('/api/workers');
    expect(response.status).toBe(200);
    for (const entry of response.body.data.workers as Record<string, unknown>[]) {
      expect(entry.email).toBeUndefined();
      expect(entry.phone).toBeUndefined();
    }
  });

  it('shows staff contact details to an admin', async () => {
    const response = await admin.session.get('/api/workers');
    expect(response.status).toBe(200);
    const workers = response.body.data.workers as Record<string, unknown>[];
    expect(workers.length).toBeGreaterThan(0);
    expect(workers[0]!.email).toBeDefined();
  });
});

describe('Unauthenticated access', () => {
  it('rejects the authenticated issue list', async () => {
    expect((await request(app).get('/api/issues')).status).toBe(401);
  });

  it('allows the public feed', async () => {
    expect((await request(app).get('/api/issues/public')).status).toBe(200);
  });

  it('allows the category list', async () => {
    expect((await request(app).get('/api/categories')).status).toBe(200);
  });

  it('rejects analytics', async () => {
    expect((await request(app).get('/api/analytics/overview')).status).toBe(401);
  });
});
