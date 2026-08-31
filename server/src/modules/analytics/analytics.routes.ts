/**
 * Analytics routes.
 *
 * /overview, /issues-by-* are role-scoped (each dashboard uses them).
 * Workload, hotspots and export are admin-only.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as analytics from './analytics.service';
import * as audit from '../audit/audit.service';
import { validate, validatedQuery } from '../../middleware/validate';
import { requireAuth, requireRole, getAuthUser } from '../../middleware/auth';
import { authenticatedLimiter } from '../../middleware/rateLimit';
import { asyncHandler, sendOk } from '../../utils/http';
import { ISSUE_STATUSES } from '../../types';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, authenticatedLimiter);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await analytics.overview(getAuthUser(req));
    sendOk(res, { stats });
  }),
);

analyticsRouter.get(
  '/issues-by-category',
  asyncHandler(async (req: Request, res: Response) => {
    const categories = await analytics.byCategory(getAuthUser(req));
    sendOk(res, { categories });
  }),
);

analyticsRouter.get(
  '/issues-by-status',
  asyncHandler(async (req: Request, res: Response) => {
    const statuses = await analytics.byStatus(getAuthUser(req));
    sendOk(res, { statuses });
  }),
);

analyticsRouter.get(
  '/issues-by-severity',
  asyncHandler(async (req: Request, res: Response) => {
    const severities = await analytics.bySeverity(getAuthUser(req));
    sendOk(res, { severities });
  }),
);

const overTimeQuery = z
  .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
  .strict();

analyticsRouter.get(
  '/issues-over-time',
  validate({ query: overTimeQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { days } = validatedQuery<z.infer<typeof overTimeQuery>>(req);
    const series = await analytics.overTime(getAuthUser(req), days);
    sendOk(res, { series, days });
  }),
);

analyticsRouter.get(
  '/worker-workload',
  requireRole('ADMIN'),
  asyncHandler(async (_req: Request, res: Response) => {
    const workload = await analytics.workerWorkload();
    sendOk(res, { workload });
  }),
);

const hotspotQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }).strict();

analyticsRouter.get(
  '/hotspots',
  requireRole('ADMIN'),
  validate({ query: hotspotQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit } = validatedQuery<z.infer<typeof hotspotQuery>>(req);
    const spots = await analytics.hotspots(limit);
    sendOk(res, { hotspots: spots });
  }),
);

const exportQuery = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
  })
  .strict();

/** CSV export. Values are escaped; formula-injection prefixes are neutralised. */
analyticsRouter.get(
  '/export',
  requireRole('ADMIN'),
  validate({ query: exportQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getAuthUser(req);
    const filters = validatedQuery<z.infer<typeof exportQuery>>(req);
    const rows = await analytics.exportRows(filters);

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: audit.AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: 'issue',
      metadata: { rowCount: rows.length, filters },
      ipAddress: req.ip ?? null,
    });

    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['public_id'];
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      // String(value) on an object yields "[object Object]", which would put
      // silent garbage in the export rather than failing loudly.
      let text: string;
      if (value instanceof Date) text = value.toISOString();
      else if (typeof value === 'object') text = JSON.stringify(value);
      else if (typeof value === 'string') text = value;
      else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        text = value.toString();
      } else text = '';
      // CSV injection guard: a leading =, +, - or @ can execute in spreadsheets.
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };

    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="civic-issues-${Date.now()}.csv"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  }),
);
