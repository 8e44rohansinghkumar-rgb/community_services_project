# Security model

This document describes what the application defends against, how, and — just
as importantly — what it does **not** defend against and what would need to
change before a real municipality put it on the public internet.

Everything described here is implemented and covered by tests. Where something
is deliberately out of scope it says so explicitly rather than being quietly
omitted.

---

## Threat model

The system holds a citizen's name, email, phone number, and a photograph with
coordinates of somewhere they cared enough to visit. That last combination is
the sensitive part: a public feed that pinned reports to exact coordinates would
let anyone infer where a named person lives, works, or walks their children to
school. The controls below are shaped by that.

| Adversary | What they want | Primary control |
| --- | --- | --- |
| Opportunistic scraper | Bulk citizen data | Anonymised public feed, coordinate rounding, pagination ceiling, rate limits |
| Credential stuffer | Any working account | Argon2id, uniform login errors, login rate limit, no user enumeration |
| Malicious citizen | Escalate to worker or admin | Server-side RBAC, role never client-supplied, `.strict()` schemas |
| Curious citizen | Read a neighbour's private report | Object-level ownership checks, 404-not-403 |
| Disgruntled worker | Touch issues they were not assigned | Assigned-worker checks on every write, append-only audit log |
| XSS / CSRF attacker | Act as a signed-in user | HttpOnly cookies, double-submit CSRF, Origin allowlist, CSP, React escaping |
| File-upload attacker | Execute code on the server | Magic-number validation, re-encoding, storage outside the web root, no static route |
| SQL injector | Read or destroy the database | Parameterised queries only, whitelisted sort columns |

Out of scope, and honestly so: a determined attacker with database credentials,
a compromised host, a malicious administrator, or a state-level adversary. Those
need infrastructure controls this application cannot provide.

---

## Authentication

### Password storage

**Argon2id**, the current OWASP first choice, with parameters from the OWASP
Password Storage Cheat Sheet:

```ts
{ type: argon2.argon2id, memoryCost: 19_456 /* 19 MiB */, timeCost: 2, parallelism: 1 }
```

Argon2id rather than bcrypt because it is memory-hard: 19 MiB per hash makes
GPU and ASIC cracking dramatically more expensive, where bcrypt's tiny working
set does not. The parameters are a deliberate compromise — high enough to hurt
an attacker, low enough that a modest municipal server can still authenticate
users without falling over.

Passwords must be at least 12 characters with upper case, lower case, a digit
and a symbol. Length is weighted over exotic composition rules, because
composition rules mostly produce `Password1!`.

### No user enumeration

`POST /auth/login` returns exactly the same `401 INVALID_CREDENTIALS` for an
unknown address and a wrong password. When the address is unknown the server
still verifies against a **dummy hash**, so the response time does not give the
answer away either — a timing difference is just a slower oracle.

`POST /auth/forgot-password` always returns 200, whether or not the address
exists.

### Sessions

| | Access token | Refresh token |
| --- | --- | --- |
| Format | Signed JWT | 256 bits of `crypto.randomBytes` |
| Lifetime | 15 minutes | 30 days |
| Storage server-side | none (stateless) | SHA-256 hash in `refresh_tokens` |
| Cookie | `civic_access`, `Path=/` | `civic_refresh`, `Path=/api/auth` |

Both cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

**Nothing is ever written to `localStorage`.** A token in `localStorage` is
readable by any JavaScript that runs on the page, which turns any XSS — in your
code or in a dependency — into full account takeover. An `HttpOnly` cookie is
not readable by script at all. A frontend test asserts that no
`localStorage.setItem` or `getItem` call happens during authenticated requests,
so this cannot regress quietly.

The refresh cookie is scoped to `/api/auth`, so the browser does not attach it
to ordinary API calls. It travels only when it is actually needed, which shrinks
its exposure considerably.

### Rotation and reuse detection

Every call to `/auth/refresh` issues a new token and retires the one presented.
Tokens are stored hashed — a database leak yields hashes, not usable sessions —
and each carries a `family_id`.

Presenting an **already-retired** token means a copy exists somewhere it should
not. The server cannot tell whether the legitimate user or the thief is holding
the copy, so it revokes the whole family. The attacker loses access, the user is
forced to log in again, and what would have been silent long-term access becomes
a single visible logout.

`users.token_version` is the blunt instrument for immediate revocation: it is
embedded in each access token and compared on every request. Changing a
password, "sign out everywhere", or an admin changing a role or deactivating an
account all increment it, invalidating every outstanding access token at once
instead of waiting up to 15 minutes for natural expiry.

