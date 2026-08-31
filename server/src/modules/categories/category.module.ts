/**
 * Categories: repository + service + controller + routes in one small module.
 * The domain here is genuinely simple, so splitting it across four files would
 * add ceremony without adding clarity.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { pool, type Executor } from '../../db/pool';
import { validate, validatedQuery } from '../../middleware/validate';
import { requireAuth, requireRole, getAuthUser, optionalAuth } from '../../middleware/auth';
import { authenticatedLimiter, publicLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendCreated, sendOk } from '../../utils/http';
import { ConflictError, NotFoundError } from '../../utils/errors';
import * as audit from '../audit/audit.service';
import { SEVERITIES, type Category, type Severity } from '../../types';

/* ---------------------------- Repository ---------------------------- */

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  default_severity: Severity;
  sla_hours: number;
  department_id: string | null;
  is_active: boolean;
  sort_order: number;
  issue_count?: string;
}

function mapCategory(row: CategoryRow): Category & { issueCount?: number } {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    defaultSeverity: row.default_severity,
    slaHours: row.sla_hours,
    departmentId: row.department_id,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    ...(row.issue_count !== undefined ? { issueCount: Number(row.issue_count) } : {}),
  };
}

export async function listCategories(
  options: { includeInactive?: boolean; withCounts?: boolean } = {},
  db: Executor = pool,
): Promise<(Category & { issueCount?: number })[]> {
  const countSelect = options.withCounts
    ? `, (SELECT COUNT(*) FROM issues i WHERE i.category_id = c.id AND i.deleted_at IS NULL) AS issue_count`
    : '';
  const { rows } = await db.query<CategoryRow>(
    `SELECT c.id, c.slug, c.name, c.description, c.icon, c.default_severity,
            c.sla_hours, c.department_id, c.is_active, c.sort_order${countSelect}
       FROM issue_categories c
      WHERE ($1::boolean OR c.is_active)
      ORDER BY c.sort_order ASC, c.name ASC`,
    [options.includeInactive ?? false],
  );
  return rows.map(mapCategory);
}

async function findCategoryById(id: number, db: Executor = pool): Promise<Category | null> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT id, slug, name, description, icon, default_severity, sla_hours,
            department_id, is_active, sort_order
       FROM issue_categories WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}

/* ---------------------------- Validation ---------------------------- */

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and hyphens only');

const createCategorySchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).optional().nullable(),
    icon: z.string().trim().max(40).optional().nullable(),
    defaultSeverity: z.enum(SEVERITIES).default('MEDIUM'),
    slaHours: z.coerce.number().int().min(1).max(8760).default(72),
    departmentId: z.string().uuid().optional().nullable(),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(500),
  })
  .strict();

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    icon: z.string().trim().max(40).optional().nullable(),
    defaultSeverity: z.enum(SEVERITIES).optional(),
    slaHours: z.coerce.number().int().min(1).max(8760).optional(),
    departmentId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' });

const idParams = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z
  .object({
    includeInactive: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    withCounts: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

/* ---------------------------- Routes ---------------------------- */

export const categoryRouter = Router();

// Public: the report form needs the category list before sign-in.
categoryRouter.get(
  '/',
  // optionalAuth so an admin session unlocks includeInactive / withCounts,
  // while anonymous visitors still get the public list.
  optionalAuth,
  publicLimiter,
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = validatedQuery<z.infer<typeof listQuery>>(req);
    // Only admins may see deactivated categories.
    const includeInactive = query.includeInactive && req.user?.role === 'ADMIN';
    const categories = await listCategories({
      includeInactive: Boolean(includeInactive),
      withCounts: Boolean(query.withCounts && req.user?.role === 'ADMIN'),
    });
    sendOk(res, { categories });
  }),
);

categoryRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ body: createCategorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const input = req.body as z.infer<typeof createCategorySchema>;

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO issue_categories (slug, name, description, icon, default_severity, sla_hours, department_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        input.slug,
        input.name,
        input.description ?? null,
        input.icon ?? null,
        input.defaultSeverity,
        input.slaHours,
        input.departmentId ?? null,
        input.sortOrder,
      ],
    );
    if (!rows[0]) throw new ConflictError('A category with that slug already exists', 'CATEGORY_EXISTS');

    const category = await findCategoryById(rows[0].id);
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.CATEGORY_CREATED,
      entityType: 'category',
      entityId: String(rows[0].id),
      metadata: { slug: input.slug, name: input.name },
      ipAddress: req.ip ?? null,
    });
    sendCreated(res, { category });
  }),
);

categoryRouter.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: idParams, body: updateCategorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const id = Number(req.params.id);
    const input = req.body as z.infer<typeof updateCategorySchema>;

    const existing = await findCategoryById(id);
    if (!existing) throw new NotFoundError('Category', 'CATEGORY_NOT_FOUND');

    // COALESCE-based partial update keeps this one parameterised statement.
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE issue_categories
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              icon = CASE WHEN $5::boolean THEN $6 ELSE icon END,
              default_severity = COALESCE($7::severity, default_severity),
              sla_hours = COALESCE($8::int, sla_hours),
              department_id = CASE WHEN $9::boolean THEN $10::uuid ELSE department_id END,
              is_active = COALESCE($11::boolean, is_active),
              sort_order = COALESCE($12::int, sort_order)
        WHERE id = $1
        RETURNING id`,
      [
        id,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.icon !== undefined,
        input.icon ?? null,
        input.defaultSeverity ?? null,
        input.slaHours ?? null,
        input.departmentId !== undefined,
        input.departmentId ?? null,
        input.isActive ?? null,
        input.sortOrder ?? null,
      ],
    );
    if (!rows[0]) throw new NotFoundError('Category', 'CATEGORY_NOT_FOUND');

    const category = await findCategoryById(id);
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.CATEGORY_UPDATED,
      entityType: 'category',
      entityId: String(id),
      metadata: { changes: input, previousName: existing.name },
      ipAddress: req.ip ?? null,
    });
    sendOk(res, { category });
  }),
);

/**
 * "Delete" = deactivate when the category is in use.
 * A hard delete would orphan historical issues, and the FK is RESTRICT, so this
 * degrades to a soft disable rather than failing.
 */
categoryRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: idParams }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const id = Number(req.params.id);

    const existing = await findCategoryById(id);
    if (!existing) throw new NotFoundError('Category', 'CATEGORY_NOT_FOUND');

    const { rows: usage } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM issues WHERE category_id = $1',
      [id],
    );
    const inUse = Number(usage[0]?.count ?? 0) > 0;

    if (inUse) {
      await pool.query('UPDATE issue_categories SET is_active = false WHERE id = $1', [id]);
    } else {
      await pool.query('DELETE FROM issue_categories WHERE id = $1', [id]);
    }

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.CATEGORY_DEACTIVATED,
      entityType: 'category',
      entityId: String(id),
      metadata: { name: existing.name, hardDeleted: !inUse, issueCount: Number(usage[0]?.count ?? 0) },
      ipAddress: req.ip ?? null,
    });

    sendOk(res, {
      message: inUse
        ? 'Category deactivated. Existing issues keep their category for historical accuracy.'
        : 'Category deleted.',
      deactivated: inUse,
    });
  }),
);
