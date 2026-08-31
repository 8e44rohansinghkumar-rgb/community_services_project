/**
 * Issue data access.
 *
 * Every value reaching SQL is a bound parameter. Filter/sort options that must
 * appear in the SQL text (column names, directions) are resolved through
 * whitelist maps — a client string is never concatenated into a query.
 */
import { pool, type Executor } from '../../db/pool';
import type {
  Assignment,
  Issue,
  IssueComment,
  IssueImage,
  IssueStatus,
  Paginated,
  Severity,
  StatusHistoryEntry,
  UserRole,
  ImageType,
} from '../../types';

/* ------------------------------------------------------------------ *
 * Row shapes and mappers
 * ------------------------------------------------------------------ */

interface IssueRow {
  id: string;
  public_id: string;
  reporter_id: string;
  reporter_name: string | null;
  reporter_email: string | null;
  title: string;
  description: string;
  category_id: number;
  category_name: string | null;
  category_slug: string | null;
  citizen_severity: Severity;
  official_priority: Severity;
  status: IssueStatus;
  latitude: string;
  longitude: string;
  address: string | null;
  landmark: string | null;
  is_public: boolean;
  is_spam: boolean;
  duplicate_of_id: string | null;
  duplicate_count: number;
  assigned_worker_id: string | null;
  assigned_worker_name: string | null;
  image_count?: string;
  comment_count?: string;
  resolved_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    publicId: row.public_id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reporterEmail: row.reporter_email,
    title: row.title,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name ?? undefined,
    categorySlug: row.category_slug ?? undefined,
    citizenSeverity: row.citizen_severity,
    officialPriority: row.official_priority,
    status: row.status,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address,
    landmark: row.landmark,
    isPublic: row.is_public,
    isSpam: row.is_spam,
    duplicateOfId: row.duplicate_of_id,
    duplicateCount: row.duplicate_count,
    assignedWorkerId: row.assigned_worker_id,
    assignedWorkerName: row.assigned_worker_name,
    imageCount: row.image_count !== undefined ? Number(row.image_count) : undefined,
    commentCount: row.comment_count !== undefined ? Number(row.comment_count) : undefined,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Shared projection. The active-assignment lookup is a LATERAL join rather than
 * a correlated subquery per column, and counts come from LATERAL aggregates —
 * this keeps list queries to a single round trip (no N+1).
 */
const ISSUE_SELECT = `
  SELECT i.id, i.public_id, i.reporter_id, r.name AS reporter_name, r.email AS reporter_email,
         i.title, i.description, i.category_id, c.name AS category_name, c.slug AS category_slug,
         i.citizen_severity, i.official_priority, i.status,
         i.latitude, i.longitude, i.address, i.landmark,
         i.is_public, i.is_spam, i.duplicate_of_id, i.duplicate_count,
         a.worker_id AS assigned_worker_id, w.name AS assigned_worker_name,
         img.count AS image_count, cmt.count AS comment_count,
         i.resolved_at, i.closed_at, i.created_at, i.updated_at
    FROM issues i
    JOIN users r ON r.id = i.reporter_id
    JOIN issue_categories c ON c.id = i.category_id
    LEFT JOIN LATERAL (
      SELECT worker_id FROM issue_assignments
       WHERE issue_id = i.id AND active
       LIMIT 1
    ) a ON true
    LEFT JOIN users w ON w.id = a.worker_id
    LEFT JOIN LATERAL (SELECT COUNT(*) AS count FROM issue_images WHERE issue_id = i.id) img ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) AS count FROM issue_comments WHERE issue_id = i.id) cmt ON true
`;

/* ------------------------------------------------------------------ *
 * Create / read
 * ------------------------------------------------------------------ */

export interface CreateIssueInput {
  reporterId: string;
  title: string;
  description: string;
  categoryId: number;
  citizenSeverity: Severity;
  officialPriority: Severity;
  latitude: number;
  longitude: number;
  address?: string | null;
  landmark?: string | null;
  isPublic: boolean;
}

export async function createIssue(input: CreateIssueInput, db: Executor = pool): Promise<Issue> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO issues
       (reporter_id, title, description, category_id, citizen_severity,
        official_priority, latitude, longitude, address, landmark, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.reporterId,
      input.title,
      input.description,
      input.categoryId,
      input.citizenSeverity,
      input.officialPriority,
      input.latitude,
      input.longitude,
      input.address ?? null,
      input.landmark ?? null,
      input.isPublic,
    ],
  );
  const created = await findById(rows[0].id, db);
  if (!created) throw new Error('Issue creation failed unexpectedly');
  return created;
}

