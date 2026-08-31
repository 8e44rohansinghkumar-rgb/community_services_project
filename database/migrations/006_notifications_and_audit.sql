-- 006_notifications_and_audit.sql
-- In-app notifications and the administrative audit trail.

CREATE TABLE IF NOT EXISTS notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       notification_type NOT NULL,
    title      text NOT NULL,
    body       text,
    issue_id   uuid REFERENCES issues (id) ON DELETE CASCADE,
    is_read    boolean NOT NULL DEFAULT false,
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_title_length CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT notifications_body_length CHECK (body IS NULL OR length(body) <= 1000),
    CONSTRAINT notifications_read_consistency CHECK (NOT is_read OR read_at IS NOT NULL)
);

-- Serves both the unread badge (COUNT WHERE NOT is_read) and the paginated list.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, is_read, created_at DESC);

-- Append-only. actor_id is SET NULL on user deletion so the action survives the
-- actor; no updated_at because rows are never modified.
CREATE TABLE IF NOT EXISTS audit_logs (
    id          bigserial PRIMARY KEY,
    actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    actor_email text,                      -- snapshot: readable even if user is gone
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text,
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip_address  inet,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_logs_action_length CHECK (length(action) BETWEEN 3 AND 80),
    CONSTRAINT audit_logs_entity_type_length CHECK (length(entity_type) BETWEEN 2 AND 40)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor   ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs (action);
