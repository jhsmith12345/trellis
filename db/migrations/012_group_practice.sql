-- 012_group_practice.sql
-- Add multi-clinician (group practice) support.
--
-- Design principle: the data model is always multi-clinician.
-- A solo practice is just a group with one clinician.
-- practice.type ('solo'|'group') controls UI visibility only.
--
-- New tables: practices, clinicians
-- Altered tables: clients, treatment_plans, clinical_notes, superbills, users

BEGIN;

-- ---------------------------------------------------------------------------
-- practices: practice-level config (Box 33 on a claim — billing provider)
-- Fields moved FROM practice_profile (practice-level only)
-- ---------------------------------------------------------------------------
CREATE TABLE practices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    type                TEXT NOT NULL DEFAULT 'solo'
                        CHECK (type IN ('solo', 'group')),
    tax_id              TEXT,
    npi                 TEXT,              -- group NPI (billing provider)
    phone               TEXT,
    email               TEXT,
    website             TEXT,
    address_line1       TEXT,
    address_line2       TEXT,
    city                TEXT,
    state               TEXT,
    zip                 TEXT,
    accepted_insurances TEXT[],
    timezone            TEXT NOT NULL DEFAULT 'America/Chicago',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_practices_updated
    BEFORE UPDATE ON practices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- clinicians: per-clinician config (Box 24J — rendering provider)
-- Fields moved FROM practice_profile (clinician-level only)
-- ---------------------------------------------------------------------------
CREATE TABLE clinicians (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id             UUID NOT NULL REFERENCES practices(id),
    firebase_uid            TEXT NOT NULL UNIQUE,
    email                   TEXT NOT NULL,
    clinician_name          TEXT,
    credentials             TEXT,
    license_number          TEXT,
    license_state           TEXT,
    npi                     TEXT,              -- individual NPI (rendering provider)
    specialties             TEXT[],
    bio                     TEXT,
    session_rate            NUMERIC(10,2),
    intake_rate             NUMERIC(10,2),
    sliding_scale           BOOLEAN NOT NULL DEFAULT false,
    sliding_scale_min       NUMERIC(10,2),
    default_session_duration INTEGER NOT NULL DEFAULT 53,
    intake_duration         INTEGER NOT NULL DEFAULT 60,
    practice_role           TEXT NOT NULL DEFAULT 'clinician'
                            CHECK (practice_role IN ('owner', 'clinician')),
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'invited', 'deactivated')),
    invited_at              TIMESTAMPTZ,
    joined_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinicians_practice ON clinicians(practice_id);
CREATE INDEX idx_clinicians_email ON clinicians(email);
CREATE INDEX idx_clinicians_status ON clinicians(status) WHERE status = 'active';

CREATE TRIGGER trg_clinicians_updated
    BEFORE UPDATE ON clinicians
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- ALTER existing tables
-- ---------------------------------------------------------------------------

-- clients: which clinician is primarily responsible
ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_clinician_id TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_primary_clinician ON clients(primary_clinician_id);

-- treatment_plans: which clinician authored it
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS clinician_id TEXT;

-- clinical_notes: which clinician authored it
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS clinician_id TEXT;

-- superbills: which NPI was used for billing (group vs individual)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS billing_npi TEXT;

-- users: link to practice
ALTER TABLE users ADD COLUMN IF NOT EXISTS practice_id UUID REFERENCES practices(id);

-- ---------------------------------------------------------------------------
-- Data migration: populate new tables from existing practice_profile
-- ---------------------------------------------------------------------------

-- Step 1: Create a practice row from existing practice_profile
INSERT INTO practices (id, name, type, tax_id, npi, phone, email, website,
                       address_line1, address_line2, city, state, zip,
                       accepted_insurances, timezone, created_at, updated_at)
SELECT
    gen_random_uuid(),
    COALESCE(pp.practice_name, pp.clinician_name, 'My Practice'),
    'solo',
    pp.tax_id,
    pp.npi,
    pp.phone,
    pp.email,
    pp.website,
    pp.address_line1,
    pp.address_line2,
    pp.address_city,
    pp.address_state,
    pp.address_zip,
    pp.accepted_insurances,
    pp.timezone,
    pp.created_at,
    pp.updated_at
FROM practice_profile pp
LIMIT 1;

-- Step 2: Create a clinician row from existing practice_profile (as owner)
INSERT INTO clinicians (id, practice_id, firebase_uid, email, clinician_name,
                        credentials, license_number, license_state, npi,
                        specialties, bio, session_rate, intake_rate,
                        sliding_scale, sliding_scale_min,
                        default_session_duration, intake_duration,
                        practice_role, status, joined_at, created_at, updated_at)
SELECT
    gen_random_uuid(),
    p.id,
    pp.clinician_uid,
    COALESCE(pp.email, ''),
    pp.clinician_name,
    pp.credentials,
    pp.license_number,
    pp.license_state,
    pp.npi,
    pp.specialties,
    pp.bio,
    pp.session_rate,
    pp.intake_rate,
    pp.sliding_scale,
    pp.sliding_scale_min,
    pp.default_session_duration,
    pp.intake_duration,
    'owner',
    'active',
    pp.created_at,
    pp.created_at,
    pp.updated_at
FROM practice_profile pp
CROSS JOIN practices p
LIMIT 1;

-- Step 3: Set practice_id on all clinician users
UPDATE users
SET practice_id = (SELECT id FROM practices LIMIT 1)
WHERE role = 'clinician'
  AND EXISTS (SELECT 1 FROM practices);

-- Step 4: Backfill clients.primary_clinician_id to the existing owner
UPDATE clients
SET primary_clinician_id = (
    SELECT firebase_uid FROM clinicians WHERE practice_role = 'owner' LIMIT 1
)
WHERE primary_clinician_id IS NULL
  AND EXISTS (SELECT 1 FROM clinicians WHERE practice_role = 'owner');

-- Step 5: Backfill treatment_plans.clinician_id from linked encounter
UPDATE treatment_plans tp
SET clinician_id = COALESCE(
    (SELECT e.clinician_id FROM encounters e WHERE e.id = tp.source_encounter_id),
    (SELECT firebase_uid FROM clinicians WHERE practice_role = 'owner' LIMIT 1)
)
WHERE tp.clinician_id IS NULL
  AND EXISTS (SELECT 1 FROM clinicians WHERE practice_role = 'owner');

-- Step 6: Backfill clinical_notes.clinician_id from linked encounter
UPDATE clinical_notes cn
SET clinician_id = COALESCE(
    (SELECT e.clinician_id FROM encounters e WHERE e.id = cn.encounter_id),
    (SELECT firebase_uid FROM clinicians WHERE practice_role = 'owner' LIMIT 1)
)
WHERE cn.clinician_id IS NULL
  AND EXISTS (SELECT 1 FROM clinicians WHERE practice_role = 'owner');

-- Step 7: Backfill encounters.clinician_id where NULL
UPDATE encounters
SET clinician_id = (
    SELECT firebase_uid FROM clinicians WHERE practice_role = 'owner' LIMIT 1
)
WHERE clinician_id IS NULL
  AND EXISTS (SELECT 1 FROM clinicians WHERE practice_role = 'owner');

COMMIT;
