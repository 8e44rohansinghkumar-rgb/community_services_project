/**
 * Analytics scoping, duplicate detection and the priority engine.
 *
 * The point of these tests is that the numbers are computed from real rows and
 * are scoped correctly per role — a citizen must never see municipality totals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, anyCategoryId, cleanupRun, createIssue, signedInAs, type TestUser } from './helpers';
import { pool } from '../src/db/pool';

let citizen: { session: Session; user: TestUser };
let admin: { session: Session; user: TestUser };
let categoryId: number;

beforeAll(async () => {
  citizen = await signedInAs('CITIZEN', 'stats-citizen');
  admin = await signedInAs('ADMIN', 'stats-admin');
  categoryId = await anyCategoryId();
  // Give the citizen a known number of reports.
  await createIssue(citizen.session, { title: 'Analytics scoping report one' });
  await createIssue(citizen.session, { title: 'Analytics scoping report two' });
});

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('Analytics scoping', () => {
  it("counts only the citizen's own reports for a citizen", async () => {
    const response = await citizen.session.get('/api/analytics/overview');
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM issues WHERE reporter_id = $1 AND deleted_at IS NULL AND NOT is_spam`,
      [citizen.user.id],
    );
    expect(response.body.data.stats.total).toBe(Number(rows[0]!.count));
  });

  it('shows municipality-wide totals to an admin', async () => {
    const citizenView = await citizen.session.get('/api/analytics/overview');
    const adminView = await admin.session.get('/api/analytics/overview');

    expect(adminView.status).toBe(200);
    // A citizen must never see a figure larger than their own slice.
    expect(adminView.body.data.stats.total).toBeGreaterThan(citizenView.body.data.stats.total);
  });

  it('matches the admin total against a direct SQL count', async () => {
    const response = await admin.session.get('/api/analytics/overview');
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM issues WHERE deleted_at IS NULL AND NOT is_spam`,
    );
    expect(response.body.data.stats.total).toBe(Number(rows[0]!.count));
  });

  it('returns a dense time axis with one point per day', async () => {
    const response = await admin.session.get('/api/analytics/issues-over-time?days=14');
    expect(response.status).toBe(200);
    // Gaps would make a chart lie about quiet days.
    expect(response.body.data.series).toHaveLength(14);
    for (const point of response.body.data.series) {
      expect(point).toHaveProperty('date');
      expect(point).toHaveProperty('reported');
      expect(point).toHaveProperty('resolved');
    }
  });

  it('clamps the requested day range', async () => {
    expect((await admin.session.get('/api/analytics/issues-over-time?days=100000')).status).toBe(400);
    expect((await admin.session.get('/api/analytics/issues-over-time?days=1')).status).toBe(400);
  });

  it('breaks down only categories that actually have reports', async () => {
    const response = await admin.session.get('/api/analytics/issues-by-category');
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM issue_categories WHERE is_active`,
    );
    const returned = response.body.data.categories as { total: number; categoryId: number }[];

    // The query uses HAVING COUNT(i.id) > 0, so an unused category is omitted
    // rather than padding the table with zero rows.
    expect(returned.length).toBeGreaterThan(0);
    expect(returned.length).toBeLessThanOrEqual(Number(rows[0]!.count));
    for (const row of returned) expect(row.total).toBeGreaterThan(0);
  });

  it('matches a per-category count against direct SQL', async () => {
    const response = await admin.session.get('/api/analytics/issues-by-category');
    const first = (response.body.data.categories as { categoryId: number; total: number }[])[0]!;

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM issues
        WHERE category_id = $1 AND deleted_at IS NULL AND NOT is_spam`,
      [first.categoryId],
    );
    expect(first.total).toBe(Number(rows[0]!.count));
  });

  it('exports CSV with a header row and no formula injection', async () => {
    const response = await admin.session.get('/api/analytics/export');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text.split('\r\n')[0]).toContain('public_id');

    // Any cell starting with a formula character must have been neutralised.
    for (const line of response.text.split('\r\n').slice(1)) {
      for (const cell of line.split(',')) {
        const unquoted = cell.replace(/^"|"$/g, '');
        if (/^[=+@]/.test(unquoted)) {
          throw new Error(`Unescaped formula cell found: ${cell}`);
        }
      }
    }
  });
});

describe('Duplicate detection', () => {
  it('finds a nearby recent report in the same category', async () => {
    const reporter = await signedInAs('CITIZEN', 'dupe-reporter');
    const lat = 28.41;
    const lng = 77.11;

    await createIssue(reporter.session, {
      title: 'Original pothole near the water tank',
      categoryId,
      latitude: lat,
      longitude: lng,
    });

    // ~40 m away: comfortably inside the 150 m radius.
    const response = await reporter.session.get(
      `/api/issues/duplicate-check?categoryId=${categoryId}&latitude=${lat + 0.00035}&longitude=${lng}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.candidates.length).toBeGreaterThan(0);
    expect(response.body.data.candidates[0].distanceMeters).toBeLessThan(150);
  });

  it('does not flag a report far away as a duplicate', async () => {
    const reporter = await signedInAs('CITIZEN', 'dupe-far');
    await createIssue(reporter.session, {
      title: 'Distant streetlight outage report',
      categoryId,
      latitude: 28.61,
      longitude: 77.31,
    });

    // Roughly 5 km away.
    const response = await reporter.session.get(
      `/api/issues/duplicate-check?categoryId=${categoryId}&latitude=28.655&longitude=77.31`,
    );

    expect(response.status).toBe(200);
    const near = (response.body.data.candidates as { distanceMeters: number }[]).filter(
      (c) => c.distanceMeters < 150,
    );
    expect(near).toHaveLength(0);
  });

  it('blocks an identical resubmission by the same reporter', async () => {
    const reporter = await signedInAs('CITIZEN', 'dupe-same');
    const payload = {
      title: 'Exactly the same accidental double submission',
      latitude: 28.33,
      longitude: 77.23,
      categoryId,
    };
    await createIssue(reporter.session, payload);

    // A re-clicked submit button must not create a second row.
    await expect(createIssue(reporter.session, payload)).rejects.toThrow(/DUPLICATE_SUBMISSION/);
  });

  it('validates duplicate-check parameters', async () => {
    const response = await citizen.session.get('/api/issues/duplicate-check?categoryId=abc&latitude=999');
    expect(response.status).toBe(400);
  });
});

describe('Priority engine', () => {
  it('derives an official priority rather than trusting the citizen', async () => {
    const reporter = await signedInAs('CITIZEN', 'prio-reporter');
    const issue = await createIssue(reporter.session, {
      title: 'Priority derivation check issue',
      citizenSeverity: 'LOW',
    });

    const detail = await reporter.session.get(`/api/issues/${issue.id}`);
    expect(detail.status).toBe(200);
    // Both are recorded; they are different fields for a reason.
    expect(detail.body.data.issue.citizenSeverity).toBe('LOW');
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(detail.body.data.issue.officialPriority);
  });

  it('rates an open manhole above a low-severity cosmetic report', async () => {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM issue_categories WHERE slug = 'open-manhole' LIMIT 1`,
    );
    if (!rows[0]) return; // category not seeded in this environment

    const reporter = await signedInAs('CITIZEN', 'prio-manhole');
    const manhole = await createIssue(reporter.session, {
      title: 'Open manhole outside the school gate',
      categoryId: rows[0].id,
      citizenSeverity: 'LOW',
      latitude: 28.71,
      longitude: 77.41,
    });

    const detail = await reporter.session.get(`/api/issues/${manhole.id}`);
    // A safety hazard must outrank the citizen's own modest rating.
    expect(['HIGH', 'CRITICAL']).toContain(detail.body.data.issue.officialPriority);
  });

  it('lets an admin override the calculated priority', async () => {
    const issue = await createIssue(citizen.session, { title: 'Priority override target issue' });
    const response = await admin.session
      .patch(`/api/issues/${issue.id}/priority`)
      .send({ priority: 'CRITICAL', reason: 'Escalated after a site visit.' });

    expect(response.status).toBe(200);
    expect(response.body.data.issue.officialPriority).toBe('CRITICAL');

    const audit = await pool.query(
      `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'ISSUE_PRIORITY_CHANGED'`,
      [issue.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});

describe('Search and filtering', () => {
  it('finds an issue by a distinctive word in its title', async () => {
    const marker = `zqxwvu${Date.now().toString(36)}`;
    await createIssue(citizen.session, { title: `Unique marker ${marker} in this title` });

    const response = await citizen.session.get(`/api/issues?search=${marker}`);
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('filters by status', async () => {
    const response = await admin.session.get('/api/issues?status=REPORTED');
    expect(response.status).toBe(200);
    for (const issue of response.body.data as { status: string }[]) {
      expect(issue.status).toBe('REPORTED');
    }
  });

  it('filters by several statuses at once', async () => {
    const response = await admin.session.get('/api/issues?status=REPORTED,UNDER_REVIEW');
    expect(response.status).toBe(200);
    for (const issue of response.body.data as { status: string }[]) {
      expect(['REPORTED', 'UNDER_REVIEW']).toContain(issue.status);
    }
  });

  it('rejects an unknown status value', async () => {
    expect((await admin.session.get('/api/issues?status=IMAGINARY')).status).toBe(400);
  });

  it('filters to open issues only', async () => {
    const response = await admin.session.get('/api/issues?onlyOpen=true');
    expect(response.status).toBe(200);
    for (const issue of response.body.data as { status: string }[]) {
      expect(['CLOSED', 'REJECTED']).not.toContain(issue.status);
    }
  });
});
