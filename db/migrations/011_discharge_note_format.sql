-- 011_discharge_note_format.sql
-- Add 'discharge' to clinical_notes.format CHECK constraint.
-- The discharge workflow (clients.py) creates notes with format='discharge'
-- for AI-generated discharge summaries.

BEGIN;

-- Drop existing CHECK constraint on format
ALTER TABLE clinical_notes DROP CONSTRAINT IF EXISTS clinical_notes_format_check;

-- Re-add with 'discharge' included
ALTER TABLE clinical_notes ADD CONSTRAINT clinical_notes_format_check
    CHECK (format IN ('SOAP', 'DAP', 'narrative', 'discharge'));

COMMIT;
