# Final verification checklist

Every item below was checked against the running system on 2026-08-31, not
against intent. Where something is partial or deliberately out of scope it says
so; a checklist that is all ticks is not a checklist.

**Verification baseline**

| | |
| --- | --- |
| Backend tests | 181 passing (8 files) |
| Frontend tests | 78 passing (3 files) |
| End-to-end smoke | 131 assertions passing |
| Linting | ESLint clean, both packages (type-aware, with a11y rules on the client) |
| Type checking | `tsc --noEmit` clean, both packages |
| Production build | Client builds; server compiles |
| OpenAPI drift check | 60/60 operations match the mounted routes |

---

## A. Project setup and structure

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 1 | Monorepo with clear `client/` and `server/` separation | ✅ | Repo root |
| 2 | TypeScript throughout, `strict` mode both sides | ✅ | Both `tsconfig.json`; `noUnusedLocals`/`noUnusedParameters` on the server |
| 3 | React + Vite + React Router | ✅ | React 18, Vite 6, react-router-dom 6 |
| 4 | Node + Express REST API in TypeScript | ✅ | Express 4.21 |
| 5 | PostgreSQL with the `pg` driver, no ORM | ✅ | `server/src/db/pool.ts`; every query hand-written |
| 6 | No MongoDB, no Firebase | ✅ | Neither appears in either `package.json` |
| 7 | `.env.example` for both packages, `.env` git-ignored | ✅ | `git ls-files` shows only `.env.example` files |
| 8 | `.gitignore` covers modules, builds, uploads, env, logs | ✅ | Root + per-package |
| 9 | npm scripts for dev, build, test, typecheck, lint, db | ✅ | Root `package.json` delegates to both. **Fixed late:** `lint` was declared but ESLint was never installed and no config existed, so the script failed. Both packages now have a type-aware `.eslintrc.cjs` and pass |
| 10 | Docker Compose and Dockerfiles | ⚠️ | Written and reviewed; **not** run — no Docker in this environment. Documented as development-only |

## B. Database

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 11 | Normalised schema, all required tables | ✅ | 15 tables |
| 12 | Sequential SQL migrations, up **and** down | ✅ | 6 up + 6 down in `database/migrations/` |
| 13 | Migration runner with `migrate`/`rollback`/`status`/`reset` | ✅ | `src/db/cli.ts`; advisory lock `4711_2026` prevents concurrent runs |
| 14 | UUID primary keys | ✅ | `pgcrypto`, `gen_random_uuid()` |
| 15 | Human-readable public identifier | ✅ | `issues.public_id`, format `CIV-YYYY-NNNNNN` |
| 16 | PK, FK, unique and check constraints | ✅ | 21 FKs, 130 CHECKs |
| 17 | Indexes on filter, sort and join columns | ✅ | 54 indexes including a GIN index on the generated `search_vector` |
| 18 | Deliberate cascade rules; audit and history never cascade-deleted | ✅ | `audit_logs.actor_id` and `issue_status_history.changed_by` are `ON DELETE SET NULL`; `category_id`/`reporter_id` are `RESTRICT` |
| 19 | Soft deletion where deletion is needed | ✅ | `issues.deleted_at`; `is_active` on users, categories, departments |
| 20 | `citizen_severity` separate from `official_priority` | ✅ | Distinct columns; the citizen cannot write the official one |
| 21 | Enum types enforced in the database | ✅ | `user_role`, `severity`, `issue_status`, `image_type`, `notification_type` |
| 22 | `updated_at` maintained by trigger | ✅ | `set_updated_at()` on every mutable table |
| 23 | Seed script with documented dev credentials | ✅ | 5 departments, 10 users, 12 issues; refuses to run in production |

## C. Authentication and sessions

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 24 | Argon2id (or bcrypt) password hashing | ✅ | Argon2id, 19 MiB / t=2 / p=1 — OWASP parameters |
| 25 | Password policy enforced server-side | ✅ | 12+ chars, four character classes, common-password blocklist, one source of truth |
| 26 | Short-lived access token | ✅ | 15-minute JWT in an HttpOnly cookie |
| 27 | Refresh token in a secure HttpOnly cookie | ✅ | 30 days, `Path=/api/auth`, stored as a SHA-256 hash |
| 28 | Rotation with reuse detection | ✅ | Family revoked on reuse; `tests/auth.test.ts` |
| 29 | **No JWT in localStorage** | ✅ | Asserted by a frontend test that spies on `Storage.prototype` |
| 30 | Immediate global revocation | ✅ | `token_version`, bumped by password change, logout-all, role/status change |
| 31 | No user enumeration | ✅ | Uniform `INVALID_CREDENTIALS` + dummy-hash verification for timing |
| 32 | Password reset flow | ⚠️ | Implemented and tokenised; **no mail provider** — the link is logged in development. Noted in README and security.md |

## D. Authorisation

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 33 | Three roles with the specified permissions | ✅ | Table in `docs/security.md` |
| 34 | Role checks in middleware | ✅ | `requireRole()` on every privileged route |
| 35 | Ownership checks in the service layer | ✅ | `resolveAccess()`: ADMIN > OWNER > ASSIGNED_WORKER > PUBLIC_VIEWER |
| 36 | IDOR returns 404, not 403 | ✅ | Asserted explicitly in `tests/rbac.test.ts` |
| 37 | Role never accepted from the client | ✅ | Registration forces CITIZEN; `.strict()` schemas reject smuggled fields |
| 38 | Admin self-harm guards | ✅ | Cannot self-deactivate or self-demote; last admin protected (`LAST_ADMIN`) |
| 39 | List endpoints scoped by role | ✅ | Citizen sees own, worker sees assigned, admin sees all — tested |

