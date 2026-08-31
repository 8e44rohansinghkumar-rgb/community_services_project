# API reference

The machine-readable contract is [`openapi.yaml`](./openapi.yaml). With the
server running it is also served as interactive documentation:

| URL | What it is |
| --- | --- |
| <http://localhost:4000/docs> | Swagger UI, with a working "Try it out" |
| <http://localhost:4000/docs/openapi.yaml> | The raw specification |
| <http://localhost:4000/docs/openapi.json> | The same document as JSON |

This page is the narrative companion: the conventions that apply everywhere and
the reasoning behind them. All 60 operations are covered by the spec, and a
check in `scripts/` compares the spec against the routes actually mounted, so
the two cannot drift apart silently.

---

## Base URL

Everything lives under `/api`.

In development the SPA runs on port 5173 and Vite proxies `/api` to the API on
port 4000, so the browser only ever makes **same-origin** requests. In
production a reverse proxy serves the built SPA and the API under one hostname.
The browser therefore never needs a cross-origin credentialed request, and
`SameSite=Lax` cookies work without exception.

---

## Response envelope

Every response — success or failure — has the same shape, so client code has
exactly one thing to branch on.

**Success**

```json
{ "success": true, "data": { "issue": { "id": "…", "title": "…" } } }
```

**Success, paginated**

```json
{
  "success": true,
  "data": [ { "id": "…" }, { "id": "…" } ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The submitted data is invalid",
    "details": [
      { "field": "title", "message": "Title must be at least 8 characters" },
      { "field": "latitude", "message": "Latitude must be between -90 and 90" }
    ],
    "requestId": "8f14e45f-ceea-467a-9f6b-1d2b3c4d5e6f"
  }
}
```

`code` is stable and machine-readable — switch on it. `message` is written for a
human and is safe to display. `details` appears on validation failures and lists
**every** offending field at once, so a form can highlight all its problems in a
single round trip rather than making the user discover them one at a time.

`requestId` is echoed in the `X-Request-Id` response header and appears on the
matching server log line. When a citizen reports "it said something went wrong",
that id is what turns an unanswerable complaint into a one-line log query.

### What is never in a response

Stack traces, SQL text or driver errors, file paths, password hashes, token
values, environment variables, or the name and version of the framework
(`X-Powered-By` is disabled). In production an unexpected exception becomes a
generic `INTERNAL_ERROR` with a `requestId`; the detail goes to the log.

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | The body, query or params failed schema validation. See `details`. |
| `UNAUTHENTICATED` | 401 | No valid session cookie. Refresh, then re-login. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password — deliberately identical for both. |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh token missing, expired, revoked or **reused**. |
| `FORBIDDEN` | 403 | Authenticated, but this role or user may not do this. |
| `CSRF_TOKEN_INVALID` | 403 | Missing or mismatched `X-CSRF-Token`. |
| `ORIGIN_NOT_ALLOWED` | 403 | The `Origin` header is not in the allowlist. |
| `ACCOUNT_DISABLED` | 403 | The account has been deactivated by an administrator. |
| `ISSUE_NOT_FOUND` | 404 | No such issue — **or** one this caller may not see. |
| `ROUTE_NOT_FOUND` | 404 | No such endpoint. |
| `INVALID_TRANSITION` | 409 | The requested status change is not legal from the current state. |
| `DUPLICATE_SUBMISSION` | 409 | The same reporter just filed an identical report. |
| `ALREADY_ASSIGNED` | 409 | Another active assignment exists (lost a concurrent race). |
| `EMAIL_ALREADY_REGISTERED` | 409 | That address already has an account. |
| `LAST_ADMIN` | 409 | Refusing to demote the only remaining administrator. |
| `FILE_TOO_LARGE` | 413 | Upload exceeded `MAX_FILE_SIZE`. |
| `INVALID_FILE_TYPE` | 400 | Rejected by magic-number inspection. |
| `RATE_LIMITED` | 429 | Too many requests from this IP for this traffic class. |
| `INTERNAL_ERROR` | 500 | Unexpected fault. Details are in the log under `requestId`. |

### 404 versus 403 — a deliberate choice

Asking for an issue you are not allowed to see returns **404**, not 403.

A 403 would confirm that the record exists. Iterating UUIDs against a 403/404
difference is a cheap way to map private reports, and "issue 7f3a… exists and is
hidden from you" is itself a disclosure. The rule is: if you cannot see it, it
does not exist as far as the API is concerned.

Route-level role failures — a citizen calling an admin-only endpoint — return a
plain **403**, because no object identity is involved and hiding the endpoint
would just be confusing.

---

## Authentication

Cookie-based. No bearer tokens, and nothing in `localStorage`.

