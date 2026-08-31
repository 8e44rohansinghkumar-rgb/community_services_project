/**
 * User administration and worker directory.
 *
 * All of /api/users is ADMIN-only. /api/workers exposes a deliberately reduced
 * projection so admins can pick an assignee without leaking staff contact data
 * to workers browsing the list.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as userRepo from './user.repository';
import * as issueRepo from '../issues/issue.repository';
import * as audit from '../audit/audit.service';
import * as authRepo from '../auth/auth.repository';
import { withTransaction } from '../../db/pool';
import { validate, validatedQuery } from '../../middleware/validate';
import { requireAuth, requireRole, getAuthUser } from '../../middleware/auth';
import { authenticatedLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendCreated, sendOk, sendPaginated } from '../../utils/http';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/errors';
import { hashPassword, passwordPolicyIssues } from '../auth/password.service';
import { isPgError, PG_ERROR } from '../../db/pool';
import { USER_ROLES } from '../../types';
import { nameSchema, emailSchema, phoneSchema, passwordSchema } from '../auth/auth.validators';

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    role: z.enum(USER_ROLES).optional(),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid('Invalid user id') });

const statusSchema = z.object({ isActive: z.boolean() }).strict();

const roleSchema = z
  .object({
    role: z.enum(USER_ROLES),
    departmentId: z.string().uuid().optional().nullable(),
  })
  .strict();

const createStaffSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: phoneSchema,
    role: z.enum(['WORKER', 'ADMIN']),
    departmentId: z.string().uuid().optional().nullable(),
  })
  .strict();

export const userRouter = Router();

userRouter.use(requireAuth, requireRole('ADMIN'), authenticatedLimiter);

userRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = validatedQuery<z.infer<typeof listQuery>>(req);
    const result = await userRepo.listUsers(query);
    sendPaginated(res, result.rows, result.pagination);
  }),
);

/** Staff accounts are created by an admin — never self-registered. */
userRouter.post(
  '/',
  validate({ body: createStaffSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const input = req.body as z.infer<typeof createStaffSchema>;

    const issues = passwordPolicyIssues(input.password, input.email);
    if (issues.length > 0) {
      throw new ValidationError(
        'Password does not meet the security requirements',
        issues.map((message) => ({ field: 'password', message })),
      );
    }

    const passwordHash = await hashPassword(input.password);
    try {
      const user = await withTransaction(async (client) => {
        const created = await userRepo.createUser(
          {
            name: input.name,
            email: input.email,
            passwordHash,
            phone: input.phone ?? null,
            role: input.role,
            departmentId: input.departmentId ?? null,
            emailVerified: true, // staff accounts are provisioned, not self-signed
          },
          client,
        );
        await audit.record(
          {
            actorId: actor.id,
            actorEmail: actor.email,
            action: audit.AUDIT_ACTIONS.USER_ROLE_CHANGED,
            entityType: 'user',
            entityId: created.id,
            metadata: { created: true, role: created.role, createdBy: actor.email },
            ipAddress: req.ip ?? null,
          },
          client,
        );
        return created;
      });
      sendCreated(res, { user });
    } catch (error) {
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError('An account with that email address already exists', 'EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }
  }),
);

userRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = await userRepo.findById(req.params.id);
    if (!user) throw new NotFoundError('User', 'USER_NOT_FOUND');
    sendOk(res, { user });
  }),
);

userRouter.patch(
  '/:id/status',
  validate({ params: idParams, body: statusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const targetId = req.params.id;
    // Prevents an admin locking themselves out mid-session.
    if (targetId === actor.id) {
      throw new ValidationError('You cannot change the status of your own account');
    }

    const user = await withTransaction(async (client) => {
      const updated = await userRepo.setActive(targetId, req.body.isActive, client);
      if (!updated) throw new NotFoundError('User', 'USER_NOT_FOUND');
      // Deactivation must also kill live sessions, not just block future logins.
      if (!req.body.isActive) {
        await authRepo.revokeAllForUser(targetId, 'account_deactivated', client);
      }
      await audit.record(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          action: req.body.isActive ? audit.AUDIT_ACTIONS.USER_ACTIVATED : audit.AUDIT_ACTIONS.USER_DEACTIVATED,
          entityType: 'user',
          entityId: targetId,
          metadata: { targetEmail: updated.email, isActive: req.body.isActive },
          ipAddress: req.ip ?? null,
        },
        client,
      );
      return updated;
    });

    sendOk(res, { user });
  }),
);

userRouter.patch(
  '/:id/role',
  validate({ params: idParams, body: roleSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const targetId = req.params.id;
    // Self-demotion would leave the system potentially without an admin.
    if (targetId === actor.id) {
      throw new ValidationError('You cannot change your own role');
    }

    const existing = await userRepo.findById(targetId);
    if (!existing) throw new NotFoundError('User', 'USER_NOT_FOUND');

    // Never allow the last active admin to be demoted.
    if (existing.role === 'ADMIN' && req.body.role !== 'ADMIN') {
      const admins = await userRepo.findAdminIds();
      if (admins.length <= 1) {
        throw new ConflictError('At least one active administrator must remain', 'LAST_ADMIN');
      }
    }

    const user = await withTransaction(async (client) => {
      const updated = await userRepo.setRole(targetId, req.body.role, req.body.departmentId, client);
      if (!updated) throw new NotFoundError('User', 'USER_NOT_FOUND');
      // Role change invalidates existing sessions so the new role takes effect.
      await authRepo.revokeAllForUser(targetId, 'role_changed', client);
      await audit.record(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          action: audit.AUDIT_ACTIONS.USER_ROLE_CHANGED,
          entityType: 'user',
          entityId: targetId,
          metadata: { from: existing.role, to: req.body.role, targetEmail: existing.email },
          ipAddress: req.ip ?? null,
        },
        client,
      );
      return updated;
    });

    sendOk(res, { user });
  }),
);

/* ---------------------------- Workers ---------------------------- */

export const workerRouter = Router();

/**
 * Worker directory. Admins need it to assign; workers may read it to see team
 * workload. The projection below drops email/phone for non-admin callers.
 */
workerRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'WORKER'),
  authenticatedLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const workers = await userRepo.listWorkers({ onlyActive: actor.role !== 'ADMIN' });
    const projected = workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      departmentId: worker.departmentId,
      departmentName: worker.departmentName,
      isActive: worker.isActive,
      activeAssignments: worker.activeAssignments,
      completedAssignments: worker.completedAssignments,
      // Contact details are administrative data.
      ...(actor.role === 'ADMIN' ? { email: worker.email, phone: worker.phone } : {}),
    }));
    sendOk(res, { workers: projected });
  }),
);

const workerIssuesQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    onlyOpen: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  })
  .strict();

workerRouter.get(
  '/:id/issues',
  requireAuth,
  requireRole('ADMIN', 'WORKER'),
  authenticatedLimiter,
  validate({ params: idParams, query: workerIssuesQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const targetId = req.params.id;
    // A worker may only read their OWN queue; admins may read anyone's.
    if (actor.role === 'WORKER' && actor.id !== targetId) {
      throw new NotFoundError('Worker', 'WORKER_NOT_FOUND');
    }
    const query = validatedQuery<z.infer<typeof workerIssuesQuery>>(req);
    const result = await issueRepo.listIssues({
      workerId: targetId,
      page: query.page,
      limit: query.limit,
      onlyOpen: query.onlyOpen,
      sortBy: 'priority',
      sortDir: 'desc',
    });
    sendPaginated(res, result.rows, result.pagination);
  }),
);
