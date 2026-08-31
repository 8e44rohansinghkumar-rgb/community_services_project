/**
 * Departments. Kept small: they exist so categories and workers can be grouped,
 * and as the foundation for department-level permissions later.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import * as audit from '../audit/audit.service';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole, getAuthUser } from '../../middleware/auth';
import { authenticatedLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendCreated, sendOk } from '../../utils/http';
import { ConflictError, NotFoundError } from '../../utils/errors';

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });

const idParams = z.object({ id: z.string().uuid('Invalid department id') });

export const departmentRouter = Router();

departmentRouter.use(requireAuth, authenticatedLimiter);

// Readable by staff (workers see their own department name in their profile).
departmentRouter.get(
  '/',
  requireRole('ADMIN', 'WORKER'),
  asyncHandler(async (_req: Request, res: Response) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.description, d.is_active,
              (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'WORKER') AS worker_count,
              (SELECT COUNT(*) FROM issue_categories c WHERE c.department_id = d.id) AS category_count
         FROM departments d
        ORDER BY d.name ASC`,
    );
    sendOk(res, {
      departments: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.is_active,
        workerCount: Number(r.worker_count),
        categoryCount: Number(r.category_count),
      })),
    });
  }),
);

departmentRouter.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO departments (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [req.body.name, req.body.description ?? null],
    );
    if (!rows[0]) throw new ConflictError('A department with that name already exists', 'DEPARTMENT_EXISTS');

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.DEPARTMENT_CREATED,
      entityType: 'department',
      entityId: rows[0].id,
      metadata: { name: req.body.name },
      ipAddress: req.ip ?? null,
    });

    sendCreated(res, { department: { id: rows[0].id, name: req.body.name } });
  }),
);

departmentRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParams, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const { rows } = await pool.query(
      `UPDATE departments
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              is_active = COALESCE($5::boolean, is_active)
        WHERE id = $1
        RETURNING id, name, description, is_active`,
      [
        req.params.id,
        req.body.name ?? null,
        req.body.description !== undefined,
        req.body.description ?? null,
        req.body.isActive ?? null,
      ],
    );
    if (!rows[0]) throw new NotFoundError('Department', 'DEPARTMENT_NOT_FOUND');

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.DEPARTMENT_UPDATED,
      entityType: 'department',
      entityId: req.params.id!,
      metadata: { changes: req.body },
      ipAddress: req.ip ?? null,
    });

    sendOk(res, {
      department: {
        id: rows[0].id,
        name: rows[0].name,
        description: rows[0].description,
        isActive: rows[0].is_active,
      },
    });
  }),
);
