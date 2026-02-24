-- 006_reconfirmation.sql
-- Component 5 completion: reconfirmation, cadence, appointment type expansion, cron support

-- ---------------------------------------------------------------------------
-- Expand appointment types to include extended individual sessions
-- ---------------------------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_type_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_type_check
    CHECK (type IN ('assessment', 'individual', 'individual_extended'));

-- ---------------------------------------------------------------------------
-- Reconfirmation fields on appointments
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reconfirmation_token UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reconfirmation_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reconfirmation_response TEXT
    CHECK (reconfirmation_response IN ('confirmed', 'changed', 'cancelled'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reconfirmation_responded_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

CREATE INDEX idx_appointments_reconfirmation_token
    ON appointments (reconfirmation_token) WHERE reconfirmation_token IS NOT NULL;

CREATE INDEX idx_appointments_pending_reconfirmation
    ON appointments (reconfirmation_sent_at)
    WHERE reconfirmation_sent_at IS NOT NULL
      AND reconfirmation_response IS NULL
      AND status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Expand appointment status to include 'released'
-- ---------------------------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'released'));

-- ---------------------------------------------------------------------------
-- Recurring cadence: weekly (default), biweekly, monthly
-- Stored per-recurrence-series as metadata on the first appointment,
-- or we add a dedicated column.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cadence TEXT NOT NULL DEFAULT 'weekly'
    CHECK (cadence IN ('weekly', 'biweekly', 'monthly'));

-- ---------------------------------------------------------------------------
-- Reminder tracking
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
