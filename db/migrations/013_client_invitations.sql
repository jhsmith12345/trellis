-- Migration 013: Client invitations
-- Allows clinicians to invite clients via email with a unique token link.

CREATE TABLE IF NOT EXISTS client_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id     UUID NOT NULL REFERENCES practices(id),
    clinician_firebase_uid TEXT NOT NULL,
    email           TEXT NOT NULL,
    token           TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'expired')),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_invitations_token ON client_invitations(token);
CREATE INDEX IF NOT EXISTS idx_client_invitations_email ON client_invitations(email);