export async function findById(id: string, db: Executor = pool): Promise<Issue | null> {
  const { rows } = await db.query<IssueRow>(
    `${ISSUE_SELECT} WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id],
  );
  return rows[0] ? mapIssue(rows[0]) : null;
}

export async function findByPublicId(publicId: string, db: Executor = pool): Promise<Issue | null> {
  const { rows } = await db.query<IssueRow>(
    `${ISSUE_SELECT} WHERE i.public_id = $1 AND i.deleted_at IS NULL`,
    [publicId],
  );
  return rows[0] ? mapIssue(rows[0]) : null;
}

/** Row lock for status/assignment changes — serialises concurrent mutations. */
export async function lockIssue(
  id: string,
  db: Executor,
): Promise<{ id: string; status: IssueStatus; reporterId: string; officialPriority: Severity } | null> {
  const { rows } = await db.query<{
    id: string;
    status: IssueStatus;
    reporter_id: string;
    official_priority: Severity;
  }>(
    `SELECT id, status, reporter_id, official_priority
       FROM issues
      WHERE id = $1 AND deleted_at IS NULL
      FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  return row
    ? { id: row.id, status: row.status, reporterId: row.reporter_id, officialPriority: row.official_priority }
    : null;
}

/* ------------------------------------------------------------------ *
 * Listing: filters, search, sorting, pagination
 * ------------------------------------------------------------------ */

/** Whitelisted sort columns — the ONLY strings ever interpolated into ORDER BY. */
const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'i.created_at',
  updatedAt: 'i.updated_at',
  // Enum ordering is by declaration order (LOW < MEDIUM < HIGH < CRITICAL), so
  // DESC gives the most urgent first.
  priority: 'i.official_priority',
  status: 'i.status',
  title: 'i.title',
  resolvedAt: 'i.resolved_at',
};

export interface IssueFilters {
  status?: IssueStatus[];
  categoryIds?: number[];
  priority?: Severity[];
  reporterId?: string;
  workerId?: string;
  from?: string;
  to?: string;
  search?: string;
  isPublic?: boolean;
  includeSpam?: boolean;
  /** Bounding-box map filter. */
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  onlyOpen?: boolean;
  sortBy?: keyof typeof SORT_COLUMNS;
  sortDir?: 'asc' | 'desc';
  page: number;
  limit: number;
}

interface BuiltFilters {
  where: string;
  params: unknown[];
}

