-- 001_extensions_and_enums.sql
-- Base extensions, enumerated domain types, and shared trigger functions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email storage

-- Roles. Kept as a small enum rather than a join table: the role set is fixed by
-- the domain (citizen / worker / admin) and an enum gives DB-level validation.
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('CITIZEN', 'WORKER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE issue_status AS ENUM (
        'REPORTED',
        'UNDER_REVIEW',
        'ASSIGNED',
        'IN_PROGRESS',
        'ON_HOLD',
        'RESOLVED',
        'REOPENED',
        'CLOSED',
        'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE image_type AS ENUM ('REPORT', 'RESOLUTION', 'ADDITIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'ISSUE_SUBMITTED',
        'STATUS_CHANGED',
        'ISSUE_ASSIGNED',
        'ASSIGNMENT_REMOVED',
        'ISSUE_RESOLVED',
        'ISSUE_REOPENED',
        'ISSUE_CLOSED',
        'PRIORITY_CHANGED',
        'COMMENT_ADDED',
        'NEW_ISSUE_REPORTED',
        'CRITICAL_ISSUE_REPORTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared updated_at maintenance. Attached by trigger to every mutable table so
-- application code can never forget to bump it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
