/**
 * Analytics.
 *
 * Every figure is computed by PostgreSQL aggregation. Nothing loads issue rows
 * into Node to count them (spec §45). Role scoping is applied inside the SQL so
 * a citizen's dashboard can only ever aggregate their own reports.
 */
import { pool, type Executor } from '../../db/pool';
import type { AuthUser, IssueStatus, Severity } from '../../types';

export interface OverviewStats {
  total: number;
  open: number;
  reported: number;
  underReview: number;
  assigned: number;
  inProgress: number;
  onHold: number;
  resolved: number;
  closed: number;
  rejected: number;
  reopened: number;
  critical: number;
  newLast7Days: number;
  resolvedLast7Days: number;
  averageResolutionHours: number | null;
  medianResolutionHours: number | null;
}

/**
 * Scope fragment + params for the caller's role.
 * Citizens see only their own issues; workers only issues assigned to them.
 */
function scopeFor(viewer: AuthUser): { clause: string; params: unknown[] } {
  if (viewer.role === 'CITIZEN') {
    return { clause: 'AND i.reporter_id = $1', params: [viewer.id] };
  }
  if (viewer.role === 'WORKER') {
    return {
      clause: 'AND EXISTS (SELECT 1 FROM issue_assignments a WHERE a.issue_id = i.id AND a.worker_id = $1)',
      params: [viewer.id],
    };
  }
  return { clause: '', params: [] };
}

export async function overview(viewer: AuthUser, db: Executor = pool): Promise<OverviewStats> {
  const { clause, params } = scopeFor(viewer);

  // One pass over the filtered set; FILTER clauses avoid nine separate queries.
  const { rows } = await db.query<Record<string, string | null>>(
    `SELECT
       COUNT(*)                                                        AS total,
       COUNT(*) FILTER (WHERE i.status NOT IN ('CLOSED','REJECTED'))   AS open,
       COUNT(*) FILTER (WHERE i.status = 'REPORTED')                   AS reported,
       COUNT(*) FILTER (WHERE i.status = 'UNDER_REVIEW')               AS under_review,
       COUNT(*) FILTER (WHERE i.status = 'ASSIGNED')                   AS assigned,
       COUNT(*) FILTER (WHERE i.status = 'IN_PROGRESS')                AS in_progress,
       COUNT(*) FILTER (WHERE i.status = 'ON_HOLD')                    AS on_hold,
       COUNT(*) FILTER (WHERE i.status = 'RESOLVED')                   AS resolved,
       COUNT(*) FILTER (WHERE i.status = 'CLOSED')                     AS closed,
       COUNT(*) FILTER (WHERE i.status = 'REJECTED')                   AS rejected,
       COUNT(*) FILTER (WHERE i.status = 'REOPENED')                   AS reopened,
       COUNT(*) FILTER (WHERE i.official_priority = 'CRITICAL'
                          AND i.status NOT IN ('CLOSED','REJECTED'))   AS critical,
       COUNT(*) FILTER (WHERE i.created_at > now() - interval '7 days') AS new_last_7,
       COUNT(*) FILTER (WHERE i.resolved_at > now() - interval '7 days') AS resolved_last_7,
       AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 3600)
         FILTER (WHERE i.resolved_at IS NOT NULL)                      AS avg_resolution_hours,
       PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 3600
       ) FILTER (WHERE i.resolved_at IS NOT NULL)                      AS median_resolution_hours
     FROM issues i
     WHERE i.deleted_at IS NULL AND NOT i.is_spam ${clause}`,
    params,
  );

  const row = rows[0];
  const num = (key: string): number => Number(row[key] ?? 0);
  const maybe = (key: string): number | null =>
    row[key] === null || row[key] === undefined ? null : Math.round(Number(row[key]) * 10) / 10;

  return {
    total: num('total'),
    open: num('open'),
    reported: num('reported'),
    underReview: num('under_review'),
    assigned: num('assigned'),
    inProgress: num('in_progress'),
    onHold: num('on_hold'),
    resolved: num('resolved'),
    closed: num('closed'),
    rejected: num('rejected'),
    reopened: num('reopened'),
    critical: num('critical'),
    newLast7Days: num('new_last_7'),
    resolvedLast7Days: num('resolved_last_7'),
    averageResolutionHours: maybe('avg_resolution_hours'),
    medianResolutionHours: maybe('median_resolution_hours'),
  };
}

