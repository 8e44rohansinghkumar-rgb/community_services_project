/**
 * Interactive API documentation.
 *
 * Serves `docs/openapi.yaml` — the single source of truth, kept in the repo and
 * diffable in review — as both raw YAML and a Swagger UI page.
 *
 * Two deliberate decisions:
 *
 *  1. The spec is READ FROM DISK, not duplicated in code. A route added without
 *     a matching entry shows up immediately as a gap in the docs, and there is
 *     no second copy to drift.
 *
 *  2. Swagger UI needs its own Content-Security-Policy. The global policy is
 *     `default-src 'none'` with a sandbox, which is right for a JSON/image API
 *     but would blank the docs page. Rather than weaken the API-wide policy,
 *     this router overrides the header for its own paths only, and still
 *     forbids framing, plugins and form submission.
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import swaggerUi from 'swagger-ui-express';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export const docsRouter = Router();

/**
 * Where the spec lives depends on how the app was started:
 *   repo, dev      /home/…/server/src/routes  → ../../../docs
 *   repo, compiled /home/…/server/dist/routes → ../../../docs
 *   container      /app/dist/routes           → /docs
 * Candidates are tried in order and the first readable one wins, so the same
 * code works in all three without an extra environment variable.
 */
const SPEC_CANDIDATES = [
  path.resolve(__dirname, '../../../docs/openapi.yaml'),
  path.resolve(__dirname, '../../docs/openapi.yaml'),
  '/docs/openapi.yaml',
];

function resolveSpecPath(): string | null {
  return SPEC_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

let cachedSpec: unknown | null = null;
let cachedRaw: string | null = null;

function loadSpec(): { document: unknown; raw: string } | null {
  // Cache in production; re-read in development so edits appear on refresh.
  if (config.isProduction && cachedSpec && cachedRaw) {
    return { document: cachedSpec, raw: cachedRaw };
  }
  const specPath = resolveSpecPath();
  if (!specPath) {
    logger.warn({ searched: SPEC_CANDIDATES }, 'OpenAPI specification not found');
    return null;
  }
  try {
    const raw = fs.readFileSync(specPath, 'utf8');
    const document = parse(raw) as unknown;
    cachedSpec = document;
    cachedRaw = raw;
    return { document, raw };
  } catch (error) {
    logger.warn({ err: error, specPath }, 'OpenAPI specification could not be loaded');
    return null;
  }
}

/**
 * Swagger UI ships its own inline styles and bundled scripts, so it needs a
 * policy of its own. Scoped to this router; the rest of the API keeps
 * `default-src 'none'`.
 */
docsRouter.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  next();
});

/** The raw specification, for client generators and CI contract checks. */
docsRouter.get('/openapi.yaml', (_req, res) => {
  const spec = loadSpec();
  if (!spec) {
    res.status(503).json({
      success: false,
      error: { code: 'SPEC_UNAVAILABLE', message: 'The API specification is not available' },
    });
    return;
  }
  res.type('text/yaml').send(spec.raw);
});

docsRouter.get('/openapi.json', (_req, res) => {
  const spec = loadSpec();
  if (!spec) {
    res.status(503).json({
      success: false,
      error: { code: 'SPEC_UNAVAILABLE', message: 'The API specification is not available' },
    });
    return;
  }
  res.json(spec.document);
});

const initial = loadSpec();

docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(initial?.document ?? null, {
    customSiteTitle: 'Civic Connect API',
    swaggerOptions: {
      // Alphabetical ordering keeps the page stable as endpoints are added.
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      persistAuthorization: true,
      // "Try it out" works from the browser because auth is cookie-based and
      // the docs are served from the API's own origin.
      withCredentials: true,
    },
    // Re-read on each request in development so the page tracks the file.
    explorer: false,
  }),
);
