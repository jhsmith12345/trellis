-- 018: Billing communications tracking table
-- Tracks patient statements, payment reminders, and confirmations sent by the billing service.

CREATE TABLE IF NOT EXISTS billing_communications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES billing_accounts(id),
    claim_id        UUID REFERENCES billing_claims(id),
    payment_id      UUID REFERENCES billing_payments(id),
    comm_type       TEXT NOT NULL CHECK (comm_type IN ('statement', 'reminder_1', 'reminder_2', 'reminder_3', 'confirmation')),
    recipient_email TEXT NOT NULL,
    recipient_name  TEXT,
    subject         TEXT,
    status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
    metadata        JSONB DEFAULT '{}',
    sent_at         TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_comms_account     ON billing_communications(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_comms_claim       ON billing_communications(claim_id);
CREATE INDEX IF NOT EXISTS idx_billing_comms_payment     ON billing_communications(payment_id);
CREATE INDEX IF NOT EXISTS idx_billing_comms_type_sent   ON billing_communications(claim_id, comm_type, sent_at DESC);
