/**
 * Rate limiting.
 *
 * The rest of the suite runs with limiting disabled (config.isTest) so that a
 * fast run does not trip the login limiter and fail unrelated assertions. This
 * file re-enables it by building a throwaway Express app around a fresh
 * limiter, which keeps the behaviour genuinely covered without making every
 * other test order-dependent.
 */
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

/** Same handler shape the real limiters use. */
function buildLimitedApp(limit: number, windowMs = 60_000) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res, _next, options) => {
        res.status(options.statusCode).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
        });
      },
    }),
  );
  app.get('/probe', (_req, res) => {
    res.json({ success: true, data: { ok: true } });
  });
  return app;
}

describe('Rate limiter behaviour', () => {
  it('allows requests up to the limit, then returns 429', async () => {
    const app = buildLimitedApp(3);

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app).get('/probe');
      expect(response.status).toBe(200);
    }

    const blocked = await request(app).get('/probe');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('uses the standard envelope and leaks nothing when limiting', async () => {
    const app = buildLimitedApp(1);
    await request(app).get('/probe');
    const blocked = await request(app).get('/probe');

    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error).toHaveProperty('code');
    expect(blocked.body.error).toHaveProperty('message');
    expect(blocked.body.error).not.toHaveProperty('stack');
  });

  it('advertises the limit through RateLimit headers', async () => {
    const app = buildLimitedApp(5);
    const response = await request(app).get('/probe');
    // draft-7 combines the policy into a single RateLimit header.
    expect(response.headers['ratelimit'] ?? response.headers['ratelimit-limit']).toBeDefined();
  });
});

describe('Production limiter configuration', () => {
  it('is disabled under test and enabled otherwise', async () => {
    // Guards against someone "simplifying" the skip predicate into `true`.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/middleware/rateLimit.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain('skip: () => config.isTest');
    expect(source).not.toContain('skip: () => true');
  });

  it('defines a distinct limiter per traffic class rather than one global cap', async () => {
    const limiters = await import('../src/middleware/rateLimit');
    for (const name of [
      'loginLimiter',
      'registerLimiter',
      'passwordResetLimiter',
      'createIssueLimiter',
      'uploadLimiter',
      'commentLimiter',
      'authenticatedLimiter',
      'publicLimiter',
    ]) {
      expect(limiters).toHaveProperty(name);
    }
  });
});
