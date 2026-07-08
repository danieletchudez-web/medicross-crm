-- =============================================================
-- FARAPULSE: Gestión Integral de Procedimientos
-- Ejecutar en Supabase SQL Editor (en orden)
-- =============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. TABLA PRINCIPAL
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farapulse_procedures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_code         TEXT UNIQUE,            -- FP-2024-001
  product_line          TEXT DEFAULT 'farapulse', -- escalabilidad futura

  -- Ficha principal
  institution           TEXT,
  account_id            UUID REFERENCES accounts(id),
  doctor_name           TEXT,
  electrophysiologist   TEXT,
  buyer_name            TEXT,
  patient_name          TEXT,
  social_security       TEXT,

  -- Referencias comerciales
  oc_number             TEXT,
  quote_id              UUID,                   -- ref. a cotizaciones si existe
  quote_number          TEXT,
  surgery_number        TEXT,

  -- Fecha / lugar
  surgery_date          DATE,
  surgery_time          TIME,
  operating_room        TEXT,
  city                  TEXT,
  province              TEXT,

  -- Asignación
  seller_id             UUID REFERENCES profiles(id),

  -- Pipeline (13 estados)
  status                TEXT DEFAULT 'lead'
    CHECK (status IN (
      'lead','oportunidad','cotizacion_enviada','negociacion',
      'orden_compra','cirugia_programada','material_preparado',
      'material_entregado','cirugia_realizada','material_devuelto',
      'facturacion','cobranza','cerrado'
    )),
  priority              TEXT DEFAULT 'media'
    CHECK (priority IN ('baja','media','alta','urgente')),
  notes                 TEXT,

  -- Sección comercial
  approved_price        NUMERIC,
  final_price           NUMERIC,
  discount_pct          NUMERIC,
  margin_pct            NUMERIC,
  commercial_status     TEXT,
  competitor            TEXT,
  probability           INTEGER,
  commercial_deadline   DATE,
  commercial_notes      TEXT,

  -- Logística
  departure_date        DATE,
  departure_time        TIME,
  carrier               TEXT,
  vehicle_plate         TEXT,
  logistics_responsible TEXT,
  tracking_number       TEXT,
  destination           TEXT,
  estimated_delivery    DATE,
  actual_delivery       DATE,
  received_by           TEXT,
  logistics_notes       TEXT,

  -- Facturación / Cobranza
  invoice_number        TEXT,
  invoice_date          DATE,
  invoice_amount        NUMERIC,
  collection_date       DATE,
  collected_amount      NUMERIC,

  -- Metadatos
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  created_by            UUID REFERENCES profiles(id),
  deleted               BOOLEAN DEFAULT false
);

-- ──────────────────────────────────────────────────────────────
-- 2. MATERIALES / PRODUCTOS POR PROCEDIMIENTO
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farapulse_procedure_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id  UUID NOT NULL REFERENCES farapulse_procedures(id) ON DELETE CASCADE,
  product_id    UUID,                         -- FK opcional a products

  code          TEXT,
  description   TEXT NOT NULL,
  quantity      INTEGER DEFAULT 1,
  lot_number    TEXT,
  serial_number TEXT,
  expiry_date   DATE,
  status        TEXT DEFAULT 'disponible'
    CHECK (status IN ('disponible','reservado','entregado','devuelto','consumido')),

  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- 3. CHECKLIST PRE-CIRUGÍA
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farapulse_procedure_checklist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id  UUID NOT NULL REFERENCES farapulse_procedures(id) ON DELETE CASCADE,
  item_key      TEXT NOT NULL,
  label         TEXT NOT NULL,
  is_checked    BOOLEAN DEFAULT false,
  is_required   BOOLEAN DEFAULT true,
  checked_at    TIMESTAMPTZ,
  checked_by    UUID REFERENCES profiles(id),

  UNIQUE (procedure_id, item_key)
);

-- ──────────────────────────────────────────────────────────────
-- 4. TIMELINE / ACTIVIDAD
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farapulse_procedure_timeline (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id  UUID NOT NULL REFERENCES farapulse_procedures(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,               -- 'status_change' | 'note' | 'checklist' | 'product' | 'logistics'
  description   TEXT NOT NULL,
  user_id       UUID REFERENCES profiles(id),
  user_name     TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- 5. DOCUMENTOS ADJUNTOS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farapulse_procedure_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id  UUID NOT NULL REFERENCES farapulse_procedures(id) ON DELETE CASCADE,
  doc_type      TEXT DEFAULT 'otro'
    CHECK (doc_type IN ('cotizacion','oc','remito','factura','constancia_entrega',
                        'certificado','foto','pdf','excel','email','whatsapp','otro')),
  name          TEXT NOT NULL,
  url           TEXT,
  storage_path  TEXT,
  file_size     BIGINT,
  uploaded_by   UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- ÍNDICES
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fp_procedures_status        ON farapulse_procedures(status) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_fp_procedures_surgery_date  ON farapulse_procedures(surgery_date) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_fp_procedures_seller_id     ON farapulse_procedures(seller_id) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_fp_procedures_account_id    ON farapulse_procedures(account_id) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_fp_products_procedure_id    ON farapulse_procedure_products(procedure_id);
CREATE INDEX IF NOT EXISTS idx_fp_checklist_procedure_id   ON farapulse_procedure_checklist(procedure_id);
CREATE INDEX IF NOT EXISTS idx_fp_timeline_procedure_id    ON farapulse_procedure_timeline(procedure_id);
CREATE INDEX IF NOT EXISTS idx_fp_documents_procedure_id   ON farapulse_procedure_documents(procedure_id);

-- ──────────────────────────────────────────────────────────────
-- RLS (Row Level Security) — ajustar según política del proyecto
-- ──────────────────────────────────────────────────────────────
ALTER TABLE farapulse_procedures            ENABLE ROW LEVEL SECURITY;
ALTER TABLE farapulse_procedure_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE farapulse_procedure_checklist   ENABLE ROW LEVEL SECURITY;
ALTER TABLE farapulse_procedure_timeline    ENABLE ROW LEVEL SECURITY;
ALTER TABLE farapulse_procedure_documents   ENABLE ROW LEVEL SECURITY;

-- Política: usuarios autenticados ven todo (ajustar si se necesita per-seller)
CREATE POLICY "authed_all" ON farapulse_procedures         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authed_all" ON farapulse_procedure_products  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authed_all" ON farapulse_procedure_checklist FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authed_all" ON farapulse_procedure_timeline  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authed_all" ON farapulse_procedure_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- TRIGGER: updated_at automático
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_farapulse_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_fp_updated_at
  BEFORE UPDATE ON farapulse_procedures
  FOR EACH ROW EXECUTE FUNCTION update_farapulse_updated_at();
