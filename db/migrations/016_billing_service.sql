-- Migration 016: Billing service tables
--
-- Creates tables for the centralized multi-tenant billing service:
-- billing_accounts, billing_claims, billing_eras, billing_payments, billing_events.

BEGIN;

-- ---------------------------------------------------------------------------
-- billing_accounts: one per Trellis installation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_name   TEXT NOT NULL,
    api_key         TEXT UNIQUE NOT NULL,           -- SHA-256 hashed
    api_key_prefix  TEXT,                           -- first 8 chars for display
    stripe_connect_account_id   TEXT,
    stripe_onboarding_complete  BOOLEAN DEFAULT false,
    settings        JSONB DEFAULT '{}',             -- auto_submit, payment_reminders, etc.
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- billing_claims: submitted claims tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_claims (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              UUID NOT NULL REFERENCES billing_accounts(id),
    external_superbill_id   TEXT,                   -- superbill UUID from customer's EHR
    stedi_claim_id          TEXT,                   -- Stedi's claim reference
    claim_data              JSONB,                  -- full 837P data snapshot
    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending', 'validating', 'submitted', 'acknowledged',
                                    'rejected', 'adjudicated', 'paid', 'denied'
                                )),
    status_history          JSONB DEFAULT '[]',     -- [{status, timestamp, details}]
    payer_name              TEXT,
    payer_id                TEXT,
    total_charge            NUMERIC(10,2),
    total_paid              NUMERIC(10,2) DEFAULT 0,
    patient_responsibility  NUMERIC(10,2) DEFAULT 0,
    denial_codes            JSONB,
    submitted_at            TIMESTAMPTZ,
    adjudicated_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_claims_account
    ON billing_claims(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_claims_status
    ON billing_claims(account_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_claims_external
    ON billing_claims(account_id, external_superbill_id);

-- ---------------------------------------------------------------------------
-- billing_eras: ERA/835 remittance records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_eras (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              UUID NOT NULL REFERENCES billing_accounts(id),
    claim_id                UUID REFERENCES billing_claims(id),
    stedi_era_id            TEXT,
    era_data                JSONB,                  -- parsed 835 data
    payment_amount          NUMERIC(10,2),
    adjustment_amount       NUMERIC(10,2),
    patient_responsibility  NUMERIC(10,2),
    adjustment_reasons      JSONB,                  -- [{group, code, amount, description}]
    check_number            TEXT,
    payer_name              TEXT,
    processed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_eras_account
    ON billing_eras(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_eras_claim
    ON billing_eras(claim_id);

-- ---------------------------------------------------------------------------
-- billing_payments: patient payments via Stripe
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_payments (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id                  UUID NOT NULL REFERENCES billing_accounts(id),
    claim_id                    UUID REFERENCES billing_claims(id),
    stripe_payment_intent_id    TEXT,
    stripe_checkout_session_id  TEXT,
    amount                      NUMERIC(10,2) NOT NULL,
    platform_fee                NUMERIC(10,2) DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    patient_email               TEXT,
    payment_link_url            TEXT,
    paid_at                     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_account
    ON billing_payments(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_claim
    ON billing_payments(claim_id);

-- ---------------------------------------------------------------------------
-- billing_events: append-only event log for polling
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES billing_accounts(id),
    event_type      TEXT NOT NULL,              -- claim_submitted, claim_status_changed, era_received, payment_completed, eligibility_checked
    resource_type   TEXT NOT NULL,              -- claim, era, payment, eligibility
    resource_id     UUID,
    data            JSONB DEFAULT '{}',         -- event-specific data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary polling index: efficient lookup by account + time range
CREATE INDEX IF NOT EXISTS idx_billing_events_poll
    ON billing_events(account_id, created_at);

COMMIT;
