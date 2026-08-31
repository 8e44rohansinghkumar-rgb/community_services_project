# User flows

How each role actually uses the system, with the decision points and failure
paths that matter. Diagrams are Mermaid and render on GitHub.

---

## Roles at a glance

```mermaid
flowchart LR
    subgraph Public[" No account "]
        V[Visitor]
    end
    subgraph Auth[" Signed in "]
        C[Citizen]
        W[Worker]
        A[Admin]
    end

    V -->|browse public feed & map| PF[(Public issues)]
    V -->|register| C
    C -->|report, comment, confirm, reopen| I[(Issues)]
    W -->|progress, evidence, resolve| I
    A -->|triage, assign, prioritise, close| I
    A -->|manage| M[(Users · Categories · Departments)]
    A -->|read| AU[(Audit log)]

    style V fill:#e8eef5,stroke:#0b1f38
    style C fill:#fff4d6,stroke:#7a5200
    style W fill:#dff0e4,stroke:#1c5c34
    style A fill:#0b1f38,stroke:#0b1f38,color:#fff
```

---

## 1. Registration and sign-in

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (SPA)
    participant A as API
    participant D as PostgreSQL

    B->>A: GET /api/auth/csrf
    A-->>B: Set-Cookie civic_csrf (readable by JS)

    B->>A: POST /api/auth/register {name,email,password}<br/>X-CSRF-Token
    A->>A: Zod validation (12+ chars, mixed case, digit, symbol)
    A->>D: SELECT 1 FROM users WHERE email = $1
    alt Address already registered
        A-->>B: 409 EMAIL_ALREADY_REGISTERED
    else New address
        A->>A: Argon2id hash (19 MiB, t=2)
        A->>D: INSERT user (role forced to CITIZEN)
        A->>D: INSERT refresh_token (SHA-256 hash, new family)
        A->>D: INSERT audit_log USER_REGISTERED
        A-->>B: 201 + Set-Cookie civic_access, civic_refresh<br/>civic_csrf rotated
    end

    Note over B,A: 15 minutes later the access cookie expires

    B->>A: GET /api/issues
    A-->>B: 401 UNAUTHENTICATED
    B->>A: POST /api/auth/refresh (single-flight)
    A->>D: Look up token by hash; rotate
    alt Token already used → theft
        A->>D: Revoke entire family
        A-->>B: 401 REFRESH_TOKEN_INVALID
        B->>B: Clear state, redirect to /login
    else Valid
        A-->>B: 200 + new access & refresh cookies
        B->>A: GET /api/issues (replayed automatically)
        A-->>B: 200
    end
```

The role is never taken from the request. Registration always produces a
`CITIZEN`; staff accounts are created by an admin through `POST /users`.

---

## 2. Citizen: reporting an issue

The wizard is four steps so that the location step can do real work — asking for
geolocation, showing the pin, and checking for duplicates — without burying it
in a long form.

```mermaid
flowchart TD
    S([Report an issue]) --> S1[Step 1 · Category and severity]
    S1 --> S2[Step 2 · Location]
    S2 --> GEO{Use my location?}
    GEO -->|Allow| PIN[Pin from GPS, address reverse-filled]
    GEO -->|Deny or unavailable| MAN[Enter address / drag the pin]
    PIN --> DUP
    MAN --> DUP

    DUP[GET /issues/duplicate-check<br/>category + 150 m + 7 days] --> Q{Nearby report found?}
    Q -->|Yes| SHOW[Show the existing report<br/>with distance and status]
    SHOW --> CHOICE{Same problem?}
    CHOICE -->|Yes| OPEN[Open it and comment instead] --> E([Done])
    CHOICE -->|No, mine is different| S3
    Q -->|No| S3

    S3[Step 3 · Title, description, photos] --> VAL{Client-side checks pass?}
    VAL -->|No| S3
    VAL -->|Yes| S4[Step 4 · Review and submit]

    S4 --> POST[POST /api/issues multipart]
    POST --> R{Server response}
    R -->|201| DONE[Reference CIV-2026-000137 shown<br/>Priority calculated server-side]
    R -->|400| FIX[Field errors highlighted inline] --> S3
    R -->|409 DUPLICATE_SUBMISSION| SAME[You just filed this — link to it] --> E
    R -->|413| BIG[File too large, listed by name] --> S3
    DONE --> E

    style DONE fill:#dff0e4,stroke:#1c5c34
    style SAME fill:#fff4d6,stroke:#7a5200
    style FIX fill:#fde8e8,stroke:#8a1c1c
