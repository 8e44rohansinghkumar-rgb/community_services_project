-- 002_users_and_auth.sql
-- Departments, user accounts, and all authentication-related token tables.

CREATE TABLE IF NOT EXISTS departments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT departments_name_unique UNIQUE (name),
    CONSTRAINT departments_name_not_blank CHECK (length(btrim(name)) BETWEEN 2 AND 100)
);

CREATE TABLE IF NOT EXISTS users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    email          citext NOT NULL,
    password_hash  text NOT NULL,
    phone          text,
    role           user_role NOT NULL DEFAULT 'CITIZEN',
    department_id  uuid REFERENCES departments (id) ON DELETE SET NULL,
    is_active      boolean NOT NULL DEFAULT true,
    email_verified boolean NOT NULL DEFAULT false,
    -- Bumped on logout-all / password change / deactivation / role change.
    -- Embedded in the access JWT so outstanding tokens die immediately.
    token_version  integer NOT NULL DEFAULT 0,
    last_login_at  timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_name_length CHECK (length(btrim(name)) BETWEEN 2 AND 100),
    CONSTRAINT users_email_shape CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT users_phone_shape CHECK (phone IS NULL OR phone ~ '^[0-9+][0-9 ()-]{6,19}$'),
    CONSTRAINT users_token_version_positive CHECK (token_version >= 0)
);

-- Only workers may belong to a department; enforced so the data model cannot
-- drift into "citizen in the sanitation department".
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_department_only_for_staff;
ALTER TABLE users ADD CONSTRAINT users_department_only_for_staff
    CHECK (department_id IS NULL OR role IN ('WORKER', 'ADMIN'));

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users (role) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens: only a SHA-256 hash is stored, so a database leak does not
-- hand out usable sessions. `family_id` links a rotation chain: replaying an
-- already-rotated token revokes the entire family (theft detection).
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   text NOT NULL,
    family_id    uuid NOT NULL,
    user_agent   text,
    ip_address   inet,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    revoked_reason text,
    replaced_by  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- Password reset / email verification: hashed, single-use, short-lived.
-- Present so the flows are architecturally real rather than stubbed.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens (user_id);

-- Login attempt ledger: powers per-account throttling that survives an IP change
-- (IP-based rate limiting alone does not stop distributed credential stuffing).
CREATE TABLE IF NOT EXISTS login_attempts (
    id           bigserial PRIMARY KEY,
    email        citext NOT NULL,
    ip_address   inet,
    successful   boolean NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts (email, created_at DESC);
