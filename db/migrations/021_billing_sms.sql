-- Migration 021b: SMS log table for the billing service
--
-- Tracks all SMS messages sent through the centralized Telnyx account.
-- Phone numbers are stored as SHA-256 hashes (never raw) since the
-- billing service shouldn't hold client PII.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_sms_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES billing_accounts(id),
    phone_hash          TEXT NOT NULL,                -- SHA-256 prefix of recipient number
    message_type        TEXT NOT NULL
                            CHECK (message_type IN (
                                'appointment_reminder', 'reconfirmation',
                                'unsigned_docs', 'custom'
                            )),
    status              TEXT NOT NULL DEFAULT 'sent'
                            CHECK (status IN ('sent', 'failed', 'delivered', 'undelivered')),
    telnyx_message_id   TEXT,                         -- Telnyx message UUID
    error               TEXT,                         -- error message if failed
    sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_sms_account
    ON billing_sms_log(account_id, sent_at);

COMMIT;
