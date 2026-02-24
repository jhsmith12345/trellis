-- Migration 009: Treatment plan signing support
-- Adds content_hash, signature_data, and pdf_data columns to treatment_plans
-- for the signing workflow (mirrors clinical_notes signing from migration 008).

ALTER TABLE treatment_plans
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS signature_data TEXT,
    ADD COLUMN IF NOT EXISTS pdf_data BYTEA;

-- Index for finding plans by status (for dashboard widgets)
CREATE INDEX IF NOT EXISTS idx_treatment_plans_status
    ON treatment_plans (status)
    WHERE status IN ('draft', 'review');

-- Index for review date lookups (for review-due alerts)
CREATE INDEX IF NOT EXISTS idx_treatment_plans_review_date
    ON treatment_plans (review_date)
    WHERE review_date IS NOT NULL AND status IN ('signed', 'draft', 'review');
