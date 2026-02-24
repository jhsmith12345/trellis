-- 008_note_signing.sql
-- Component 9: Note Signing + Locking
-- Adds content_hash, amendment_of, signature_data, pdf_data columns to clinical_notes

-- SHA-256 content hash for integrity verification
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Self-referencing FK for amendments (new note points to the original signed note)
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_of UUID REFERENCES clinical_notes (id);

-- Clinician's signature PNG (base64 data URL) captured at signing
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS signature_data TEXT;

-- Generated PDF stored as bytea (binary)
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS pdf_data BYTEA;

-- Index for finding amendments of a given note
CREATE INDEX IF NOT EXISTS idx_clinical_notes_amendment_of ON clinical_notes (amendment_of)
    WHERE amendment_of IS NOT NULL;

-- Index for finding signed notes (for billing trigger queries)
CREATE INDEX IF NOT EXISTS idx_clinical_notes_signed ON clinical_notes (status, signed_at)
    WHERE status = 'signed';
