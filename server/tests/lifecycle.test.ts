/**
 * Issue lifecycle: valid transitions, rejected invalid transitions, the
 * evidence and reason gates, and the atomicity of assignment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, cleanupRun, createIssue, pngFixture, signedInAs, type TestUser } from './helpers';
import { pool } from '../src/db/pool';

let citizen: { session: Session; user: TestUser };
let worker: { session: Session; user: TestUser };
let admin: { session: Session; user: TestUser };

beforeAll(async () => {
  citizen = await signedInAs('CITIZEN', 'life-citizen');
  worker = await signedInAs('WORKER', 'life-worker');
  admin = await signedInAs('ADMIN', 'life-admin');
});

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('Invalid transitions', () => {
  it('rejects REPORTED → RESOLVED (skipping the whole workflow)', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'RESOLVED' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects REPORTED → CLOSED', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'CLOSED' });
    expect(response.status).toBe(409);
  });

  it('rejects REPORTED → IN_PROGRESS with no assignment', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' });
    expect(response.status).toBe(409);
  });

  it('rejects a status value outside the enum', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'DEFENESTRATED' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a no-op transition to the current status', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'REPORTED' });
    // A no-op is a bad request rather than an illegal state change: nothing
    // would be recorded in the timeline, so it is rejected before the machine.
    expect(response.status).toBe(400);
    expect(response.body.error.message.toLowerCase()).toContain('already');
  });
});

describe('Reason-gated transitions', () => {
  it('requires a reason to reject an issue', async () => {
    const issue = await createIssue(citizen.session);
    const without = await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'REJECTED' });
    expect(without.status).toBe(400);

    const withReason = await admin.session
      .post(`/api/issues/${issue.id}/status`)
      .send({ status: 'REJECTED', reason: 'Outside municipal jurisdiction — this is a private road.' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data.issue.status).toBe('REJECTED');
  });

  it('requires a reason to put work on hold', async () => {
    const issue = await createIssue(citizen.session);
    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' });

    const without = await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'ON_HOLD' });
    expect(without.status).toBe(400);

    const withReason = await worker.session
      .post(`/api/issues/${issue.id}/status`)
      .send({ status: 'ON_HOLD', reason: 'Waiting for the road-closure permit.' });
    expect(withReason.status).toBe(200);
  });
});

describe('Evidence-gated resolution', () => {
  it('refuses RESOLVED without a resolution photograph', async () => {
    const issue = await createIssue(citizen.session);
    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' });

    const response = await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'RESOLVED' });

    expect(response.status).toBe(400);
    expect(response.body.error.message.toLowerCase()).toContain('resolution photograph');
  });

  it('accepts RESOLVED once evidence has been uploaded', async () => {
    const issue = await createIssue(citizen.session);
    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' });

    const upload = await worker.session
      .post(`/api/issues/${issue.id}/images`)
      .field('type', 'RESOLUTION')
      .attach('images', pngFixture(), 'repair-complete.png');
    expect(upload.status).toBe(201);

    const response = await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'RESOLVED' });
    expect(response.status).toBe(200);
    expect(response.body.data.issue.status).toBe('RESOLVED');
    expect(response.body.data.issue.resolvedAt).toBeTruthy();
  });
});

describe('Full happy path', () => {
  it('walks REPORTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED and records every step', async () => {
    const issue = await createIssue(citizen.session, { title: 'Full lifecycle walkthrough issue' });

    expect((await admin.session.post(`/api/issues/${issue.id}/status`).send({ status: 'UNDER_REVIEW' })).status).toBe(200);

    const assign = await admin.session
      .post(`/api/issues/${issue.id}/assign`)
      .send({ workerId: worker.user.id, note: 'Take the small excavator.' });
    expect(assign.status).toBe(200);
    expect(assign.body.data.issue.status).toBe('ASSIGNED');

    expect((await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' })).status).toBe(200);

    await worker.session
      .post(`/api/issues/${issue.id}/images`)
      .field('type', 'RESOLUTION')
      .attach('images', pngFixture(), 'done.png');

    expect((await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'RESOLVED' })).status).toBe(200);

    // The reporter confirms the fix.
    const close = await citizen.session.post(`/api/issues/${issue.id}/status`).send({ status: 'CLOSED' });
    expect(close.status).toBe(200);
    expect(close.body.data.issue.closedAt).toBeTruthy();

    // The timeline must contain each hop, in order.
    const history = await admin.session.get(`/api/issues/${issue.id}/history`);
    const statuses = (history.body.data.history as { newStatus: string }[]).map((h) => h.newStatus);
    expect(statuses).toEqual(['REPORTED', 'UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  });
});

describe('Reopening', () => {
  it('lets the reporter reopen a resolved issue and allows reassignment afterwards', async () => {
    const issue = await createIssue(citizen.session, { title: 'Reopen and reassign flow issue' });
    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'IN_PROGRESS' });
    await worker.session
      .post(`/api/issues/${issue.id}/images`)
      .field('type', 'RESOLUTION')
      .attach('images', pngFixture(), 'claimed-fix.png');
    await worker.session.post(`/api/issues/${issue.id}/status`).send({ status: 'RESOLVED' });

    const withoutReason = await citizen.session.post(`/api/issues/${issue.id}/status`).send({ status: 'REOPENED' });
    expect(withoutReason.status).toBe(400);

    const reopen = await citizen.session
      .post(`/api/issues/${issue.id}/status`)
      .send({ status: 'REOPENED', reason: 'The patch washed out after the first rain.' });
    expect(reopen.status).toBe(200);

    // Regression guard: entering REOPENED must deactivate the old assignment,
    // otherwise the partial unique index blocks any new one with ALREADY_ASSIGNED.
    const reassign = await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    expect(reassign.status).toBe(200);
    expect(reassign.body.data.issue.status).toBe('ASSIGNED');
  });
});

describe('Assignment', () => {
  it('is atomic: assignment, status, history, notification and audit all land together', async () => {
    const issue = await createIssue(citizen.session);
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`,
      [worker.user.id],
    );

    const response = await admin.session
      .post(`/api/issues/${issue.id}/assign`)
      .send({ workerId: worker.user.id, note: 'Atomicity check.' });
    expect(response.status).toBe(200);

    const [assignment, history, notifications, audits] = await Promise.all([
      pool.query(`SELECT * FROM issue_assignments WHERE issue_id = $1 AND active`, [issue.id]),
      pool.query(`SELECT * FROM issue_status_history WHERE issue_id = $1 AND new_status = 'ASSIGNED'`, [issue.id]),
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`, [worker.user.id]),
      pool.query(`SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'ISSUE_ASSIGNED'`, [issue.id]),
    ]);

    expect(assignment.rowCount).toBe(1);
    expect(history.rowCount).toBe(1);
    expect(Number(notifications.rows[0]!.count)).toBeGreaterThan(Number(before.rows[0]!.count));
    expect(audits.rowCount).toBe(1);
  });

  it('rejects assigning to a non-existent worker and leaves no partial state', async () => {
    const issue = await createIssue(citizen.session);
    const ghost = '00000000-0000-4000-8000-000000000000';

    const response = await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: ghost });
    expect([400, 404]).toContain(response.status);

    // The transaction must have rolled back completely.
    const assignment = await pool.query(`SELECT * FROM issue_assignments WHERE issue_id = $1`, [issue.id]);
    expect(assignment.rowCount).toBe(0);
    const issueRow = await pool.query<{ status: string }>(`SELECT status FROM issues WHERE id = $1`, [issue.id]);
    expect(issueRow.rows[0]!.status).toBe('REPORTED');
  });

  it('rejects assigning to a CITIZEN account', async () => {
    const issue = await createIssue(citizen.session);
    const response = await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: citizen.user.id });
    expect([400, 404, 409]).toContain(response.status);
  });

  it('reassigns cleanly: the previous assignment is deactivated', async () => {
    const secondWorker = await signedInAs('WORKER', 'life-worker2');
    const issue = await createIssue(citizen.session);

    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });
    const reassign = await admin.session
      .post(`/api/issues/${issue.id}/assign`)
      .send({ workerId: secondWorker.user.id });
    expect(reassign.status).toBe(200);

    const active = await pool.query<{ worker_id: string }>(
      `SELECT worker_id FROM issue_assignments WHERE issue_id = $1 AND active`,
      [issue.id],
    );
    // The partial unique index guarantees at most one active assignment.
    expect(active.rowCount).toBe(1);
    expect(active.rows[0]!.worker_id).toBe(secondWorker.user.id);
  });
});

describe('Internal comments', () => {
  it('hides internal staff notes from the reporter but shows them to staff', async () => {
    const issue = await createIssue(citizen.session);
    await admin.session.post(`/api/issues/${issue.id}/assign`).send({ workerId: worker.user.id });

    const note = 'Internal only: the contractor has already been paid for this stretch.';
    const created = await admin.session
      .post(`/api/issues/${issue.id}/comments`)
      .send({ body: note, isInternal: true });
    expect(created.status).toBe(201);

    const asCitizen = await citizen.session.get(`/api/issues/${issue.id}`);
    expect(JSON.stringify(asCitizen.body.data.comments)).not.toContain(note);

    const asWorker = await worker.session.get(`/api/issues/${issue.id}`);
    expect(JSON.stringify(asWorker.body.data.comments)).toContain(note);
  });

  it('does not let a citizen post an internal comment', async () => {
    const issue = await createIssue(citizen.session);
    const response = await citizen.session
      .post(`/api/issues/${issue.id}/comments`)
      .send({ body: 'Trying to hide this from staff', isInternal: true });

    if (response.status === 201) {
      // If accepted, the flag must have been forced to false rather than honoured.
      expect(response.body.data.comment.isInternal).toBe(false);
    } else {
      expect([400, 403]).toContain(response.status);
    }
  });
});