export interface CategoryBreakdown {
  categoryId: number;
  categoryName: string;
  slug: string;
  total: number;
  open: number;
  resolved: number;
  averageResolutionHours: number | null;
}

export async function byCategory(viewer: AuthUser, db: Executor = pool): Promise<CategoryBreakdown[]> {
  const { clause, params } = scopeFor(viewer);
  const { rows } = await db.query<{
    category_id: number;
    category_name: string;
    slug: string;
    total: string;
    open: string;
    resolved: string;
    avg_hours: string | null;
  }>(
    `SELECT c.id AS category_id, c.name AS category_name, c.slug,
            COUNT(i.id) AS total,
            COUNT(i.id) FILTER (WHERE i.status NOT IN ('CLOSED','REJECTED')) AS open,
            COUNT(i.id) FILTER (WHERE i.status IN ('RESOLVED','CLOSED')) AS resolved,
            AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 3600)
              FILTER (WHERE i.resolved_at IS NOT NULL) AS avg_hours
       FROM issue_categories c
       LEFT JOIN issues i
         ON i.category_id = c.id AND i.deleted_at IS NULL AND NOT i.is_spam ${clause}
      GROUP BY c.id, c.name, c.slug
      HAVING COUNT(i.id) > 0
      ORDER BY COUNT(i.id) DESC`,
    params,
  );

  return rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    slug: row.slug,
    total: Number(row.total),
    open: Number(row.open),
    resolved: Number(row.resolved),
    averageResolutionHours: row.avg_hours === null ? null : Math.round(Number(row.avg_hours) * 10) / 10,
  }));
}

export async function byStatus(
  viewer: AuthUser,
  db: Executor = pool,
): Promise<{ status: IssueStatus; count: number }[]> {
  const { clause, params } = scopeFor(viewer);
  const { rows } = await db.query<{ status: IssueStatus; count: string }>(
    `SELECT i.status, COUNT(*) AS count
       FROM issues i
      WHERE i.deleted_at IS NULL AND NOT i.is_spam ${clause}
      GROUP BY i.status
      ORDER BY COUNT(*) DESC`,
    params,
  );
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

export async function bySeverity(
  viewer: AuthUser,
  db: Executor = pool,
): Promise<{ priority: Severity; count: number }[]> {
  const { clause, params } = scopeFor(viewer);
  const { rows } = await db.query<{ priority: Severity; count: string }>(
    `SELECT i.official_priority AS priority, COUNT(*) AS count
       FROM issues i
      WHERE i.deleted_at IS NULL AND NOT i.is_spam ${clause}
      GROUP BY i.official_priority
      ORDER BY i.official_priority DESC`,
    params,
  );
  return rows.map((r) => ({ priority: r.priority, count: Number(r.count) }));
}

export interface TimeSeriesPoint {
  date: string;
  reported: number;
  resolved: number;
}

/**
 * Daily counts over a window. generate_series produces a dense axis so the
 * chart has no gaps on quiet days (no zero-filling needed in JavaScript).
 */
export async function overTime(
  viewer: AuthUser,
  days: number,
  db: Executor = pool,
): Promise<TimeSeriesPoint[]> {
  const { clause, params } = scopeFor(viewer);
  const dayParam = `$${params.length + 1}`;

  const { rows } = await db.query<{ day: Date; reported: string; resolved: string }>(
    `WITH span AS (
       SELECT generate_series(
         date_trunc('day', now()) - ((${dayParam}::int - 1) || ' days')::interval,
         date_trunc('day', now()),
         interval '1 day'
       ) AS day
     )
     SELECT s.day,
            COUNT(r.id) AS reported,
            COUNT(v.id) AS resolved
       FROM span s
       LEFT JOIN issues r
         ON date_trunc('day', r.created_at) = s.day
        AND r.deleted_at IS NULL AND NOT r.is_spam
        ${clause.replace(/\bi\./g, 'r.')}
       LEFT JOIN issues v
         ON date_trunc('day', v.resolved_at) = s.day
        AND v.deleted_at IS NULL AND NOT v.is_spam
        ${clause.replace(/\bi\./g, 'v.')}
      GROUP BY s.day
      ORDER BY s.day ASC`,
    [...params, days],
  );

  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    reported: Number(row.reported),
    resolved: Number(row.resolved),
  }));
}

