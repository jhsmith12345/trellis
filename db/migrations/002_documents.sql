-- 002_documents.sql
-- Document signing: packages, documents, stored signatures, audit events

-- Bundle of documents sent to a client for signing
CREATE TABLE document_packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    client_email    TEXT NOT NULL,
    client_name     TEXT NOT NULL,
    financial_data  JSONB,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'partially_signed', 'completed')),
    sent_at         TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_packages_client_id ON document_packages (client_id);
CREATE INDEX idx_packages_status ON document_packages (status);

-- Individual document within a package
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id      UUID NOT NULL REFERENCES document_packages (id),
    template_key    TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'signed')),
    signature_data  TEXT,
    content_hash    TEXT,
    signer_ip       TEXT,
    signer_user_agent TEXT,
    signed_at       TIMESTAMPTZ,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_package_id ON documents (package_id);

-- One stored signature per user for one-click reuse
CREATE TABLE stored_signatures (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL UNIQUE,
    signature_png   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HIPAA audit log — append-only, no UPDATE/DELETE
CREATE TABLE audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_user ON audit_events (user_id, created_at);
CREATE INDEX idx_audit_events_resource ON audit_events (resource_type, resource_id);

-- Reuse update_updated_at() trigger from 001
CREATE TRIGGER trg_packages_updated
    BEFORE UPDATE ON document_packages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_stored_signatures_updated
    BEFORE UPDATE ON stored_signatures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
