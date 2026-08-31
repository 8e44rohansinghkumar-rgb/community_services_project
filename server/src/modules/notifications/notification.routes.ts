/**
 * Notification routes. Every query is scoped to req.user.id — a user can never
 * read or mutate another user's notifications, even with a valid id.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as notifications from './notification.service';
import { validate, validatedQuery } from '../../middleware/validate';
import { requireAuth, getAuthUser } from '../../middleware/auth';
import { authenticatedLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendOk, sendPaginated } from '../../utils/http';
import { NotFoundError } from '../../utils/errors';

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid('Invalid notification id') });

export const notificationRouter = Router();

notificationRouter.use(requireAuth, authenticatedLimiter);

notificationRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const query = validatedQuery<z.infer<typeof listQuery>>(req);
    const result = await notifications.listForUser(actor.id, query);
    sendPaginated(res, result.rows, result.pagination);
  }),
);

notificationRouter.get(
  '/unread-count',
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const count = await notifications.unreadCount(actor.id);
    sendOk(res, { count });
  }),
);

notificationRouter.patch(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const updated = await notifications.markAllRead(actor.id);
    sendOk(res, { updated });
  }),
);

notificationRouter.patch(
  '/:id/read',
  validate({ params: idParams }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const marked = await notifications.markRead(req.params.id, actor.id);
    if (!marked) {
      // Distinguishes "already read" from "not yours / does not exist" without
      // revealing which — both return 404 for a foreign id.
      const exists = await notifications.existsForUser(req.params.id, actor.id);
      if (!exists) throw new NotFoundError('Notification', 'NOTIFICATION_NOT_FOUND');
    }
    sendOk(res, { message: 'Notification marked as read' });
  }),
);