```

Duplicate detection **advises**, it does not block. Two people reporting the same
pothole is signal that it is worse than one report suggests — the second report
raises the priority score rather than being discarded. Only an *identical*
resubmission by the *same* reporter within a few minutes is refused, because
that is a double-clicked submit button.

---

## 3. Admin: triage and assignment

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin
    participant API
    participant DB as PostgreSQL
    participant W as Worker

    A->>API: GET /api/issues?status=REPORTED&sortBy=priority
    API-->>A: Queue, highest priority first

    A->>API: GET /api/issues/:id
    API-->>A: Detail + allowedTransitions for THIS admin

    alt Not a municipal matter
        A->>API: POST /:id/status {REJECTED, reason}
        Note right of API: A reason is mandatory —<br/>the citizen is told why
        API->>DB: status + history + notification + audit
    else Genuine
        A->>API: GET /api/workers
        API-->>A: Workers ordered by current workload

        A->>API: POST /:id/assign {workerId, note}

        rect rgb(232, 238, 245)
            Note over API,DB: One transaction — all or nothing
            API->>DB: BEGIN
            API->>DB: Deactivate any previous assignment
            API->>DB: INSERT issue_assignments (active)
            API->>DB: UPDATE issues SET status='ASSIGNED'
            API->>DB: INSERT issue_status_history
            API->>DB: INSERT notification for the worker
            API->>DB: INSERT audit_log ISSUE_ASSIGNED
            API->>DB: COMMIT
        end

        alt Another admin assigned first
            DB-->>API: 23505 on uq_issue_active_assignment
            API-->>A: 409 ALREADY_ASSIGNED
        else
            API-->>A: 200
            API-->>W: Notification appears (badge count)
        end
    end
```

The partial unique index `uq_issue_active_assignment` is what makes concurrency
safe: two admins assigning the same issue at the same instant cannot both
succeed. The loser gets a clean 409 instead of the issue silently ending up with
two owners.

---

## 4. Worker: doing the job

```mermaid
stateDiagram-v2
    [*] --> Assigned: Admin assigns

    Assigned --> InProgress: Worker starts<br/>(assigned worker only)
    InProgress --> OnHold: Blocked<br/>(reason required)
    OnHold --> InProgress: Unblocked
    InProgress --> Resolved: Mark resolved<br/>(≥1 RESOLUTION photo required)

    Resolved --> Closed: Reporter confirms
    Resolved --> Reopened: Reporter rejects the fix<br/>(reason required)
    Reopened --> Assigned: Admin reassigns

    Closed --> [*]

    note right of InProgress
        Only the ASSIGNED worker.
        Any other worker: 403.
    end note

    note right of Resolved
        Evidence gate: RESOLVED
        without a photo is a 400.
    end note
```

The evidence gate is a process control as much as a technical one. "Mark as
done" with no proof is how a maintenance backlog becomes fiction; requiring a
photograph means the citizen can see the repair, and a reopened issue has a
before-and-after record attached to it.

Worker screens are built for a phone at a roadside: large tap targets, the
photograph capture as the primary action, and every list showing status as text
and shape, not colour alone.

---

## 5. Citizen: closing the loop

```mermaid
flowchart LR
    N[Notification:<br/>your issue was resolved] --> D[Open the issue]
    D --> P[Compare the original photo<br/>with the resolution photo]
    P --> Q{Actually fixed?}
    Q -->|Yes| CL[Close it] --> T([Closed — counts as resolved])
    Q -->|No| RO[Reopen with a reason]
    RO --> BACK[Status → REOPENED<br/>Previous assignment deactivated<br/>Admin notified] --> RE([Back in the queue])

    style T fill:#dff0e4,stroke:#1c5c34
    style RE fill:#fff4d6,stroke:#7a5200
```

