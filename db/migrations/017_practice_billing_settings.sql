-- Migration 017: Add billing service settings to practices table
--
-- These columns store the configuration for connecting a practice
-- to the Trellis Billing Service (external API).

BEGIN;

ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_api_key TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_service_url TEXT DEFAULT 'https://billing.trellis.health';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_auto_submit BOOLEAN DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_last_poll_at TIMESTAMPTZ;

COMMIT;