---

## CSRF

Cookie authentication means the browser attaches credentials automatically —
exactly the condition CSRF exploits. Three independent layers:

**1. `SameSite=Lax`.** Blocks the common cross-site `POST`. Necessary but not
sufficient: it is a browser-side default, older browsers ignore it, and `Lax`
still allows top-level `GET` navigation.

**2. Double-submit token.** `civic_csrf` is readable by JavaScript **on
purpose** — the SPA must read it to echo it in `X-CSRF-Token`. That is safe: the
same-origin policy prevents an attacker's page from reading it, so while they
can cause the cookie to be *sent*, they cannot populate the *header*. Values are
compared with `crypto.timingSafeEqual`.

**3. Origin allowlist.** Every unsafe request must carry an `Origin` (or
`Referer`) that is absent — meaning a non-browser client such as curl, which is
not subject to CSRF — or present in `CORS_ORIGIN`.

> **"CORS prevents CSRF" is false**, and the codebase says so in a comment where
> someone might be tempted. CORS restricts whether JavaScript may *read a
> response*. A simple cross-origin `POST` is still **delivered and executed**;
> the attacker simply never sees the reply. For a state-changing request that is
> all they needed. Hence the explicit checks above.

The bootstrap problem — you need a token to log in, but you have no token before
logging in — is solved with a safe `GET /api/auth/csrf`, which is exempt because
`GET` is exempt. The much worse alternative would have been exempting the login
endpoint itself. The token is **rotated on login**, so a token fixed by an
attacker before authentication is useless afterwards.

---

## Authorisation

Two distinct checks, both server-side, both on every request. Nothing in the UI
is a security control; hidden buttons are a usability feature.

**Role check** — "may this *kind* of user call this endpoint?" Applied as route
middleware (`requireRole('ADMIN')`).

**Ownership check** — "may this *specific* user touch this *specific* row?"
Applied in the service layer, because only it knows the record.

`resolveAccess()` reduces a caller and an issue to one of four levels:

```
ADMIN  >  OWNER  >  ASSIGNED_WORKER  >  PUBLIC_VIEWER  →  otherwise 404
```

A worker who is not assigned to a public issue can *read* it (200) but any
attempt to act on it is a 403. A citizen who is not the reporter of a private
issue gets a 404 — see below.

### Role permissions

| Action | Citizen | Worker | Admin |
| --- | :---: | :---: | :---: |
| Report an issue | ✅ | ❌ | ✅ |
| View own reports | ✅ | — | ✅ |
| View assigned work | — | ✅ | ✅ |
| View all issues | ❌ | ❌ | ✅ |
| Edit an issue | own, while `REPORTED` | ❌ | ✅ |
| Comment | own issues | assigned | ✅ |
| Internal comment | ❌ | ✅ | ✅ |
| Change status | close/reopen own | assigned only | ✅ |
| Assign a worker | ❌ | ❌ | ✅ |
| Set official priority | ❌ | ❌ | ✅ |
| Upload resolution evidence | ❌ | assigned | ✅ |
| Manage users, categories, departments | ❌ | ❌ | ✅ |
| Read audit log | ❌ | ❌ | ✅ |
| Export data | ❌ | ❌ | ✅ |

Roles are **never** accepted from the client. `POST /auth/register` always
creates a `CITIZEN`; staff accounts exist only via `POST /users` by an existing
admin. Every Zod schema is `.strict()`, so smuggling `role` or `officialPriority`
into a request body is a 400, not a silent field assignment.

Two self-inflicted-wound guards: an admin cannot deactivate or demote
themselves, and the last remaining admin cannot be demoted (`409 LAST_ADMIN`).

### IDOR: 404, not 403

Requesting an issue you may not see returns **404**. A 403 would confirm the
record exists, and iterating identifiers against a 403/404 difference is a cheap
way to enumerate private reports. `tests/rbac.test.ts` asserts the 404
specifically, so a future "helpful" error message cannot reintroduce the leak.

---

## Input validation and SQL injection

**Every** request body, query string and path parameter passes through a Zod
schema before a controller sees it. Schemas are `.strict()`, coerce and bound
numbers, cap string lengths, and validate enums against the same values as the
PostgreSQL enum types.

All SQL uses **parameterised queries** through `pg`. There is no string
interpolation of user input anywhere in the data layer:

```ts
// The only pattern used.
await db.query('SELECT * FROM issues WHERE reporter_id = $1 AND status = $2::issue_status', [userId, status]);
```