| Cookie | Contents | Lifetime | Flags |
| --- | --- | --- | --- |
| `civic_access` | Signed JWT | 15 minutes | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production |
| `civic_refresh` | Opaque 256-bit random token | 30 days | `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` in production |
| `civic_csrf` | CSRF token | session | `SameSite=Lax`, **readable by JavaScript by design** |

The access cookie is short-lived so that a stolen one is worth little. The
refresh cookie is scoped to `/api/auth`, so it is not even transmitted on
ordinary API calls — it only travels when it is actually needed.

A normal session looks like:

```
GET  /api/auth/csrf          → sets civic_csrf
POST /api/auth/login         → sets civic_access + civic_refresh, rotates civic_csrf
GET  /api/issues             → cookies ride along automatically
…15 minutes pass…
GET  /api/issues             → 401 UNAUTHENTICATED
POST /api/auth/refresh       → new access cookie + NEW refresh token
GET  /api/issues             → 200
```

The frontend does this automatically in `client/src/api/client.ts`. On a 401 it
performs one silent refresh and replays the original request. Concurrent 401s
share a single refresh promise — five dashboard queries expiring together must
not trigger five rotations, because that would look exactly like token theft.

### Refresh token rotation and reuse detection

Every refresh issues a brand-new token and retires the old one. Tokens are
stored as SHA-256 hashes, never in plaintext, and carry a `family_id`.

If a **retired** token is presented, the only reasonable explanation is that a
copy was stolen — either the attacker is using it after the real user rotated,
or the reverse. The server cannot tell which, so it revokes the entire family
and forces a fresh login. That converts silent long-term account access into a
single visible logout.

`token_version` on the user row provides the blunt instrument: changing a
password, using "sign out everywhere", or having a role or status changed by an
admin all bump it, which invalidates every outstanding access token immediately
rather than waiting up to 15 minutes for expiry.

---

## CSRF

`SameSite=Lax` is the first line of defence, but it is not the whole answer: it
is a browser-side default that older browsers ignore, and `Lax` still permits
top-level `GET` navigation. Cookie authentication means the browser attaches
credentials automatically, which is precisely the condition CSRF exploits, so
there is a second, explicit layer.

**Double-submit.** Every unsafe request (`POST`, `PATCH`, `PUT`, `DELETE`) must
send the value of the `civic_csrf` cookie back in the `X-CSRF-Token` header:

```bash
curl -X POST http://localhost:4000/api/issues/…/comments \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(read from the civic_csrf cookie)" \
  -b cookies.txt -c cookies.txt \
  -d '{"body":"Any update on this?"}'
```

An attacker's page can *cause* a cookie to be sent, but the same-origin policy
stops it *reading* one, so it cannot populate the header.

The token is bootstrapped by `GET /api/auth/csrf`, which is safe and therefore
exempt from the check — this resolves the chicken-and-egg problem of needing a
token in order to log in, without the much worse alternative of exempting the
login endpoint itself. The token is **rotated on login** so a token fixed before
authentication cannot be reused after it.

Third layer: an `Origin` allowlist, enforced before CORS runs. See
[security.md](./security.md).

---

## Pagination, sorting and filtering

Every list endpoint is paginated. There is no way to ask for "everything".

| Parameter | Rules |
| --- | --- |
| `page` | Integer ≥ 1. Default 1. |
| `limit` | Integer 1–100. Default 20 (25 for `/audit-logs`). |
| `sortBy` | Must be in that endpoint's whitelist. |
| `sortDir` | `asc` or `desc`. Default `desc`. |

A `limit` above the ceiling is **rejected with 400**, not silently clamped. A
client asking for 10,000 rows has a bug or bad intentions; quietly returning 100
hides the first and rewards the second.

`sortBy` maps through a whitelist to a column name. This is not decoration — a
column name cannot be a bound parameter in SQL, so it is the one place where
user input could reach the query text. The whitelist is what makes that
impossible. `?sortBy=password_hash` and `?sortBy=id;DROP TABLE issues` both
return 400.

Whitelist for `/issues`: `createdAt`, `updatedAt`, `priority`, `status`,
`title`, `resolvedAt`.

Filtering is per-endpoint and documented in the spec. `status` accepts a
comma-separated list (`?status=REPORTED,UNDER_REVIEW`); `search` runs against a
generated `tsvector` column with a GIN index rather than `LIKE '%…%'`.

---

## Rate limiting

Limits are per-IP and tiered by what the endpoint costs and how attractive it is
to abuse.

| Class | Endpoints | Why it is tighter or looser |
| --- | --- | --- |
| Login | `POST /auth/login` | Credential stuffing. |
| Registration | `POST /auth/register` | Bulk fake accounts. |
| Password reset | forgot / reset / change | Token brute force and mail flooding. |
| Issue creation | `POST /issues` | Writes rows and files. |
| Upload | `POST /issues/:id/images` | Disk and CPU (re-encoding). |
| Comment | `POST /issues/:id/comments` | Spam. |
| Authenticated | most signed-in traffic | Generous; a real dashboard is chatty. |
| Public | unauthenticated reads | Cacheable and cheap, but scrapeable. |

