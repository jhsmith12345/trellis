-- 003_scheduling.sql
-- Scheduling: clinician availability, appointments, recurring groups, sessions, attendance

-- Clinician weekly availability windows
CREATE TABLE clinician_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinician_id    TEXT NOT NULL,
    clinician_email TEXT NOT NULL,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_availability_clinician_day ON clinician_availability (clinician_id, day_of_week);

-- Individual appointments (assessment + individual sessions)
CREATE TABLE appointments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         TEXT NOT NULL,
    client_email      TEXT NOT NULL,
    client_name       TEXT NOT NULL,
    clinician_id      TEXT NOT NULL,
    clinician_email   TEXT NOT NULL,
    type              TEXT NOT NULL CHECK (type IN ('assessment', 'individual')),
    scheduled_at      TIMESTAMPTZ NOT NULL,
    duration_minutes  INTEGER NOT NULL DEFAULT 60,
    status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    meet_link         TEXT,
    calendar_event_id TEXT,
    recurrence_id     UUID,
    encounter_id      UUID REFERENCES encounters (id),
    created_by        TEXT NOT NULL,
    cancelled_at      TIMESTAMPTZ,
    cancelled_reason  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_client ON appointments (client_id, scheduled_at);
CREATE INDEX idx_appointments_clinician ON appointments (clinician_id, scheduled_at);
CREATE INDEX idx_appointments_recurrence ON appointments (recurrence_id) WHERE recurrence_id IS NOT NULL;

-- Admin-defined recurring group templates (IOP/PHP)
CREATE TABLE recurring_groups (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT NOT NULL,
    clinician_id      TEXT NOT NULL,
    clinician_email   TEXT NOT NULL,
    day_of_week       SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time        TIME NOT NULL,
    end_time          TIME NOT NULL,
    duration_minutes  INTEGER NOT NULL,
    max_capacity      INTEGER NOT NULL DEFAULT 12,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_by        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_time > start_time)
);

-- Client membership in a recurring group
CREATE TABLE group_enrollments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES recurring_groups (id),
    client_id       TEXT NOT NULL,
    client_email    TEXT NOT NULL,
    client_name     TEXT NOT NULL,
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    discharged_at   TIMESTAMPTZ,
    UNIQUE (group_id, client_id)
);

-- Specific group session instances
CREATE TABLE group_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id          UUID NOT NULL REFERENCES recurring_groups (id),
    scheduled_at      TIMESTAMPTZ NOT NULL,
    duration_minutes  INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    meet_link         TEXT,
    calendar_event_id TEXT,
    encounter_id      UUID REFERENCES encounters (id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_group_sessions_group ON group_sessions (group_id, scheduled_at);

-- Per-client attendance for group sessions
CREATE TABLE group_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES group_sessions (id),
    client_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'expected'
                    CHECK (status IN ('expected', 'present', 'absent', 'late', 'excused')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, client_id)
);

CREATE INDEX idx_group_attendance_session ON group_attendance (session_id);

-- Reuse update_updated_at() trigger from 001
CREATE TRIGGER trg_availability_updated
    BEFORE UPDATE ON clinician_availability
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_recurring_groups_updated
    BEFORE UPDATE ON recurring_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_group_sessions_updated
    BEFORE UPDATE ON group_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_group_attendance_updated
    BEFORE UPDATE ON group_attendance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
