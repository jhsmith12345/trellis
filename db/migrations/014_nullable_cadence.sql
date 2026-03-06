-- Allow NULL cadence for single (non-recurring) appointments
ALTER TABLE appointments ALTER COLUMN cadence DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN cadence DROP DEFAULT;
ALTER TABLE appointments DROP CONSTRAINT appointments_cadence_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_cadence_check
  CHECK (cadence IS NULL OR cadence = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text]));
