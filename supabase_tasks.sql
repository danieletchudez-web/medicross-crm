-- ══════════════════════════════════════════════════════════════════
-- Módulo de Tareas — esquema completo con vínculos a todo el CRM
-- Ejecutar en Supabase SQL Editor (idempotente)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pendiente',
  priority        TEXT NOT NULL DEFAULT 'media',
  due_date        DATE,
  assigned_to     UUID REFERENCES public.profiles(id)      ON DELETE SET NULL,
  created_by      UUID REFERENCES public.profiles(id)      ON DELETE SET NULL,
  -- Vínculos al CRM
  account_id      UUID REFERENCES public.accounts(id)      ON DELETE SET NULL,
  opportunity_id  UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  tender_id       UUID REFERENCES public.tenders(id)       ON DELETE SET NULL,
  campaign_id     UUID REFERENCES public.campaigns(id)     ON DELETE SET NULL,
  -- Auditoría
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Columnas adicionales en caso de que la tabla ya exista sin ellas
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date        DATE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to     UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS account_id      UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS opportunity_id  UUID REFERENCES public.opportunities(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS tender_id       UUID REFERENCES public.tenders(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS campaign_id     UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_authenticated_all" ON public.tasks;
CREATE POLICY "tasks_authenticated_all"
  ON public.tasks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_tasks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tasks_updated_at ON public.tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_tasks_updated_at();
