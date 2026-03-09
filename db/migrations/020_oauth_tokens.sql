-- Migration 020: Add OAuth token columns to clinicians table
-- Supports per-clinician Google OAuth 2.0 (replaces SA delegation requirement)

ALTER TABLE clinicians
    ADD COLUMN IF NOT EXISTS google_refresh_token_enc BYTEA,
    ADD COLUMN IF NOT EXISTS google_email TEXT,
    ADD COLUMN IF NOT EXISTS google_scopes TEXT[],
    ADD COLUMN IF NOT EXISTS google_connected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS google_disconnected_at TIMESTAMPTZ;
