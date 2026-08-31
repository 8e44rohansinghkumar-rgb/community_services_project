#!/usr/bin/env node
/**
 * Contract check: every route mounted in the Express app must appear in
 * docs/openapi.yaml, and vice versa.
 *
 * Documentation that is not verified stops being true. This runs in seconds and
 * turns "someone forgot to document the new endpoint" from something a reviewer
 * has to notice into a failing check.
 *
 *   node scripts/check-openapi.mjs
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `yaml` is a server dependency; resolve it from there so this script needs no
// install of its own at the repo root.
const require = createRequire(path.join(root, 'server/package.json'));
const { parse } = require('yaml');

/** Router variable name -> mount path in routes/index.ts. */
const MOUNTS = {
  healthRouter: '/health',
  authRouter: '/auth',
  userRouter: '/users',
  workerRouter: '/workers',
  issueRouter: '/issues',
  categoryRouter: '/categories',
  departmentRouter: '/departments',
  notificationRouter: '/notifications',
  analyticsRouter: '/analytics',
  auditRouter: '/audit-logs',
};

const ROUTE_FILES = [
  'server/src/routes/health.routes.ts',
  'server/src/modules/auth/auth.routes.ts',
  'server/src/modules/users/user.routes.ts',
  'server/src/modules/issues/issue.routes.ts',
  'server/src/modules/categories/category.module.ts',
  'server/src/modules/departments/department.routes.ts',
  'server/src/modules/notifications/notification.routes.ts',
  'server/src/modules/analytics/analytics.routes.ts',
  'server/src/modules/audit/audit.routes.ts',
];

/** `router.get('/x', …)` — the call may wrap onto the next line. */
const ROUTE_RE = /\b(\w*[Rr]outer)\s*\.\s*(get|post|patch|put|delete)\(\s*\n?\s*'([^']*)'/g;

function collectRoutes() {
  const found = new Set();
  for (const file of ROUTE_FILES) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const [, router, method, routePath] of source.matchAll(ROUTE_RE)) {
      const mount = MOUNTS[router];
      if (!mount) {
        throw new Error(`${file}: unknown router "${router}" — add it to MOUNTS in this script.`);
      }
      let full = `${mount}${routePath}`.replace(/\/{2,}/g, '/');
      if (full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
      // Express ":id" -> OpenAPI "{id}"
      full = full.replace(/:(\w+)/g, '{$1}');
      found.add(`${method.toUpperCase()} ${full}`);
    }
  }
  return found;
}

function collectSpec() {
  const spec = parse(readFileSync(path.join(root, 'docs/openapi.yaml'), 'utf8'));
  const found = new Set();
  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (['get', 'post', 'patch', 'put', 'delete'].includes(method)) {
        found.add(`${method.toUpperCase()} ${route}`);
      }
    }
  }
  return found;
}

const code = collectRoutes();
const spec = collectSpec();

const undocumented = [...code].filter((op) => !spec.has(op)).sort();
const phantom = [...spec].filter((op) => !code.has(op)).sort();

if (undocumented.length) {
  console.error(`\n✗ ${undocumented.length} route(s) implemented but missing from docs/openapi.yaml:`);
  for (const op of undocumented) console.error(`    ${op}`);
}
if (phantom.length) {
  console.error(`\n✗ ${phantom.length} operation(s) documented but not implemented:`);
  for (const op of phantom) console.error(`    ${op}`);
}

if (undocumented.length || phantom.length) {
  console.error('');
  process.exit(1);
}

console.log(`✓ OpenAPI specification matches the implementation (${code.size} operations).`);