function buildFilters(filters: IssueFilters, startIndex = 0): BuiltFilters {
  const conditions: string[] = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  const next = (): number => startIndex + params.length;

  if (filters.status?.length) {
    params.push(filters.status);
    conditions.push(`i.status = ANY($${next()}::issue_status[])`);
  }
  if (filters.categoryIds?.length) {
    params.push(filters.categoryIds);
    conditions.push(`i.category_id = ANY($${next()}::int[])`);
  }
  if (filters.priority?.length) {
    params.push(filters.priority);
    conditions.push(`i.official_priority = ANY($${next()}::severity[])`);
  }
  if (filters.reporterId) {
    params.push(filters.reporterId);
    conditions.push(`i.reporter_id = $${next()}`);
  }
  if (filters.workerId) {
    params.push(filters.workerId);
    conditions.push(
      `EXISTS (SELECT 1 FROM issue_assignments ia WHERE ia.issue_id = i.id AND ia.worker_id = $${next()} AND ia.active)`,
    );
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`i.created_at >= $${next()}::timestamptz`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`i.created_at <= $${next()}::timestamptz`);
  }
  if (filters.isPublic !== undefined) {
    params.push(filters.isPublic);
    conditions.push(`i.is_public = $${next()}`);
  }
  if (!filters.includeSpam) {
    conditions.push('NOT i.is_spam');
  }
  if (filters.onlyOpen) {
    conditions.push(`i.status NOT IN ('CLOSED', 'REJECTED')`);
  }
  if (filters.bbox) {
    params.push(filters.bbox.minLat, filters.bbox.maxLat, filters.bbox.minLng, filters.bbox.maxLng);
    const base = startIndex + params.length - 3;
    conditions.push(
      `i.latitude BETWEEN $${base} AND $${base + 1} AND i.longitude BETWEEN $${base + 2} AND $${base + 3}`,
    );
  }
  if (filters.search) {
    const term = filters.search.trim();
    params.push(term);
    const searchParam = next();
    // Full-text over the generated tsvector (GIN indexed), plus a bounded
    // prefix match so partial public IDs like "CIV-2026-0001" still resolve.
    params.push(`${term.toUpperCase()}%`);
    const prefixParam = next();
    conditions.push(
      `(i.search_vector @@ websearch_to_tsquery('english', $${searchParam}) OR i.public_id LIKE $${prefixParam})`,
    );
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export async function listIssues(filters: IssueFilters, db: Executor = pool): Promise<Paginated<Issue>> {
  const { where, params } = buildFilters(filters);

  const sortColumn = SORT_COLUMNS[filters.sortBy ?? 'createdAt'] ?? SORT_COLUMNS.createdAt;
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const offset = (filters.page - 1) * filters.limit;

  // COUNT(*) OVER() gives the total in the same scan instead of a second query.
  const { rows } = await db.query<IssueRow & { total: string }>(
    `${ISSUE_SELECT.replace('SELECT ', 'SELECT COUNT(*) OVER() AS total, ')}
     ${where}
     ORDER BY ${sortColumn} ${sortDir} NULLS LAST, i.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  );

  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    rows: rows.map(mapIssue),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export async function updateStatus(
  id: string,
  status: IssueStatus,
  db: Executor,
): Promise<void> {
  // Every reference to $2 is cast explicitly: without the casts PostgreSQL
  // deduces `issue_status` from the SET clause but `text` from the IN (...)
  // list and rejects the statement with "inconsistent types deduced".
  await db.query(
    `UPDATE issues
        SET status = $2::issue_status,
            resolved_at = CASE
              WHEN $2::issue_status = 'RESOLVED' THEN now()
              WHEN $2::issue_status IN ('REOPENED', 'ASSIGNED', 'IN_PROGRESS') THEN NULL
              ELSE resolved_at END,
            closed_at = CASE
              WHEN $2::issue_status = 'CLOSED' THEN now()
              WHEN $2::issue_status = 'REOPENED' THEN NULL
              ELSE closed_at END
      WHERE id = $1`,
    [id, status],
  );
}

export async function updatePriority(id: string, priority: Severity, db: Executor = pool): Promise<void> {
  await db.query('UPDATE issues SET official_priority = $2 WHERE id = $1', [id, priority]);
}

export async function updateEditableFields(
  id: string,
  input: { title?: string; description?: string; landmark?: string | null; isPublic?: boolean },
  db: Executor = pool,
): Promise<Issue | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE issues
        SET title       = COALESCE($2, title),
            description = COALESCE($3, description),
            landmark    = CASE WHEN $4::boolean THEN $5 ELSE landmark END,
            is_public   = COALESCE($6, is_public)
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [
      id,
      input.title ?? null,
      input.description ?? null,
      input.landmark !== undefined,
      input.landmark ?? null,
      input.isPublic ?? null,
    ],
  );
  return rows[0] ? findById(rows[0].id, db) : null;
}

export async function setSpam(id: string, isSpam: boolean, db: Executor = pool): Promise<void> {
  await db.query('UPDATE issues SET is_spam = $2 WHERE id = $1', [id, isSpam]);
}

export async function softDelete(id: string, db: Executor = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    'UPDATE issues SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function linkDuplicate(id: string, duplicateOfId: string, db: Executor): Promise<void> {
  await db.query('UPDATE issues SET duplicate_of_id = $2 WHERE id = $1', [id, duplicateOfId]);
  await db.query('UPDATE issues SET duplicate_count = duplicate_count + 1 WHERE id = $1', [duplicateOfId]);
}

/* ------------------------------------------------------------------ *
 * Duplicate detection
 * ------------------------------------------------------------------ */

export interface DuplicateCandidate {
  id: string;
  publicId: string;
  title: string;
  status: IssueStatus;
  categoryName: string;
  distanceMeters: number;
  createdAt: Date;
  duplicateCount: number;
}

/**
 * Nearby recent reports in the same category.
 *
 * Two-stage for performance: a bounding-box prefilter that can use the
 * (latitude, longitude) index, then an exact Haversine distance. Plain SQL — no
 * PostGIS needed at this scale (see docs/architecture.md §8).
 */
export async function findDuplicateCandidates(
  input: {
    categoryId: number;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    windowDays: number;
    excludeIssueId?: string;
    limit?: number;
  },
  db: Executor = pool,
): Promise<DuplicateCandidate[]> {
  // Degrees of latitude are ~111.32 km everywhere; longitude shrinks by cos(lat).
  const latDelta = input.radiusMeters / 111_320;
  const cosLat = Math.max(0.01, Math.cos((input.latitude * Math.PI) / 180));
  const lngDelta = input.radiusMeters / (111_320 * cosLat);

  const { rows } = await db.query<{
    id: string;
    public_id: string;
    title: string;
    status: IssueStatus;
    category_name: string;
    distance_meters: string;
    created_at: Date;
    duplicate_count: number;
  }>(
    `WITH candidates AS (
       SELECT i.id, i.public_id, i.title, i.status, c.name AS category_name,
              i.created_at, i.duplicate_count,
              6371000 * 2 * asin(sqrt(
                power(sin(radians(i.latitude - $2::numeric) / 2), 2) +
                cos(radians($2::numeric)) * cos(radians(i.latitude)) *
                power(sin(radians(i.longitude - $3::numeric) / 2), 2)
              )) AS distance_meters
         FROM issues i
         JOIN issue_categories c ON c.id = i.category_id
        WHERE i.category_id = $1
          AND i.deleted_at IS NULL
          AND NOT i.is_spam
          AND i.status NOT IN ('CLOSED', 'REJECTED')
          AND i.created_at > now() - ($6 || ' days')::interval
          AND i.latitude  BETWEEN $2::numeric - $4::numeric AND $2::numeric + $4::numeric
          AND i.longitude BETWEEN $3::numeric - $5::numeric AND $3::numeric + $5::numeric
          AND ($7::uuid IS NULL OR i.id <> $7::uuid)
     )
     SELECT * FROM candidates
      WHERE distance_meters <= $8
      ORDER BY distance_meters ASC
      LIMIT $9`,
    [
      input.categoryId,
      input.latitude,
      input.longitude,
      latDelta,
      lngDelta,
      String(input.windowDays),
      input.excludeIssueId ?? null,
      input.radiusMeters,
      input.limit ?? 5,
    ],
  );

  return rows.map((row) => ({
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    status: row.status,
    categoryName: row.category_name,
    distanceMeters: Math.round(Number(row.distance_meters)),
    createdAt: row.created_at,
    duplicateCount: row.duplicate_count,
  }));
}

/** Exact-repeat guard: same reporter, same title, same category, very recent. */
export async function findRecentIdenticalSubmission(
  input: { reporterId: string; title: string; categoryId: number; withinMinutes: number },
  db: Executor = pool,
): Promise<{ id: string; publicId: string } | null> {
  const { rows } = await db.query<{ id: string; public_id: string }>(
    `SELECT id, public_id
       FROM issues
      WHERE reporter_id = $1
        AND lower(btrim(title)) = lower(btrim($2))
        AND category_id = $3
        AND deleted_at IS NULL
        AND created_at > now() - ($4 || ' minutes')::interval
      LIMIT 1`,
    [input.reporterId, input.title, input.categoryId, String(input.withinMinutes)],
  );
  return rows[0] ? { id: rows[0].id, publicId: rows[0].public_id } : null;
}

/* ------------------------------------------------------------------ *
 * Status history
 * ------------------------------------------------------------------ */

export async function addStatusHistory(
  input: {
    issueId: string;
    previousStatus: IssueStatus | null;
    newStatus: IssueStatus;
    changedBy: string | null;
    reason?: string | null;
  },
  db: Executor,
): Promise<void> {
  await db.query(
    `INSERT INTO issue_status_history (issue_id, previous_status, new_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.issueId, input.previousStatus, input.newStatus, input.changedBy, input.reason ?? null],
  );
}

export async function listStatusHistory(issueId: string, db: Executor = pool): Promise<StatusHistoryEntry[]> {
  const { rows } = await db.query<{
    id: string;
    issue_id: string;
    previous_status: IssueStatus | null;
    new_status: IssueStatus;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_by_role: UserRole | null;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT h.id, h.issue_id, h.previous_status, h.new_status, h.changed_by,
            u.name AS changed_by_name, u.role AS changed_by_role, h.reason, h.created_at
       FROM issue_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.issue_id = $1
      ORDER BY h.created_at ASC, h.id ASC`,
    [issueId],
  );

  return rows.map((row) => ({
    id: String(row.id),
    issueId: row.issue_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name,
    changedByRole: row.changed_by_role,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

export async function deactivateAssignments(issueId: string, db: Executor): Promise<void> {
  await db.query(
    `UPDATE issue_assignments
        SET active = false, unassigned_at = now()
      WHERE issue_id = $1 AND active`,
    [issueId],
  );
}

export async function createAssignment(
  input: { issueId: string; workerId: string; assignedBy: string; note?: string | null },
  db: Executor,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO issue_assignments (issue_id, worker_id, assigned_by, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.issueId, input.workerId, input.assignedBy, input.note ?? null],
  );
  return rows[0].id;
}

export async function findActiveAssignment(
  issueId: string,
  db: Executor = pool,
): Promise<{ id: string; workerId: string } | null> {
  const { rows } = await db.query<{ id: string; worker_id: string }>(
    'SELECT id, worker_id FROM issue_assignments WHERE issue_id = $1 AND active LIMIT 1',
    [issueId],
  );
  return rows[0] ? { id: rows[0].id, workerId: rows[0].worker_id } : null;
}

export async function isWorkerAssigned(
  issueId: string,
  workerId: string,
  db: Executor = pool,
): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM issue_assignments WHERE issue_id = $1 AND worker_id = $2 AND active',
    [issueId, workerId],
  );
  return rows.length > 0;
}

/** Includes past assignments — a worker keeps read access to their history. */
export async function hasWorkerEverBeenAssigned(
  issueId: string,
  workerId: string,
  db: Executor = pool,
): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM issue_assignments WHERE issue_id = $1 AND worker_id = $2 LIMIT 1',
    [issueId, workerId],
  );
  return rows.length > 0;
}

export async function listAssignments(issueId: string, db: Executor = pool): Promise<Assignment[]> {
  const { rows } = await db.query<{
    id: string;
    issue_id: string;
    worker_id: string;
    worker_name: string;
    assigned_by: string | null;
    assigned_by_name: string | null;
    note: string | null;
    assigned_at: Date;
    unassigned_at: Date | null;
    accepted_at: Date | null;
    completed_at: Date | null;
    active: boolean;
  }>(
    `SELECT a.id, a.issue_id, a.worker_id, w.name AS worker_name, a.assigned_by,
            b.name AS assigned_by_name, a.note, a.assigned_at, a.unassigned_at,
            a.accepted_at, a.completed_at, a.active
       FROM issue_assignments a
       JOIN users w ON w.id = a.worker_id
       LEFT JOIN users b ON b.id = a.assigned_by
      WHERE a.issue_id = $1
      ORDER BY a.assigned_at DESC`,
    [issueId],
  );

  return rows.map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    assignedBy: row.assigned_by,
    assignedByName: row.assigned_by_name,
    note: row.note,
    assignedAt: row.assigned_at,
    unassignedAt: row.unassigned_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    active: row.active,
  }));
}

export async function markAssignmentAccepted(issueId: string, workerId: string, db: Executor): Promise<void> {
  await db.query(
    `UPDATE issue_assignments
        SET accepted_at = COALESCE(accepted_at, now())
      WHERE issue_id = $1 AND worker_id = $2 AND active`,
    [issueId, workerId],
  );
}

export async function markAssignmentCompleted(issueId: string, db: Executor): Promise<void> {
  await db.query(
    `UPDATE issue_assignments
        SET completed_at = now()
      WHERE issue_id = $1 AND active AND completed_at IS NULL`,
    [issueId],
  );
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

export async function addImage(
  input: {
    issueId: string;
    uploadedBy: string;
    storageKey: string;
    originalName: string | null;
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    type: ImageType;
  },
  db: Executor = pool,
): Promise<IssueImage> {
  const { rows } = await db.query<{
    id: string;
    issue_id: string;
    uploaded_by: string;
    original_name: string | null;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    type: ImageType;
    created_at: Date;
  }>(
    `INSERT INTO issue_images
       (issue_id, uploaded_by, storage_key, original_name, mime_type, size_bytes, width, height, type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, issue_id, uploaded_by, original_name, mime_type, size_bytes, width, height, type, created_at`,
    [
      input.issueId,
      input.uploadedBy,
      input.storageKey,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
      input.width,
      input.height,
      input.type,
    ],
  );
  const row = rows[0];
  return {
    id: row.id,
    issueId: row.issue_id,
    uploadedBy: row.uploaded_by,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    type: row.type,
    createdAt: row.created_at,
  };
}

export async function listImages(issueId: string, db: Executor = pool): Promise<IssueImage[]> {
  const { rows } = await db.query<{
    id: string;
    issue_id: string;
    uploaded_by: string;
    uploader_name: string;
    original_name: string | null;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    type: ImageType;
    created_at: Date;
  }>(
    `SELECT im.id, im.issue_id, im.uploaded_by, u.name AS uploader_name, im.original_name,
            im.mime_type, im.size_bytes, im.width, im.height, im.type, im.created_at
       FROM issue_images im
       JOIN users u ON u.id = im.uploaded_by
      WHERE im.issue_id = $1
      ORDER BY im.created_at ASC`,
    [issueId],
  );

  return rows.map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    uploadedBy: row.uploaded_by,
    uploaderName: row.uploader_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    type: row.type,
    createdAt: row.created_at,
  }));
}

export async function findImage(
  imageId: string,
  issueId: string,
  db: Executor = pool,
): Promise<{ id: string; storageKey: string; mimeType: string } | null> {
  const { rows } = await db.query<{ id: string; storage_key: string; mime_type: string }>(
    'SELECT id, storage_key, mime_type FROM issue_images WHERE id = $1 AND issue_id = $2',
    [imageId, issueId],
  );
  return rows[0] ? { id: rows[0].id, storageKey: rows[0].storage_key, mimeType: rows[0].mime_type } : null;
}

export async function countImages(
  issueId: string,
  type?: ImageType,
  db: Executor = pool,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM issue_images
      WHERE issue_id = $1 AND ($2::image_type IS NULL OR type = $2::image_type)`,
    [issueId, type ?? null],
  );
  return Number(rows[0]?.count ?? 0);
}

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

export async function addComment(
  input: { issueId: string; authorId: string; body: string; isInternal: boolean },
  db: Executor = pool,
): Promise<IssueComment> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO issue_comments (issue_id, author_id, body, is_internal)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.issueId, input.authorId, input.body, input.isInternal],
  );

  const { rows: full } = await db.query<{
    id: string;
    issue_id: string;
    author_id: string;
    author_name: string;
    author_role: UserRole;
    body: string;
    is_internal: boolean;
    created_at: Date;
  }>(
    `SELECT c.id, c.issue_id, c.author_id, u.name AS author_name, u.role AS author_role,
            c.body, c.is_internal, c.created_at
       FROM issue_comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.id = $1`,
    [rows[0].id],
  );

  const row = full[0];
  return {
    id: row.id,
    issueId: row.issue_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    isInternal: row.is_internal,
    createdAt: row.created_at,
  };
}

