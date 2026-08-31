-- 003_categories.sql
-- Civic issue categories. Reference data lives in the migration (not the seed)
-- because the application's category semantics depend on these rows existing,
-- including in production where dev seeds are never run.

CREATE TABLE IF NOT EXISTS issue_categories (
    id            serial PRIMARY KEY,
    slug          text NOT NULL,
    name          text NOT NULL,
    description   text,
    icon          text,
    -- Baseline urgency for the category, used by the rule-based priority engine.
    default_severity severity NOT NULL DEFAULT 'MEDIUM',
    -- Target resolution window; foundation for future SLA monitoring.
    sla_hours     integer NOT NULL DEFAULT 72,
    department_id uuid REFERENCES departments (id) ON DELETE SET NULL,
    is_active     boolean NOT NULL DEFAULT true,
    sort_order    integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT issue_categories_slug_unique UNIQUE (slug),
    CONSTRAINT issue_categories_name_unique UNIQUE (name),
    CONSTRAINT issue_categories_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT issue_categories_name_length CHECK (length(btrim(name)) BETWEEN 2 AND 60),
    CONSTRAINT issue_categories_sla_positive CHECK (sla_hours BETWEEN 1 AND 8760)
);

CREATE INDEX IF NOT EXISTS idx_issue_categories_active ON issue_categories (is_active, sort_order);

DROP TRIGGER IF EXISTS trg_issue_categories_updated_at ON issue_categories;
CREATE TRIGGER trg_issue_categories_updated_at
    BEFORE UPDATE ON issue_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO issue_categories (slug, name, description, icon, default_severity, sla_hours, sort_order)
VALUES
    ('pothole',              'Pothole',               'Potholes and surface cavities that endanger road users.',        'road-hole',   'HIGH',     72,  10),
    ('garbage',              'Garbage',               'Uncollected waste, overflowing bins, accumulated refuse.',       'trash',       'MEDIUM',   48,  20),
    ('streetlight',          'Streetlight',           'Non-functional, flickering or damaged public lighting.',          'lightbulb',   'MEDIUM',   96,  30),
    ('water-leakage',        'Water Leakage',         'Burst pipes, leaking mains, and continuous water wastage.',      'droplet',     'HIGH',     24,  40),
    ('drainage',             'Drainage',              'Blocked or overflowing drains and waterlogging.',                 'waves',       'HIGH',     48,  50),
    ('road-damage',          'Road Damage',           'Cracked carriageways, subsidence and broken footpaths.',          'road',        'MEDIUM',   120, 60),
    ('open-manhole',         'Open Manhole',          'Missing or broken manhole covers — immediate safety hazard.',     'alert',       'CRITICAL', 6,   70),
    ('public-infrastructure','Public Infrastructure', 'Damaged benches, railings, signage, bus shelters and parks.',     'building',    'LOW',      168, 80),
    ('illegal-dumping',      'Illegal Dumping',       'Unauthorised dumping of construction or hazardous waste.',        'ban',         'HIGH',     48,  90),
    ('other',                'Other',                 'Any other civic issue that does not fit the categories above.',   'dots',        'LOW',      168, 100)
ON CONFLICT (slug) DO NOTHING;
