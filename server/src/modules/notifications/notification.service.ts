/**
 * In-app notifications, plus a transport abstraction for future e-mail/SMS/push.
 *
 * Notifications are created inside the caller's transaction so a user is never
 * told about a change that was subsequently rolled back.
 */
import { pool, type Executor } from '../../db/pool';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import type { NotificationType, Paginated } from '../../types';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  issueId: string | null;
  issuePublicId?: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  issueId?: string | null;
}

/* ------------------------------------------------------------------ *
 * Outbound transport abstraction (e-mail today, SMS/push later)
 * ------------------------------------------------------------------ */

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
}

export interface Notifier {
  readonly channel: string;
  send(message: OutboundMessage): Promise<void>;
}

/** Development default: logs instead of sending. No provider required. */
class ConsoleNotifier implements Notifier {
  readonly channel = 'console';
  async send(message: OutboundMessage): Promise<void> {
    logger.info({ to: message.to, subject: message.subject, channel: this.channel }, 'Outbound notification (not sent)');
  }
}

/**
 * Placeholder for a real SMTP transport. Wiring nodemailer here is the only
 * change needed once EMAIL_* env vars are provided; nothing else moves.
 */
class SmtpNotifier implements Notifier {
  readonly channel = 'email';
  async send(message: OutboundMessage): Promise<void> {
    logger.info({ to: message.to, subject: message.subject, channel: this.channel }, 'Email queued');
  }
}

export const notifier: Notifier = config.emailConfigured ? new SmtpNotifier() : new ConsoleNotifier();

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export async function create(input: CreateNotificationInput, db: Executor = pool): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, issue_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.type, input.title, input.body ?? null, input.issueId ?? null],
  );
}

/** Fan-out to several recipients in ONE statement (avoids N inserts). */
export async function createMany(inputs: CreateNotificationInput[], db: Executor = pool): Promise<void> {
  if (inputs.length === 0) return;
  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, issue_id)
     SELECT * FROM UNNEST($1::uuid[], $2::notification_type[], $3::text[], $4::text[], $5::uuid[])`,
    [
      inputs.map((i) => i.userId),
      inputs.map((i) => i.type),
      inputs.map((i) => i.title),
      inputs.map((i) => i.body ?? null),
      inputs.map((i) => i.issueId ?? null),
    ],
  );
}

export async function listForUser(
  userId: string,
  filters: { page: number; limit: number; unreadOnly?: boolean },
  db: Executor = pool,
): Promise<Paginated<Notification>> {
  const offset = (filters.page - 1) * filters.limit;
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body: string | null;
    issue_id: string | null;
    issue_public_id: string | null;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
    total: string;
  }>(
    `SELECT n.id, n.user_id, n.type, n.title, n.body, n.issue_id,
            i.public_id AS issue_public_id, n.is_read, n.read_at, n.created_at,
            COUNT(*) OVER() AS total
       FROM notifications n
       LEFT JOIN issues i ON i.id = n.issue_id
      WHERE n.user_id = $1
        AND ($2::boolean IS FALSE OR NOT n.is_read)
      ORDER BY n.created_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, filters.unreadOnly ?? false, filters.limit, offset],
  );

  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      body: row.body,
      issueId: row.issue_id,
      issuePublicId: row.issue_public_id,
      isRead: row.is_read,
      readAt: row.read_at,
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

export async function unreadCount(userId: string, db: Executor = pool): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND NOT is_read',
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Ownership is part of the WHERE clause: a user can only ever mark their own. */
export async function markRead(id: string, userId: string, db: Executor = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE notifications
        SET is_read = true, read_at = now()
      WHERE id = $1 AND user_id = $2 AND NOT is_read`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function markAllRead(userId: string, db: Executor = pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE notifications
        SET is_read = true, read_at = now()
      WHERE user_id = $1 AND NOT is_read`,
    [userId],
  );
  return rowCount ?? 0;
}

export async function existsForUser(id: string, userId: string, db: Executor = pool): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);
  return rows.length > 0;
}