Only the reporter (or an admin) can close. A worker marking their own work as
finished-and-accepted would defeat the point of the confirmation step.

Entering `REOPENED` deactivates the active assignment. Without that, the partial
unique index would block reassignment and the issue would be stuck — a bug found
and fixed during smoke testing, and now covered by an explicit regression test.

---

## 6. Anonymous visitor

```mermaid
flowchart TD
    L[Landing page] --> B{What do they want?}
    B -->|See what's happening| M[Community map and list]
    B -->|Understand the process| H[How it works]
    B -->|Report something| R{Have an account?}

    M --> F[GET /api/issues/public]
    F --> PRIV[Reporter identity removed<br/>Coordinates rounded to ~110 m<br/>Private and spam excluded]
    PRIV --> DET[Public issue detail:<br/>status, timeline, photos]

    R -->|Yes| LI[Sign in] --> W[Report wizard]
    R -->|No| RG[Register] --> W

    style PRIV fill:#e8eef5,stroke:#0b1f38
```

The public feed is the privacy-sensitive surface. A report is a statement that
someone was at a particular place and cared about it; exact coordinates plus a
name would be enough to infer home addresses and routines. So the anonymous feed
carries no reporter identity and rounds coordinates to three decimal places
(~110 m) — precise enough to show a neighbourhood problem, too coarse to
identify a doorstep. Signed-in staff see full precision because they have to go
and fix it.

---

## 7. Every screen's four states

Each list and detail view handles all four explicitly. There is no state in
which the user is left looking at a blank rectangle wondering whether it is
broken.

```mermaid
flowchart LR
    Q[Query] --> LO[Loading:<br/>skeleton + role=status<br/>announced to screen readers]
    Q --> OK[Success:<br/>the data]
    Q --> EM[Empty:<br/>explains why and<br/>what to do next]
    Q --> ER[Error:<br/>role=alert, plain message,<br/>Try again button]
    ER --> Q

    style LO fill:#e8eef5,stroke:#0b1f38
    style OK fill:#dff0e4,stroke:#1c5c34
    style EM fill:#fff4d6,stroke:#7a5200
    style ER fill:#fde8e8,stroke:#8a1c1c
```

Empty states are written for the situation, not generically: a brand-new
citizen's dashboard says something different from a filtered admin list that
matched nothing, because the useful next action is different.

---

## 8. Notifications

Generated inside the same transaction as the event that caused them, so a
notification can never exist for something that did not happen, nor be missing
for something that did.

| Event | Who is notified |
| --- | --- |
| Issue assigned | The worker |
| Status changed | The reporter |
| Comment added (not internal) | The reporter, and the assigned worker |
| Issue resolved | The reporter — prompting confirm or reopen |
| Issue reopened | The admins, and the previously assigned worker |

Each links straight to the issue. The unread count comes from
`GET /api/notifications/unread-count` and is invalidated by React Query when
anything relevant changes, so the badge is live rather than a stale number from
page load.

---

## Accessibility notes

Applied throughout, not bolted on:

- Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, and
  a "Skip to content" link as the first focusable element.
- Every input has a real `<label>`; errors are wired with `aria-invalid` and
  `aria-describedby` and announced via `role="alert"`.
- Status is conveyed by **text plus shape**, never colour alone — the same badge
  is legible in greyscale.
- Full keyboard operation, visible focus rings, and focus trapped in modals with
  Escape to close and focus returned to the trigger.
- Loading regions use `role="status"` with `aria-live="polite"`, so a screen
  reader user is told the page is working rather than hearing silence.
- Photographs carry meaningful alt text describing the issue and image type.
- Contrast meets WCAG AA against the navy/amber palette.
- Layout is responsive from 320 px upwards, tested down to a small phone, with
  tap targets sized for a gloved hand at a roadside.
