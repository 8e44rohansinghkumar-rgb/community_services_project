/** Audit log browsing — ADMIN only, enforced at the router level. */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as audit from './audit.service';
import { validate, validatedQuery } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { authenticatedLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendOk, sendPaginated } from '../../utils/http';

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(40).optional(),
    entityId: z.string().trim().max(64).optional(),
    actorId: z.string().uuid().optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole('ADMIN'), authenticatedLimiter);

auditRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = validatedQuery<z.infer<typeof listQuery>>(req);
    const result = await audit.list(query);
    sendPaginated(res, result.rows, result.pagination);
  }),
);

auditRouter.get(
  '/actions',
  asyncHandler(async (_req: Request, res: Response) => {
    const actions = await audit.distinctActions();
    sendOk(res, { actions });
  }),
);
