-- ============================================================
-- Rental Module v2 — Migration Script
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Extend equipment_rentals with new columns
ALTER TABLE equipment_rentals
  ADD COLUMN IF NOT EXISTS case_number          TEXT,
  ADD COLUMN IF NOT EXISTS technology           TEXT DEFAULT 'EchoLaser',
  ADD COLUMN IF NOT EXISTS procedure_room       TEXT,
  ADD COLUMN IF NOT EXISTS procedure_city       TEXT,
  ADD COLUMN IF NOT EXISTS procedure_time       TEXT,
  ADD COLUMN IF NOT EXISTS requires_consumables          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_clinical_specialist  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_instrumentadora      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_ecographer           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_image_fusion         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_logistics            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_specialist  TEXT,
  ADD COLUMN IF NOT EXISTS quoted_amount        NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_amount      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_amount      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_number       TEXT,
  ADD COLUMN IF NOT EXISTS is_billable          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_id             UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS status_changed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_changed_by    UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason  TEXT,
  ADD COLUMN IF NOT EXISTS checklist            JSONB DEFAULT '{}',
  -- EchoLaser fields
  ADD COLUMN IF NOT EXISTS ela_procedure_type       TEXT,
  ADD COLUMN IF NOT EXISTS ela_estimated_fibers     INTEGER,
  ADD COLUMN IF NOT EXISTS ela_used_fibers          INTEGER,
  ADD COLUMN IF NOT EXISTS ela_requires_ecographer  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ela_requires_fusion      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ela_operator_doctor      TEXT,
  ADD COLUMN IF NOT EXISTS ela_clinical_specialist  TEXT,
  -- Farapulse fields
  ADD COLUMN IF NOT EXISTS far_electrophysiologist  TEXT,
  ADD COLUMN IF NOT EXISTS far_procedure_type       TEXT,
  ADD COLUMN IF NOT EXISTS far_consumables_detail   TEXT,
  ADD COLUMN IF NOT EXISTS far_clinical_specialist  TEXT,
  ADD COLUMN IF NOT EXISTS far_room                 TEXT,
  ADD COLUMN IF NOT EXISTS far_estimated_duration   TEXT;

-- 2. Migrate old status values to new ones
UPDATE equipment_rentals SET status = 'solicitud_recibida'        WHERE status = 'solicitud';
UPDATE equipment_rentals SET status = 'cotizacion_enviada'         WHERE status = 'cotizacion';
UPDATE equipment_rentals SET status = 'confirmado'                  WHERE status = 'aprobado';
UPDATE equipment_rentals SET status = 'programado_calendario'       WHERE status = 'reservado';
UPDATE equipment_rentals SET status = 'equipo_entregado'            WHERE status = 'entregado';
UPDATE equipment_rentals SET status = 'procedimiento_realizado'     WHERE status = 'en_procedimiento';
UPDATE equipment_rentals SET status = 'equipo_retirado'             WHERE status = 'retirado';
-- facturado, cerrado, cancelado stay the same

-- 3. Generate case_number for existing records that don't have one
DO $$
DECLARE
  rec RECORD;
  prefix TEXT;
  year_str TEXT;
  seq INT;
BEGIN
  FOR rec IN SELECT id, technology, created_at FROM equipment_rentals WHERE case_number IS NULL ORDER BY created_at
  LOOP
    prefix := CASE rec.technology
      WHEN 'Farapulse'          THEN 'FAR'
      WHEN 'EchoLaser'          THEN 'ELA'
      WHEN 'Ecógrafo'           THEN 'ECO'
      WHEN 'Fusión de imágenes' THEN 'FUS'
      ELSE 'GEN'
    END;
    year_str := TO_CHAR(rec.created_at, 'YYYY');
    SELECT COUNT(*) + 1 INTO seq
      FROM equipment_rentals
      WHERE case_number LIKE prefix || '-' || year_str || '-%';
    UPDATE equipment_rentals
      SET case_number = prefix || '-' || year_str || '-' || LPAD(seq::TEXT, 3, '0')
      WHERE id = rec.id;
  END LOOP;
END $$;

-- 4. Case events table (audit trail)
CREATE TABLE IF NOT EXISTS rental_case_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES equipment_rentals(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  UUID REFERENCES profiles(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  comment     TEXT,
  next_action TEXT
);

ALTER TABLE rental_case_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rental_case_events_all" ON rental_case_events;
CREATE POLICY "rental_case_events_all" ON rental_case_events
  FOR ALL TO authenticated USING (true);

-- 5. Public request form table (anon inserts allowed)
CREATE TABLE IF NOT EXISTS rental_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID REFERENCES equipment_rentals(id),
  requester_name      TEXT NOT NULL,
  requester_role      TEXT,
  requester_phone     TEXT,
  requester_email     TEXT,
  institution         TEXT,
  doctor_name         TEXT,
  technology          TEXT,
  procedure_type      TEXT,
  requested_date      DATE,
  requested_time      TEXT,
  location            TEXT,
  services_requested  JSONB DEFAULT '[]',
  observations        TEXT,
  submitted_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rental_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rental_requests_insert_anon"   ON rental_requests;
DROP POLICY IF EXISTS "rental_requests_select_auth"   ON rental_requests;
CREATE POLICY "rental_requests_insert_anon"  ON rental_requests FOR INSERT TO anon        WITH CHECK (true);
CREATE POLICY "rental_requests_select_auth"  ON rental_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "rental_requests_update_auth"  ON rental_requests FOR UPDATE TO authenticated USING (true);

-- Done
SELECT 'Migration complete' AS status;
