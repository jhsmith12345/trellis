-- Migration 018: Denial Management
-- Adds denial categorization and resubmission tracking columns to billing_claims.

ALTER TABLE billing_claims ADD COLUMN IF NOT EXISTS denial_category JSONB;
ALTER TABLE billing_claims ADD COLUMN IF NOT EXISTS denial_suggestions JSONB;
ALTER TABLE billing_claims ADD COLUMN IF NOT EXISTS original_claim_id UUID REFERENCES billing_claims(id);
ALTER TABLE billing_claims ADD COLUMN IF NOT EXISTS resubmission_count INTEGER DEFAULT 0;

-- Index for querying denied claims by category
CREATE INDEX IF NOT EXISTS idx_billing_claims_denial_category
    ON billing_claims ((denial_category->>'category'))
    WHERE status = 'denied';

-- Index for looking up resubmission chains
CREATE INDEX IF NOT EXISTS idx_billing_claims_original_claim_id
    ON billing_claims (original_claim_id)
    WHERE original_claim_id IS NOT NULL;

-- Index for denied claims listing (common query pattern)
CREATE INDEX IF NOT EXISTS idx_billing_claims_denied
    ON billing_claims (account_id, adjudicated_at DESC)
    WHERE status = 'denied';