Exceeding a limit returns `429 RATE_LIMITED` with `RateLimit` headers. Limits
are disabled when `NODE_ENV=test` so a fast suite does not trip the login
limiter and produce failures unrelated to what is being tested; the limiter
behaviour itself is covered separately in `server/tests/rateLimit.test.ts`.

> A per-IP limiter in application memory is right for a single-instance
> deployment. Behind multiple instances it becomes per-instance, and shared
> state (Redis) or an edge limiter is needed. See the hardening notes in
> [security.md](./security.md).

---

## Worked examples

### Report an issue with a photograph

`multipart/form-data`, because the photograph goes with the report.

```bash
curl -X POST http://localhost:4000/api/issues \
  -b cookies.txt -c cookies.txt \
  -H "X-CSRF-Token: $CSRF" \
  -F "title=Deep pothole outside the school gate" \
  -F "description=A wheel-swallowing pothole has opened at the main gate. Children walk through here at 8am." \
  -F "categoryId=1" \
  -F "citizenSeverity=HIGH" \
  -F "latitude=28.2478" \
  -F "longitude=77.0712" \
  -F "landmark=Government Primary School main gate" \
  -F "images=@pothole.jpg"
```

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "3f2a…",
      "publicId": "CIV-2026-000137",
      "status": "REPORTED",
      "citizenSeverity": "HIGH",
      "officialPriority": "HIGH"
    },
    "images": [{ "id": "9c1b…", "type": "ORIGINAL" }],
    "potentialDuplicates": []
  }
}
```

Note `citizenSeverity` and `officialPriority` are separate fields.
`officialPriority` is calculated server-side; a client cannot set it. See
[architecture.md](./architecture.md) for the rule.

`potentialDuplicates` lists nearby recent reports in the same category so the UI
can offer "is this the same as CIV-2026-000121?" — the report is still created,
because refusing it outright would lose a genuine second report of a worsening
problem.

### Resolve an issue

The order matters, and the server enforces it.

```bash
# 1. Admin assigns. One transaction: assignment + status + history + notification + audit.
curl -X POST .../api/issues/$ID/assign -H "X-CSRF-Token: $CSRF" -b admin.txt \
  -d '{"workerId":"…","note":"Take the small excavator."}' -H 'Content-Type: application/json'

# 2. The ASSIGNED WORKER starts work. Any other worker gets 403.
curl -X POST .../api/issues/$ID/status -H "X-CSRF-Token: $CSRF" -b worker.txt \
  -d '{"status":"IN_PROGRESS"}' -H 'Content-Type: application/json'

# 3. Evidence first — RESOLVED without a RESOLUTION image returns 400.
curl -X POST .../api/issues/$ID/images -H "X-CSRF-Token: $CSRF" -b worker.txt \
  -F "type=RESOLUTION" -F "images=@repaired.jpg"

# 4. Now resolve.
curl -X POST .../api/issues/$ID/status -H "X-CSRF-Token: $CSRF" -b worker.txt \
  -d '{"status":"RESOLVED"}' -H 'Content-Type: application/json'

# 5. The REPORTER confirms — or reopens with a reason.
curl -X POST .../api/issues/$ID/status -H "X-CSRF-Token: $CSRF" -b citizen.txt \
  -d '{"status":"CLOSED"}' -H 'Content-Type: application/json'
```

Skipping a step is a `409 INVALID_TRANSITION`. Resolving without evidence is a
`400`. Rejecting, holding or reopening without a `reason` is a `400` — those are
exactly the outcomes a citizen will want explained.

The `allowedTransitions` array on `GET /api/issues/:id` contains precisely the
transitions **the calling user** may perform right now, so the UI can render
buttons from it and never offer an action that will fail. A unit test asserts
that everything the array offers is something `assertTransition` actually
accepts.

### Images

There is no static route to the upload directory. Files are read only through:

```
GET /api/issues/:id/images/:imageId
```

which applies the same access rules as the parent issue and additionally
requires that the image belong to that issue — a valid image id from a different
issue returns 404. Responses carry `X-Content-Type-Options: nosniff` and a
sandboxing CSP, so even a file that somehow got past magic-number validation
cannot execute in a victim's browser.

---

## Testing the API by hand

`scripts/smoke-test.sh` walks the whole system end to end — registration, login,
CSRF, reporting, triage, assignment, resolution, RBAC and error paths — as 131
assertions against a running server:

```bash
bash scripts/smoke-test.sh                       # defaults to http://127.0.0.1:4000/api
bash scripts/smoke-test.sh https://api.example/api
```

It is idempotent: identifiers carry a per-run suffix, so it can be run
repeatedly against the same database without tripping duplicate detection.
