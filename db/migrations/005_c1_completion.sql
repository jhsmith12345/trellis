-- 005_c1_completion.sql
-- Complete Component 1: practice_profile, treatment_plans, users (roles), drop group therapy

-- ---------------------------------------------------------------------------
-- Users table: maps Firebase UID to role (clinician vs client)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid    TEXT NOT NULL UNIQUE,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('clinician', 'client')),
    display_name    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Practice profile: one row per installation (solo practice MVP)
-- ---------------------------------------------------------------------------
CREATE TABLE practice_profile (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinician_uid       TEXT NOT NULL UNIQUE,
    -- Practice info
    practice_name       TEXT,
    -- Clinician info
    clinician_name      TEXT NOT NULL,
    credentials         TEXT,          -- e.g. "LCSW", "LPC", "LMFT"
    license_number      TEXT,
    license_state       TEXT,          -- 2-letter state code
    npi                 TEXT,
    tax_id              TEXT,          -- EIN or SSN for billing
    specialties         TEXT[],        -- array of specialty strings
    bio                 TEXT,
    -- Contact
    phone               TEXT,
    email               TEXT,
    website             TEXT,
    -- Address
    address_line1       TEXT,
    address_line2       TEXT,
    address_city        TEXT,
    address_state       TEXT,
    address_zip         TEXT,
    -- Insurance & rates
    accepted_insurances TEXT[],        -- payer names the practice accepts
    session_rate        NUMERIC(10,2), -- standard session fee
    intake_rate         NUMERIC(10,2), -- intake assessment fee (if different)
    sliding_scale       BOOLEAN NOT NULL DEFAULT false,
    sliding_scale_min   NUMERIC(10,2),
    -- Settings
    default_session_duration INTEGER NOT NULL DEFAULT 53,  -- minutes (standard therapy hour)
    intake_duration     INTEGER NOT NULL DEFAULT 60,
    timezone            TEXT NOT NULL DEFAULT 'America/Chicago',
    --
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_practice_profile_updated
    BEFORE UPDATE ON practice_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Treatment plans: versioned, linked to client
-- ---------------------------------------------------------------------------
CREATE TABLE treatment_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    -- Clinical content
    diagnoses       JSONB NOT NULL DEFAULT '[]',    -- [{code, description, rank}]
    goals           JSONB NOT NULL DEFAULT '[]',    -- [{id, description, objectives: [{id, description, target_date, status}], interventions: [{description, frequency}]}]
    presenting_problems TEXT,
    -- Review schedule
    review_date     DATE,
    -- Workflow
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'review', 'signed', 'updated', 'superseded')),
    signed_by       TEXT,
    signed_at       TIMESTAMPTZ,
    -- Source tracking
    source_encounter_id UUID REFERENCES encounters (id),
    previous_version_id UUID REFERENCES treatment_plans (id),
    --
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_treatment_plans_client ON treatment_plans (client_id, version);
CREATE INDEX idx_treatment_plans_status ON treatment_plans (status) WHERE status != 'superseded';

CREATE TRIGGER trg_treatment_plans_updated
    BEFORE UPDATE ON treatment_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Add discharged_at to clients table
-- ---------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS discharged_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'discharged', 'inactive'));

-- ---------------------------------------------------------------------------
-- Drop group therapy tables (not MVP scope)
-- Reverse dependency order: attendance → sessions → enrollments → groups
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_group_attendance_updated ON group_attendance;
DROP TRIGGER IF EXISTS trg_group_sessions_updated ON group_sessions;
DROP TRIGGER IF EXISTS trg_recurring_groups_updated ON recurring_groups;

DROP TABLE IF EXISTS group_attendance CASCADE;
DROP TABLE IF EXISTS group_sessions CASCADE;
DROP TABLE IF EXISTS group_enrollments CASCADE;
DROP TABLE IF EXISTS recurring_groups CASCADE;
