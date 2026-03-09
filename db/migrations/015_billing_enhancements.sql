-- Migration 015: Billing enhancements for CMS-1500/837P claim generation
--
-- Adds fields needed for claim document generation, authorization tracking,
-- modality tracking, secondary insurance, and timely filing.

BEGIN;

-- ---------------------------------------------------------------------------
-- clients: new billing & demographic fields
-- ---------------------------------------------------------------------------

-- Sex (required for CMS-1500 Box 3)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sex TEXT
    CHECK (sex IN ('M', 'F', 'X', 'U'));

-- Payer ID (electronic payer ID for 837P, set once per client)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payer_id TEXT;

-- Default session modality (telehealth vs in-office, pre-populates appointments)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_modality TEXT
    DEFAULT 'telehealth'
    CHECK (default_modality IN ('telehealth', 'in_office'));

-- Secondary insurance fields
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_payer_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_payer_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_member_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_group_number TEXT;

-- Timely filing deadline (days from date of service, per-payer, default 90)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS filing_deadline_days INTEGER DEFAULT 90;

-- ---------------------------------------------------------------------------
-- appointments: session modality
-- ---------------------------------------------------------------------------

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS modality TEXT
    DEFAULT 'telehealth'
    CHECK (modality IN ('telehealth', 'in_office'));

-- ---------------------------------------------------------------------------
-- superbills: claim generation fields
-- ---------------------------------------------------------------------------

-- Place of service code (derived from appointment modality)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS place_of_service TEXT DEFAULT '02';

-- CPT modifiers (e.g., ["95"] for telehealth)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS modifiers JSONB DEFAULT '[]'::jsonb;

-- Timestamp tracking for claim lifecycle
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS date_submitted TIMESTAMPTZ;
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS date_paid TIMESTAMPTZ;

-- Authorization reference (auto-populated from active auth)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS auth_number TEXT;

-- Secondary insurance fields on the claim itself (snapshot at generation time)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS secondary_payer_name TEXT;
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS secondary_payer_id TEXT;
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS secondary_member_id TEXT;

-- Payer ID snapshot (from client at generation time)
ALTER TABLE superbills ADD COLUMN IF NOT EXISTS payer_id TEXT;

-- ---------------------------------------------------------------------------
-- authorizations: prior auth / session tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS authorizations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           TEXT NOT NULL,
    clinician_id        TEXT NOT NULL,
    payer_name          TEXT NOT NULL,
    auth_number         TEXT,
    authorized_sessions INTEGER,
    sessions_used       INTEGER NOT NULL DEFAULT 0,
    cpt_codes           JSONB,                      -- array of approved CPT codes, NULL = all
    diagnosis_codes     JSONB,                      -- array of approved ICD-10 codes
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'exhausted', 'pending')),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_authorizations_client ON authorizations(client_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_status ON authorizations(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_authorizations_end_date ON authorizations(end_date);

CREATE TRIGGER trg_authorizations_updated
    BEFORE UPDATE ON authorizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
