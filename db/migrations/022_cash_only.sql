-- 022: Add cash_only toggle to practices table
-- When true, hides insurance-related UI (credentialing, authorizations, claims, insurance intake)

ALTER TABLE practices ADD COLUMN IF NOT EXISTS cash_only BOOLEAN DEFAULT false;
