-- 007_session_recording.sql
-- Component 6: Session Recording + Transcription pipeline support

-- ---------------------------------------------------------------------------
-- Recording pipeline tracking on appointments
-- ---------------------------------------------------------------------------

-- Store the Drive file ID of the recording associated with this appointment
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recording_file_id TEXT;

-- Track the recording processing state:
--   pending     = session ended, waiting for recording to appear in Drive
--   processing  = recording found, STT in progress
--   completed   = transcript stored as encounter, linked to appointment
--   failed      = pipeline error (see recording_error)
--   skipped     = no recording found or recording processing disabled
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recording_status TEXT
    CHECK (recording_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

-- Error message if recording processing failed
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recording_error TEXT;

-- Timestamp when recording processing completed (or failed)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recording_processed_at TIMESTAMPTZ;

-- Index for the cron job that polls for unprocessed recordings
CREATE INDEX idx_appointments_recording_pending
    ON appointments (scheduled_at)
    WHERE recording_status = 'pending'
      AND status IN ('scheduled', 'completed');

-- Index for finding appointments that need recording processing
CREATE INDEX idx_appointments_recording_processing
    ON appointments (recording_status)
    WHERE recording_status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- Session recording configuration table
-- ---------------------------------------------------------------------------
-- Stores per-practice recording preferences. For solo practice MVP,
-- there will be one row. Clinician-scoped for future multi-clinician support.
CREATE TABLE IF NOT EXISTS recording_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinician_id        TEXT NOT NULL UNIQUE,
    delete_after_transcription BOOLEAN NOT NULL DEFAULT true,
    auto_process        BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_recording_config_updated
    BEFORE UPDATE ON recording_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
