-- Migration 019: Insurance Credentialing Management
-- Tracks payer enrollment status, credential documents, and activity timeline.

-- Master record per payer enrollment per clinician
CREATE TABLE credentialing_payers (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id              UUID NOT NULL REFERENCES practices(id),
    clinician_id             TEXT NOT NULL,
    payer_name               TEXT NOT NULL,
    payer_id                 TEXT,
    status                   TEXT NOT NULL DEFAULT 'not_started'
                             CHECK (status IN ('not_started','gathering_docs','application_submitted','pending','credentialed','denied')),
    -- Payer contact info
    provider_relations_phone TEXT,
    provider_relations_email TEXT,
    provider_relations_fax   TEXT,
    portal_url               TEXT,
    -- Key dates
    application_submitted_at TIMESTAMPTZ,
    credentialed_at          TIMESTAMPTZ,
    effective_date           DATE,
    expiration_date          DATE,
    denied_at                TIMESTAMPTZ,
    denial_reason            TEXT,
    -- Re-credentialing
    recredential_reminder_days INTEGER DEFAULT 90,
    -- Required documents checklist (JSONB array of {name, required, uploaded})
    required_documents       JSONB DEFAULT '[]',
    -- Contracted rate info
    contracted_rates         JSONB,
    notes                    TEXT,
    created_at               TIMESTAMPTZ DEFAULT now(),
    updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cred_payers_practice ON credentialing_payers(practice_id);
CREATE INDEX idx_cred_payers_clinician ON credentialing_payers(clinician_id);
CREATE INDEX idx_cred_payers_status ON credentialing_payers(status);
CREATE INDEX idx_cred_payers_expiration ON credentialing_payers(expiration_date)
    WHERE expiration_date IS NOT NULL;

-- Uploaded credential documents with AI-extracted metadata
CREATE TABLE credentialing_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id          UUID REFERENCES credentialing_payers(id) ON DELETE SET NULL,
    practice_id       UUID NOT NULL REFERENCES practices(id),
    clinician_id      TEXT NOT NULL,
    document_type     TEXT NOT NULL
                      CHECK (document_type IN (
                          'malpractice_cert','license','w9','caqh_attestation',
                          'dea_certificate','board_certification','cv_resume',
                          'proof_of_insurance','diploma','application_form','other'
                      )),
    file_name         TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    file_data         BYTEA,
    file_size_bytes   INTEGER,
    -- AI-extracted metadata
    extracted_data    JSONB DEFAULT '{}',
    expiration_date   DATE,
    issue_date        DATE,
    issuing_authority TEXT,
    document_number   TEXT,
    -- Status
    verified          BOOLEAN DEFAULT false,
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cred_docs_payer ON credentialing_documents(payer_id);
CREATE INDEX idx_cred_docs_practice ON credentialing_documents(practice_id);
CREATE INDEX idx_cred_docs_type ON credentialing_documents(document_type);
CREATE INDEX idx_cred_docs_expiration ON credentialing_documents(expiration_date)
    WHERE expiration_date IS NOT NULL;

-- Activity log per payer enrollment
CREATE TABLE credentialing_timeline_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id    UUID NOT NULL REFERENCES credentialing_payers(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL
                CHECK (event_type IN (
                    'status_change','note','follow_up_call','follow_up_email',
                    'document_uploaded','document_requested','application_sent',
                    'denial_received','approval_received','recredential_started','other'
                )),
    description TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cred_timeline_payer ON credentialing_timeline_events(payer_id, created_at DESC);
