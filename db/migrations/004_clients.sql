-- 004_clients.sql
-- Central client profile table: demographics, contact, insurance

CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid    TEXT NOT NULL UNIQUE,
    email           TEXT NOT NULL,
    -- Demographics
    full_name       TEXT,
    preferred_name  TEXT,
    pronouns        TEXT,
    date_of_birth   DATE,
    phone           TEXT,
    -- Address
    address_line1   TEXT,
    address_line2   TEXT,
    address_city    TEXT,
    address_state   TEXT,
    address_zip     TEXT,
    -- Emergency contact
    emergency_contact_name         TEXT,
    emergency_contact_phone        TEXT,
    emergency_contact_relationship TEXT,
    -- Insurance (key fields for querying + full extraction blob)
    payer_name      TEXT,
    member_id       TEXT,
    group_number    TEXT,
    insurance_data  JSONB,
    -- Status
    intake_completed_at     TIMESTAMPTZ,
    documents_completed_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_email ON clients (email);

-- Reuse update_updated_at() trigger from 001_encounters.sql
CREATE TRIGGER trg_clients_updated
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