/** `includeInternal` is decided by the service from the viewer's role. */
export async function listComments(
  issueId: string,
  includeInternal: boolean,
  db: Executor = pool,
): Promise<IssueComment[]> {
  const { rows } = await db.query<{
    id: string;
    issue_id: string;
    author_id: string;
    author_name: string;
    author_role: UserRole;
    body: string;
    is_internal: boolean;
    created_at: Date;
  }>(
    `SELECT c.id, c.issue_id, c.author_id, u.name AS author_name, u.role AS author_role,
            c.body, c.is_internal, c.created_at
       FROM issue_comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.issue_id = $1
        AND ($2::boolean OR NOT c.is_internal)
      ORDER BY c.created_at ASC`,
    [issueId, includeInternal],
  );

  return rows.map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    isInternal: row.is_internal,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------------ *
 * Category lookup used during creation
 * ------------------------------------------------------------------ */

export async function findCategoryForIssue(
  categoryId: number,
  db: Executor = pool,
): Promise<{ id: number; name: string; defaultSeverity: Severity; slaHours: number; isActive: boolean } | null> {
  const { rows } = await db.query<{
    id: number;
    name: string;
    default_severity: Severity;
    sla_hours: number;
    is_active: boolean;
  }>(
    'SELECT id, name, default_severity, sla_hours, is_active FROM issue_categories WHERE id = $1',
    [categoryId],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        defaultSeverity: row.default_severity,
        slaHours: row.sla_hours,
        isActive: row.is_active,
      }
    : null;
}
