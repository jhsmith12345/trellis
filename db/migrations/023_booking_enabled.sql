-- Add booking_enabled toggle to practices table.
-- When false, hides the client-facing booking UI (Book Session tab, scheduling links).
-- Defaults to true so existing practices retain current behavior.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT true;
