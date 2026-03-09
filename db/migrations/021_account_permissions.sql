-- Migration 021: Add permissions and BAA tracking to billing_accounts
--
-- Adds:
--   - permissions JSONB column for granular feature gating (messaging, billing)
--   - baa_signed_at, baa_signer_name, baa_signer_title, baa_signer_email for BAA audit trail
--   - stripe_subscription_id for recurring messaging subscription
--   - platform_fee_percent per-account override (default 3.0%)

BEGIN;

ALTER TABLE billing_accounts
    ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS baa_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS baa_signer_name TEXT,
    ADD COLUMN IF NOT EXISTS baa_signer_title TEXT,
    ADD COLUMN IF NOT EXISTS baa_signer_email TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS platform_fee_percent NUMERIC(5,2) DEFAULT 3.0;

COMMENT ON COLUMN billing_accounts.permissions IS
    'Feature permissions: {"messaging": true, "billing": true}';

COMMENT ON COLUMN billing_accounts.platform_fee_percent IS
    'Per-account platform fee on patient payments (default 3%). Applied after Stripe fees.';

COMMIT;