export interface WorkerWorkload {
  workerId: string;
  workerName: string;
  active: number;
  inProgress: number;
  completed: number;
  averageResolutionHours: number | null;
}

export async function workerWorkload(db: Executor = pool): Promise<WorkerWorkload[]> {
  const { rows } = await db.query<{
    worker_id: string;
    worker_name: string;
    active: string;
    in_progress: string;
    completed: string;
    avg_hours: string | null;
  }>(
    `SELECT u.id AS worker_id, u.name AS worker_name,
            COUNT(*) FILTER (WHERE a.active) AS active,
            COUNT(*) FILTER (WHERE a.active AND i.status = 'IN_PROGRESS') AS in_progress,
            COUNT(*) FILTER (WHERE a.completed_at IS NOT NULL) AS completed,
            AVG(EXTRACT(EPOCH FROM (a.completed_at - a.assigned_at)) / 3600)
              FILTER (WHERE a.completed_at IS NOT NULL) AS avg_hours
       FROM users u
       LEFT JOIN issue_assignments a ON a.worker_id = u.id
       LEFT JOIN issues i ON i.id = a.issue_id AND i.deleted_at IS NULL
      WHERE u.role = 'WORKER' AND u.is_active
      GROUP BY u.id, u.name
      ORDER BY COUNT(*) FILTER (WHERE a.active) DESC, u.name ASC`,
  );

  return rows.map((row) => ({
    workerId: row.worker_id,
    workerName: row.worker_name,
    active: Number(row.active),
    inProgress: Number(row.in_progress),
    completed: Number(row.completed),
    averageResolutionHours: row.avg_hours === null ? null : Math.round(Number(row.avg_hours) * 10) / 10,
  }));
}

export interface Hotspot {
  latitude: number;
  longitude: number;
  count: number;
  topCategory: string;
}

/**
 * Geographic clustering by rounding coordinates to ~1.1 km cells. Crude but
 * effective, index-friendly, and requires no PostGIS.
 */
export async function hotspots(limit: number, db: Executor = pool): Promise<Hotspot[]> {
  const { rows } = await db.query<{
    lat: string;
    lng: string;
    count: string;
    top_category: string;
  }>(
    `SELECT round(i.latitude, 2)  AS lat,
            round(i.longitude, 2) AS lng,
            COUNT(*) AS count,
            mode() WITHIN GROUP (ORDER BY c.name) AS top_category
       FROM issues i
       JOIN issue_categories c ON c.id = i.category_id
      WHERE i.deleted_at IS NULL AND NOT i.is_spam
        AND i.status NOT IN ('CLOSED', 'REJECTED')
      GROUP BY round(i.latitude, 2), round(i.longitude, 2)
     HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    latitude: Number(row.lat),
    longitude: Number(row.lng),
    count: Number(row.count),
    topCategory: row.top_category,
  }));
}

/** Rows for CSV export. Admin-only; the route records an audit entry. */
export async function exportRows(
  filters: { from?: string; to?: string; status?: IssueStatus },
  db: Executor = pool,
): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query(
    `SELECT i.public_id, i.title, c.name AS category, i.status,
            i.citizen_severity, i.official_priority,
            i.latitude, i.longitude, i.address, i.landmark,
            w.name AS assigned_worker,
            i.created_at, i.resolved_at, i.closed_at,
            EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 3600 AS resolution_hours
       FROM issues i
       JOIN issue_categories c ON c.id = i.category_id
       LEFT JOIN LATERAL (
         SELECT worker_id FROM issue_assignments WHERE issue_id = i.id AND active LIMIT 1
       ) a ON true
       LEFT JOIN users w ON w.id = a.worker_id
      WHERE i.deleted_at IS NULL
        AND ($1::timestamptz IS NULL OR i.created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR i.created_at <= $2::timestamptz)
        AND ($3::issue_status IS NULL OR i.status = $3::issue_status)
      ORDER BY i.created_at DESC
      LIMIT 10000`,
    [filters.from ?? null, filters.to ?? null, filters.status ?? null],
  );
  return rows;
}
