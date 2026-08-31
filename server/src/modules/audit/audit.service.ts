/**
 * Audit logging for administrative and lifecycle actions.
 *
 * Append-only. Written inside the caller's transaction so an audited action and
 * its log entry commit together — a rolled-back assignment leaves no misleading
 * "assigned" record.
 */
import { pool, type Executor } from '../../db/pool';
import type { Paginated } from '../../types';
import { logger } from '../../utils/logger';

export const AUDIT_ACTIONS = {
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_REGISTERED: 'USER_REGISTERED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  ISSUE_CREATED: 'ISSUE_CREATED',
  ISSUE_ASSIGNED: 'ISSUE_ASSIGNED',
  ISSUE_REASSIGNED: 'ISSUE_REASSIGNED',
  ISSUE_UNASSIGNED: 'ISSUE_UNASSIGNED',
  ISSUE_PRIORITY_CHANGED: 'ISSUE_PRIORITY_CHANGED',
  ISSUE_STATUS_CHANGED: 'ISSUE_STATUS_CHANGED',
  ISSUE_DELETED: 'ISSUE_DELETED',
  ISSUE_MARKED_SPAM: 'ISSUE_MARKED_SPAM',
  ISSUE_VISIBILITY_CHANGED: 'ISSUE_VISIBILITY_CHANGED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  CATEGORY_DEACTIVATED: 'CATEGORY_DEACTIVATED',
  DEPARTMENT_CREATED: 'DEPARTMENT_CREATED',
  DEPARTMENT_UPDATED: 'DEPARTMENT_UPDATED',
  DATA_EXPORTED: 'DATA_EXPORTED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditContext {
  actorId: string | null;
  actorEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RecordAuditInput extends AuditContext {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function record(input: RecordAuditInput, db: Executor = pool): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        input.actorId,
        input.actorEmail ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.ipAddress ?? null,
        input.userAgent?.slice(0, 255) ?? null,
      ],
    );
  } catch (error) {
    // Audit failure must not break the user-visible operation, but it must be
    // loudly visible in the logs (OWASP A09).
    logger.error({ err: error, action: input.action }, 'Failed to write audit log entry');
  }
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
}

export interface ListAuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export async function list(filters: ListAuditFilters, db: Executor = pool): Promise<Paginated<AuditLogEntry>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.action) {
    params.push(filters.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (filters.entityType) {
    params.push(filters.entityType);
    conditions.push(`a.entity_type = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    conditions.push(`a.entity_id = $${params.length}`);
  }
  if (filters.actorId) {
    params.push(filters.actorId);
    conditions.push(`a.actor_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`a.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`a.created_at <= $${params.length}::timestamptz`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (filters.page - 1) * filters.limit;

  const { rows } = await db.query<{
    id: string;
    actor_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: Record<string, unknown>;
    ip_address: string | null;
    created_at: Date;
    total: string;
  }>(
    `SELECT a.id, a.actor_id, a.actor_email, u.name AS actor_name, a.action,
            a.entity_type, a.entity_id, a.metadata, a.ip_address::text AS ip_address,
            a.created_at, COUNT(*) OVER() AS total
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  );

  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    rows: rows.map((row) => ({
      id: String(row.id),
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
}

export async function distinctActions(db: Executor = pool): Promise<string[]> {
  const { rows } = await db.query<{ action: string }>(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action',
  );
  return rows.map((r) => r.action);
}