## E. Issue lifecycle

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 40 | 9 states with the specified transitions | ✅ | `issue.state.ts` |
| 41 | Server-side transition validation | ✅ | `assertTransition()` before every status write; 409 `INVALID_TRANSITION` |
| 42 | Reason required on exception paths | ✅ | REJECTED, ON_HOLD, REOPENED — 400 without |
| 43 | Resolution requires photographic evidence | ✅ | 400 without a `RESOLUTION` image |
| 44 | Assigned-worker-only actions | ✅ | Another worker gets 403 |
| 45 | Full status history timeline | ✅ | Ordered history asserted in `tests/lifecycle.test.ts` |
| 46 | Assignment is atomic | ✅ | One transaction: assignment + status + history + notification + audit; rollback verified |
| 47 | Concurrency-safe assignment | ✅ | Partial unique index `uq_issue_active_assignment`; 23505 surfaces as 409 |
| 48 | Reopen deactivates the old assignment | ✅ | Regression test — this was a real bug found in smoke testing |

## F. API design

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 49 | Consistent success/error envelope | ✅ | `{success,data}` / `{success,error:{code,message,details,requestId}}` |
| 50 | Enforced pagination, limit ≤ 100 | ✅ | Over-limit is **rejected**, not clamped |
| 51 | Whitelisted sorting | ✅ | `?sortBy=password_hash` → 400 |
| 52 | Filtering and full-text search | ✅ | Generated `tsvector` + GIN, not `LIKE '%…%'` |
| 53 | Validation on every input | ✅ | Zod on body, query and params; all errors reported at once |
| 54 | Centralised error handling | ✅ | One handler; operational vs unexpected distinguished |
| 55 | OpenAPI documentation | ✅ | 60 operations, served at `/docs`, drift-checked by `scripts/check-openapi.mjs` |

## G. Security

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 56 | Helmet with an explicit configuration | ✅ | CSP, nosniff, frameguard, referrer policy, HSTS in production only |
| 57 | CORS allowlist, never `*` | ✅ | Disallowed origin → 403 `ORIGIN_NOT_ALLOWED` before `cors()` runs |
| 58 | Tiered rate limiting | ✅ | 8 limiters by traffic class |
| 59 | Documented CSRF strategy | ✅ | Three layers; the code states why *"CORS prevents CSRF"* is false |
| 60 | Parameterised SQL everywhere | ✅ | Injection payloads tested against search, titles, sort and path params |
| 61 | Secure file uploads | ✅ | Magic number, re-encode, EXIF strip, UUID names, outside the web root, authorised route only |
| 62 | No secrets or stack traces in responses | ✅ | Asserted in `tests/validation.test.ts` |
| 63 | Structured logging with redaction | ✅ | pino with a redaction list; request-id correlation |
| 64 | Append-only audit log | ✅ | Actor `ON DELETE SET NULL` so history survives user deletion |
| 65 | OWASP Top 10 review | ✅ | A01–A10 in `docs/security.md`, with gaps named |

## H. Frontend

| # | Item | Status | Evidence |
| --- | --- | :---: | --- |
| 66 | Three role dashboards + public pages | ✅ | 6 public, 3 citizen, 3 worker, 7 admin, 4 shared |
| 67 | Multi-step report wizard with real geolocation | ✅ | 4 steps, live duplicate check |
| 68 | Every screen handles loading / success / empty / error | ✅ | `LoadingState`, `EmptyState`, `ErrorState` used throughout |
| 69 | Accessibility: semantics, keyboard, labels, focus, contrast, alt text | ✅ | Covered by `components.test.tsx` **and** `eslint-plugin-jsx-a11y` in the lint step — verified to still catch empty labels, missing alt text and invalid anchors. Status never colour-alone |
| 70 | Responsive from 320 px | ✅ | Fluid grids and tokens; no fixed-width layouts |

---

## Explicit non-claims

Things that are **not** done, stated plainly so nobody is misled:

1. **Docker is unverified.** The Dockerfiles and Compose file were written and
   reviewed by inspection. No Docker daemon existed in this environment, so
   `docker compose up` has never run. Treat them as a starting point.
2. **No browser-automation testing.** No headless browser was available, so the
   UI was verified through HTTP responses, the production build, typechecking
   and component tests — not by driving a real browser. There are no
   screenshots and no visual regression coverage.
3. **The Compose file is not production.** Weak committed credentials, no TLS,
   no resource limits, no backups.
4. **Email is not wired up.** Password reset generates and validates tokens
   correctly, but without a mail provider the delivery step is a log line.
5. **Rate limiting is in-process.** Correct for one instance; becomes
   per-instance the moment you scale out.
6. **No MFA, no CAPTCHA, no breached-password API, no virus scanning** beyond
   image format validation and re-encoding.
7. **No load testing.** Indexes were chosen from query shape and `EXPLAIN`, not
   from measured production traffic.
8. **The database was rebuilt from scratch mid-verification.** The sandbox
   reset removed the PostgreSQL installation (it lived outside the workspace).
   Reinstalling, re-running all 6 migrations against an empty database, and
   re-seeding worked first time — which is a stronger test of the documented
   setup path than the original run was. All figures above were re-measured
   afterwards.
9. **The SDG 11 impact claim is deliberately modest.** This shortens the
   distance between noticing a problem and the right person knowing about it.
   It does not fill potholes.
