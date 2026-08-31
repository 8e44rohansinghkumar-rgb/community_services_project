-- 005_issue_children.sql
-- Images, comments, immutable status history, and assignments.

CREATE TABLE IF NOT EXISTS issue_images (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id      uuid NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    uploaded_by   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- Server-generated opaque key (never the client filename).
    storage_key   text NOT NULL,
    original_name text,
    mime_type     text NOT NULL,
    size_bytes    integer NOT NULL,
    width         integer,
    height        integer,
    type          image_type NOT NULL DEFAULT 'REPORT',
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT issue_images_storage_key_unique UNIQUE (storage_key),
    CONSTRAINT issue_images_size_positive CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    -- Defence in depth: even a bug in the upload pipeline cannot record an
    -- executable or SVG mime type.
    CONSTRAINT issue_images_mime_allowlist CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT issue_images_key_no_traversal CHECK (storage_key !~ '\.\.' AND storage_key !~ '^/')
);

CREATE INDEX IF NOT EXISTS idx_issue_images_issue ON issue_images (issue_id, type);

CREATE TABLE IF NOT EXISTS issue_comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id    uuid NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body        text NOT NULL,
    -- Internal notes are visible to staff only; never returned to citizens.
    is_internal boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT issue_comments_body_length CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments (issue_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_issue_comments_updated_at ON issue_comments;
CREATE TRIGGER trg_issue_comments_updated_at
    BEFORE UPDATE ON issue_comments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only audit trail of the lifecycle. changed_by is SET NULL rather than
-- CASCADE: removing a user must never erase the record that a change happened.
CREATE TABLE IF NOT EXISTS issue_status_history (
    id              bigserial PRIMARY KEY,
    issue_id        uuid NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    previous_status issue_status,
    new_status      issue_status NOT NULL,
    changed_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT issue_status_history_reason_length CHECK (reason IS NULL OR length(reason) <= 1000),
    CONSTRAINT issue_status_history_actual_change CHECK (previous_status IS DISTINCT FROM new_status)
);

CREATE INDEX IF NOT EXISTS idx_issue_status_history_issue ON issue_status_history (issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_assignments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id     uuid NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    worker_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    assigned_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    note         text,
    assigned_at  timestamptz NOT NULL DEFAULT now(),
    unassigned_at timestamptz,
    accepted_at  timestamptz,
    completed_at timestamptz,
    active       boolean NOT NULL DEFAULT true,
    CONSTRAINT issue_assignments_note_length CHECK (note IS NULL OR length(note) <= 1000),
    CONSTRAINT issue_assignments_inactive_has_end CHECK (active OR unassigned_at IS NOT NULL)
);

-- THE concurrency guard (spec §36): two admins assigning the same issue at the
-- same instant means one transaction raises 23505, which the service maps to 409.
CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_active_assignment
    ON issue_assignments (issue_id) WHERE active;

CREATE INDEX IF NOT EXISTS idx_issue_assignments_worker_active
    ON issue_assignments (worker_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_issue_assignments_worker_history
    ON issue_assignments (worker_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_issue
    ON issue_assignments (issue_id, assigned_at DESC);
