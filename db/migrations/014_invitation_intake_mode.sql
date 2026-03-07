-- Migration 014: Add intake_mode to client_invitations
-- Allows clinicians to specify standard (therapy) vs IOP/PHP admissions intake.

ALTER TABLE client_invitations
    ADD COLUMN IF NOT EXISTS intake_mode TEXT NOT NULL DEFAULT 'standard'
        CHECK (intake_mode IN ('standard', 'iop'));
