-- 004_issues.sql
-- Core issue table, human-readable public identifier, full-text search vector,
-- and the indexes that support the list/filter/analytics queries.

-- Human-quotable reference (CIV-2026-000123). The UUID stays the API identifier;
-- this exists so a citizen can read an ID over the phone without exposing an
-- enumerable primary key.
CREATE SEQUENCE IF NOT EXISTS issue_public_id_seq START 1;

CREATE OR REPLACE FUNCTION next_issue_public_id()
RETURNS text AS $$
BEGIN
    RETURN 'CIV-' || to_char(now(), 'YYYY') || '-' ||
           lpad(nextval('issue_public_id_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS issues (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id        text NOT NULL DEFAULT next_issue_public_id(),
    reporter_id      uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title            text NOT NULL,
    description      text NOT NULL,
    category_id      integer NOT NULL REFERENCES issue_categories (id) ON DELETE RESTRICT,

    -- Citizen's own assessment is retained for analytics/trust scoring; the
    -- official priority is what the workflow actually uses and only staff move it.
    citizen_severity severity NOT NULL DEFAULT 'MEDIUM',
    official_priority severity NOT NULL DEFAULT 'MEDIUM',

    status           issue_status NOT NULL DEFAULT 'REPORTED',

    latitude         numeric(9, 6) NOT NULL,
    longitude        numeric(9, 6) NOT NULL,
    address          text,
    landmark         text,

    is_public        boolean NOT NULL DEFAULT true,
    is_spam          boolean NOT NULL DEFAULT false,
    duplicate_of_id  uuid REFERENCES issues (id) ON DELETE SET NULL,

    -- Denormalised counter kept in sync by the service layer inside the same
    -- transaction as the linked report; avoids a COUNT per row in list queries.
    duplicate_count  integer NOT NULL DEFAULT 0,

    resolved_at      timestamptz,
    closed_at        timestamptz,
    deleted_at       timestamptz,          -- soft delete: preserves auditability
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    search_vector    tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(public_id, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(address, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(landmark, '')), 'C')
    ) STORED,

    CONSTRAINT issues_public_id_unique UNIQUE (public_id),
    CONSTRAINT issues_title_length CHECK (length(btrim(title)) BETWEEN 5 AND 150),
    CONSTRAINT issues_description_length CHECK (length(btrim(description)) BETWEEN 10 AND 5000),
    CONSTRAINT issues_latitude_range CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT issues_longitude_range CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT issues_address_length CHECK (address IS NULL OR length(address) <= 300),
    CONSTRAINT issues_landmark_length CHECK (landmark IS NULL OR length(landmark) <= 150),
    CONSTRAINT issues_duplicate_not_self CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
    CONSTRAINT issues_duplicate_count_non_negative CHECK (duplicate_count >= 0),
    -- Cross-field integrity: a resolved/closed issue must carry its timestamp.
    CONSTRAINT issues_resolved_timestamp CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL),
    CONSTRAINT issues_closed_timestamp CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);

DROP TRIGGER IF EXISTS trg_issues_updated_at ON issues;
CREATE TRIGGER trg_issues_updated_at
    BEFORE UPDATE ON issues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Partial indexes: every read path filters out soft-deleted rows, so excluding
-- them keeps these indexes smaller and faster.
CREATE INDEX IF NOT EXISTS idx_issues_status        ON issues (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_category      ON issues (category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_reporter      ON issues (reporter_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_created_at    ON issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_priority_time ON issues (official_priority, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_status_cat    ON issues (status, category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_geo           ON issues (latitude, longitude) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_public        ON issues (is_public, status) WHERE deleted_at IS NULL AND NOT is_spam;
CREATE INDEX IF NOT EXISTS idx_issues_search        ON issues USING GIN (search_vector);
