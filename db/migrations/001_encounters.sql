-- 001_encounters.sql
-- Core tables: encounters (all transcripts) + clinical_notes (formal documentation)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Every client interaction — the universal "memory" layer
CREATE TABLE encounters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       TEXT NOT NULL,
    clinician_id    TEXT,
    type            TEXT NOT NULL CHECK (type IN ('intake', 'portal', 'clinical', 'group')),
    source          TEXT NOT NULL CHECK (source IN ('voice', 'form', 'chat', 'clinician')),
    transcript      TEXT NOT NULL DEFAULT '',
    data            JSONB,
    duration_sec    INTEGER,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_encounters_client_id ON encounters (client_id, created_at);
CREATE INDEX idx_encounters_type ON encounters (type);

-- Formal clinical documentation derived from encounters
CREATE TABLE clinical_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encounter_id    UUID NOT NULL REFERENCES encounters (id),
    format          TEXT NOT NULL CHECK (format IN ('SOAP', 'DAP', 'narrative')),
    content         JSONB NOT NULL DEFAULT '{}',
    flags           JSONB NOT NULL DEFAULT '[]',
    signed_by       TEXT,
    signed_at       TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'review', 'signed', 'amended')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinical_notes_encounter ON clinical_notes (encounter_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_encounters_updated
    BEFORE UPDATE ON encounters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clinical_notes_updated
    BEFORE UPDATE ON clinical_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
