-- Migration 010: Superbills table for billing document generation (Component 11)
--
-- Superbills are auto-generated when clinical notes are signed.
-- They contain all the data a clinician needs for insurance claim submission.

BEGIN;

CREATE TABLE IF NOT EXISTS superbills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       TEXT NOT NULL,                          -- firebase_uid of the client
    appointment_id  UUID REFERENCES appointments(id),      -- linked appointment
    note_id         UUID REFERENCES clinical_notes(id),    -- linked signed clinical note
    clinician_id    TEXT NOT NULL,                          -- firebase_uid of the clinician
    date_of_service DATE NOT NULL,
    cpt_code        TEXT NOT NULL,                          -- e.g. '90791', '90834', '90837'
    cpt_description TEXT,                                   -- e.g. 'Psychiatric Diagnostic Evaluation'
    diagnosis_codes JSONB DEFAULT '[]'::jsonb,             -- [{code, description, rank}]
    fee             NUMERIC(10,2),                          -- session fee
    amount_paid     NUMERIC(10,2) DEFAULT 0,               -- amount paid by client/insurance
    status          TEXT NOT NULL DEFAULT 'generated'
                    CHECK (status IN ('generated', 'submitted', 'paid', 'outstanding')),
    pdf_data        BYTEA,                                 -- superbill PDF
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_superbills_client_id ON superbills(client_id);
CREATE INDEX IF NOT EXISTS idx_superbills_clinician_id ON superbills(clinician_id);
CREATE INDEX IF NOT EXISTS idx_superbills_note_id ON superbills(note_id);
CREATE INDEX IF NOT EXISTS idx_superbills_status ON superbills(status);
CREATE INDEX IF NOT EXISTS idx_superbills_date_of_service ON superbills(date_of_service DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_superbills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_superbills_updated_at
    BEFORE UPDATE ON superbills
    FOR EACH ROW
    EXECUTE FUNCTION update_superbills_updated_at();

COMMIT;