The one place user input could reach query *text* is a sort column, because a
column name cannot be a bound parameter. That is exactly why `sortBy` maps
through a whitelist; anything else is a 400. `tests/validation.test.ts` fires
classic payloads (`'; DROP TABLE issues; --`, `' OR '1'='1`,
`' UNION SELECT password_hash FROM users --`) at search, titles, sort fields and
path parameters, then asserts the tables are still intact and the payload was
stored as literal text.

---

## File uploads

The most dangerous feature in the application, and treated accordingly.

1. **Multer with `memoryStorage`** and a hard size limit — nothing untrusted is
   written to disk before it has been validated.
2. **Magic-number inspection.** The first bytes must match JPEG, PNG or WebP.
   The `Content-Type` header and the file extension are attacker-controlled and
   are not trusted; a PHP script named `shell.png` and declared `image/png` is
   rejected here.
3. **Re-encoding with sharp.** Every accepted image is decoded and written
   afresh, with a pixel-count ceiling to stop decompression bombs. This destroys
   any polyglot or appended payload, and strips **all EXIF** — including the GPS
   tags and device identifiers that would otherwise leak the photographer's
   precise location and hardware.
4. **Server-generated names.** Stored as `YYYY/MM/<uuid>.<ext>`. The client's
   filename is never used in a path; `../../etc/passwd.png` cannot traverse
   anywhere. A test asserts the stored key matches the expected pattern.
5. **Storage outside the web root**, with no static route. Files are readable
   only through `GET /api/issues/:id/images/:imageId`, which re-applies the
   parent issue's access rules and requires the image to belong to that issue.
6. **Hardened delivery.** `X-Content-Type-Options: nosniff` plus a sandboxing
   CSP, so even a file that somehow got through cannot execute in a browser.
7. **SVG is rejected outright.** It is a document format that can carry script,
   and nothing here needs it.

---

## Transport and headers

Helmet, configured explicitly rather than left at defaults:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'`, sandboxed | The API returns JSON and images; nothing else should ever load |
| `X-Content-Type-Options` | `nosniff` | Stops MIME sniffing turning an upload into script |
| `X-Frame-Options` | `DENY` | No clickjacking |
| `Referrer-Policy` | `no-referrer` | Issue URLs contain identifiers; don't leak them to third parties |
| `Strict-Transport-Security` | 1 year, production only | Enabling it on `http://localhost` would poison the developer's browser for every other localhost project |
| `X-Powered-By` | removed | Don't advertise the framework and version |

The `/docs` route overrides the CSP for itself only — Swagger UI needs inline
styles and scripts — while still forbidding framing, plugins and form
submission. The API-wide policy is untouched.

