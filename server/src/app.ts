/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   request id -> logging -> security headers -> CORS -> body limits ->
 *   cookies -> CSRF -> routes -> 404 -> central error handler
 */
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { requestId, httpLogger } from './middleware/requestContext';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { docsRouter } from './routes/docs.routes';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in production, req.ip must come from X-Forwarded-For.
  // 'loopback' in dev avoids trusting arbitrary spoofed headers.
  app.set('trust proxy', config.isProduction ? 1 : 'loopback');
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // The API returns JSON and streamed images only; a restrictive CSP costs
      // nothing here and protects the image-serving route in particular.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'none'"],
          styleSrc: ["'none'"],
          objectSrc: ["'none'"],
          sandbox: ['allow-downloads'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // SPA on another port
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      // HSTS only makes sense over HTTPS; enabling it on http://localhost would
      // poison the developer's browser for other localhost projects.
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: false, // legacy header, disabled per current OWASP guidance
    }),
  );

  // Reject disallowed origins with a clean 403 BEFORE the cors middleware runs.
  // Throwing from the cors origin callback surfaces as an opaque 500, which is
  // both a worse developer experience and a (minor) information leak.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !config.CORS_ORIGIN.includes(origin)) {
      res.status(403).json({
        success: false,
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not permitted to call the API' },
      });
      return;
    }
    next();
  });

  app.use(
    cors({
      // Explicit allowlist; never a wildcard for a credentialed API.
      origin: (origin, callback) => {
        // `origin` is undefined for same-origin, curl and server-to-server calls.
        if (!origin || config.CORS_ORIGIN.includes(origin)) return callback(null, true);
        // Unreachable in practice (the guard above already replied 403), but
        // keeps the policy correct if the middleware order ever changes.
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Authorization'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  // Body size caps: multipart uploads are handled separately by multer with
  // their own per-file limits.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser(config.COOKIE_SECRET));

  // Applies to every state-changing request across the whole API.
  app.use(csrfProtection);

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Civic Connect API',
        status: 'running',
        docs: '/docs',
        health: '/api/health',
      },
    });
  });

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.use('/api', apiRouter);

  // Interactive documentation. Mounted after the API so it can never shadow a
  // real endpoint, and outside /api so the SPA's proxy does not pick it up.
  app.use('/docs', docsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
