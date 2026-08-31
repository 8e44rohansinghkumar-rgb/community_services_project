/**
 * Liveness and readiness probes.
 * Deliberately minimal: no version numbers, dependency lists or internal
 * hostnames that would help an attacker fingerprint the deployment.
 */
import { Router } from 'express';
import { checkDatabaseConnection } from '../db/pool';
import { asyncHandler } from '../utils/http';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const dbUp = await checkDatabaseConnection();
    res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      data: { status: dbUp ? 'ready' : 'degraded', database: dbUp ? 'up' : 'down' },
    });
  }),
);