**CORS** uses an explicit env-driven allowlist. Never `*`: a wildcard is
incompatible with credentialed requests and would let any site call the API with
the user's cookies. A disallowed `Origin` is rejected with `403
ORIGIN_NOT_ALLOWED` by a guard that runs **before** the `cors()` middleware,
because throwing from the cors origin callback surfaces as an opaque 500.
Requests with no `Origin` (curl, server-to-server, health checks) are permitted;
they are not browser requests and carry no CSRF risk.

---

## Logging and error handling

One central error handler. Operational errors (`AppError` subclasses) carry a
safe code and message. Anything else becomes a generic `500 INTERNAL_ERROR` with
a `requestId`; the real cause goes to the log and never to the client.

Structured JSON logging with pino, with a redaction list applied to every log
line:

```
req.headers.authorization, req.headers.cookie, req.headers["x-csrf-token"],
res.headers["set-cookie"], password, newPassword, currentPassword,
passwordHash, password_hash, token, accessToken, refreshToken,
refresh_token, token_hash, *.password
```

Redaction is a *safety net*, not the plan. The plan is not to log those things
in the first place; the net catches the mistake when someone logs a whole
request object.

Every request gets a UUID, returned in `X-Request-Id` and in error responses,
which correlates a user's complaint with the exact server log line.

### Audit log

Append-only. Never updated, never deleted. Records actor, action, entity type
and id, IP, user agent, and a JSON metadata blob, for every consequential
action: logins, role and status changes, assignments, status transitions,
priority overrides, spam flags, soft deletes and data exports.

`actor_id` is `ON DELETE SET NULL`, not `CASCADE` — deleting a user must never
erase the record of what they did. The same applies to status history. This is
the single most important reason the schema avoids cascading deletes on
historical tables.

---

## OWASP Top 10 (2021) review

**A01 Broken Access Control** — Role checks in middleware, ownership checks in
services, never in the UI alone. 404-not-403 for unauthorised object access.
Roles never client-supplied; `.strict()` schemas block mass assignment. Covered
by `tests/rbac.test.ts` (31 assertions) including cross-tenant reads, edits,
list scoping, worker queue isolation and notification scoping.

**A02 Cryptographic Failures** — Argon2id at OWASP parameters. Refresh tokens
stored as SHA-256 hashes. Secrets from environment variables only, never in
source; `.env` is git-ignored and `.env.example` holds placeholders. HttpOnly +
Secure + SameSite cookies. HSTS in production. Constant-time comparison for CSRF
tokens. *Gap: at-rest encryption is delegated to the database and filesystem.*

**A03 Injection** — Parameterised SQL everywhere; no string interpolation of
user input. Sort columns whitelisted. Zod validation on every input. React
escapes by default and `dangerouslySetInnerHTML` appears nowhere. CSV export
neutralises cells beginning `=`, `+`, `-`, `@` so a spreadsheet cannot be
tricked into executing them.

**A04 Insecure Design** — The state machine makes illegal workflow states
unrepresentable rather than merely discouraged. Multi-record operations run in
transactions. Rate limiting is tiered by abuse potential. Duplicate detection
resists accidental spam. Resolution requires photographic evidence — a process
control, not just a technical one.

**A05 Security Misconfiguration** — Helmet configured explicitly. CORS
allowlisted, never `*`. `X-Powered-By` off. Environment validated at startup with
Zod, so the process refuses to boot with a missing or malformed secret rather
than failing mysteriously later. Seeds refuse to run in production. Generic
error messages in production.

**A06 Vulnerable and Outdated Components** — Deliberately small dependency list;
no ORM, no UI framework, no chart library (the charts are hand-written SVG). `npm
audit` is part of the workflow. *Gap: no automated dependency scanning in CI.*

**A07 Identification and Authentication Failures** — Strong password policy,
tiered rate limits on every auth endpoint, no user enumeration (uniform errors
plus a dummy hash for timing), short access token life, refresh rotation with
reuse detection, immediate global revocation via `token_version`. *Gap: no MFA;
see below.*

**A08 Software and Data Integrity Failures** — No dynamic code loading, no
untrusted deserialisation. Uploads re-encoded rather than trusted. Migrations
are versioned, sequential and take an advisory lock so two instances cannot
migrate concurrently. Audit log is append-only.

**A09 Security Logging and Monitoring Failures** — Structured logging with
redaction, request-id correlation, and an audit log covering every
consequential action including failed logins. *Gap: no alerting or log
aggregation; those are deployment concerns.*

**A10 Server-Side Request Forgery** — The application makes no outbound HTTP
requests on behalf of users. There is no URL-fetching feature, no webhook, and
no image-by-URL import. The optional AI classifier is an interface with a local
rule-based implementation; enabling a remote provider would introduce the first
outbound call and would need an allowlist.

---

## Known limitations

Being straight about what is not done matters more than a longer feature list.

**Not production-ready as configured.** The Docker Compose file is a development
convenience with weak default credentials, no TLS, and no resource limits. It is
not a deployment artefact.

**Before a real deployment:**

1. Replace every secret. `JWT_SECRET` and `COOKIE_SECRET` must be freshly
   generated, high-entropy, and stored in a secrets manager, not a `.env` file.
2. Terminate TLS at a reverse proxy and set `NODE_ENV=production`, which turns
   on `Secure` cookies and HSTS.
3. Move file storage to S3 or equivalent. The storage layer is already an
   interface with a local-disk implementation precisely so this is a swap, not a
   rewrite — but local disk does not survive a container restart and does not
   scale past one instance.
4. Move rate limiting to shared state (Redis) or the edge. In-memory limits
   become per-instance the moment you run two instances.
5. Add real email delivery. Password reset currently logs the link in
   development; without a mail provider the flow is incomplete.
6. Configure database TLS, connection limits, least-privilege roles, backups,
   and restore *drills* — an untested backup is a hope, not a backup.
7. Add MFA for admin accounts. An admin can read every citizen's contact details;
   a password alone is thin protection for that.
8. Add automated dependency scanning and log aggregation with alerting.
9. Commission a penetration test. This document is a design review by the
   author of the code, which is not the same thing.

**Accepted for now:** no field-level encryption for phone numbers; no
per-account lockout after repeated failures (rate limiting is per-IP, so a
distributed attacker gets more attempts than they should); no CAPTCHA on
registration; no virus scanning of uploads beyond format validation and
re-encoding.
