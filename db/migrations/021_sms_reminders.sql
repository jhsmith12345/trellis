-- Migration 021: SMS reminder support
--
-- Adds client opt-in for text reminders and practice-level SMS toggle.
-- SMS is sent via the billing service (Telnyx), so it's a paid feature.
-- Also adds sms_reminder_sent_at to appointments to track SMS separately from email.

BEGIN;

-- Client-level opt-in (TCPA compliance requires explicit consent)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN DEFAULT false;

-- Practice-level toggle (only effective if billing service is connected)
ALTER TABLE practices ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT false;

-- Track SMS reminders separately from email reminders
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sms_reminder_sent_at TIMESTAMPTZ;

COMMIT;
