-- MediCross CRM operational upgrade.
-- Additive and repeatable migration: it does not remove or rename existing data.
-- Run after supabase/admin-security-policies.sql in the Supabase SQL editor.

create extension if not exists pgcrypto;

alter table public.visits
  add column if not exists is_draft boolean not null default false,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists present_contacts jsonb not null default '[]'::jsonb,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.accounts
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

alter table public.opportunities
  add column if not exists next_action_date date,
  add column if not exists last_movement_at timestamptz not null default now(),
  add column if not exists source_quote_id uuid;

alter table public.tenders
  add column if not exists owner_id uuid,
  add column if not exists linked_quote_id uuid,
  add column if not exists resultado text,
  add column if not exists monto_adjudicado numeric,
  add column if not exists motivo_perdida text,
  add column if not exists competitor_winner text;

alter table public.cotizaciones
  add column if not exists tender_id uuid,
  add column if not exists account_id uuid,
  add column if not exists accepted_opportunity_id uuid,
  add column if not exists expires_at date;

alter table public.products
  add column if not exists supplier text,
  add column if not exists sku text,
  add column if not exists brand text,
  add column if not exists base_price numeric;

alter table public.profiles
  add column if not exists notify_email boolean not null default true,
  add column if not exists onboarding_completed_at timestamptz;

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  title text not null,
  detail text,
  category text not null default 'general',
  severity text not null default 'info',
  page text,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  read_at timestamptz,
  email_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  period_type text not null check (period_type in ('mensual', 'trimestral')),
  period_start date not null,
  visits_target integer not null default 0,
  opportunities_target integer not null default 0,
  pipeline_target numeric not null default 0,
  forecast_target numeric not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, period_type, period_start)
);

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid,
  is_global boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_notifications_recipient_idx
  on public.crm_notifications (recipient_id, read_at, created_at desc);
create index if not exists crm_notifications_category_idx
  on public.crm_notifications (category, created_at desc);
create index if not exists visits_account_idx on public.visits (account_id, visit_date desc);
create index if not exists opportunities_account_idx on public.opportunities (account_id, updated_at desc);
create index if not exists cotizaciones_account_idx on public.cotizaciones (account_id, created_at desc);
create index if not exists tenders_end_date_idx on public.tenders (end_date);

insert into public.crm_settings (key, value)
values
  ('pipeline_stages', '[
    {"name":"Lead","probability":10},
    {"name":"Contactado","probability":20},
    {"name":"Reunión","probability":35},
    {"name":"Demo","probability":50},
    {"name":"Cotización","probability":65},
    {"name":"Negociación","probability":80},
    {"name":"Ganado","probability":100},
    {"name":"Perdido","probability":0}
  ]'::jsonb),
  ('inactivity_thresholds', '{"seller_without_visit_days":5,"high_potential_account_days":30,"opportunity_without_movement_days":30}'::jsonb),
  ('quote_expiration_days', '{"days":30}'::jsonb)
on conflict (key) do nothing;

insert into storage.buckets (id, name, public)
values ('visit-attachments', 'visit-attachments', true)
on conflict (id) do nothing;

alter table public.crm_notifications enable row level security;
alter table public.sales_goals enable row level security;
alter table public.quote_templates enable row level security;

drop policy if exists "crm_notifications_owner_or_super_admin_select" on public.crm_notifications;
create policy "crm_notifications_owner_or_super_admin_select"
on public.crm_notifications for select
using (recipient_id = auth.uid() or public.is_super_admin());

drop policy if exists "crm_notifications_owner_or_super_admin_update" on public.crm_notifications;
create policy "crm_notifications_owner_or_super_admin_update"
on public.crm_notifications for update
using (recipient_id = auth.uid() or public.is_super_admin())
with check (recipient_id = auth.uid() or public.is_super_admin());

drop policy if exists "sales_goals_read_own_or_super_admin" on public.sales_goals;
create policy "sales_goals_read_own_or_super_admin"
on public.sales_goals for select
using (
  seller_id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and p.approved is true
      and coalesce(p.is_active, true) is true
  )
);

drop policy if exists "sales_goals_write_super_admin" on public.sales_goals;
create policy "sales_goals_write_super_admin"
on public.sales_goals for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "quote_templates_read_visible" on public.quote_templates;
create policy "quote_templates_read_visible"
on public.quote_templates for select
using (is_global or owner_id = auth.uid() or public.is_super_admin());

drop policy if exists "quote_templates_write_owner_or_super_admin" on public.quote_templates;
create policy "quote_templates_write_owner_or_super_admin"
on public.quote_templates for all
using (owner_id = auth.uid() or public.is_super_admin())
with check ((owner_id = auth.uid() and not is_global) or public.is_super_admin());

drop policy if exists "visit_attachments_read_authenticated" on storage.objects;
create policy "visit_attachments_read_authenticated"
on storage.objects for select
using (bucket_id = 'visit-attachments' and auth.uid() is not null);

drop policy if exists "visit_attachments_insert_authenticated" on storage.objects;
create policy "visit_attachments_insert_authenticated"
on storage.objects for insert
with check (bucket_id = 'visit-attachments' and auth.uid() is not null);

drop policy if exists "visit_attachments_delete_authenticated" on storage.objects;
create policy "visit_attachments_delete_authenticated"
on storage.objects for delete
using (bucket_id = 'visit-attachments' and auth.uid() is not null);

create or replace function public.refresh_crm_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  affected integer := 0;
begin
  insert into public.crm_notifications
    (recipient_id, title, detail, category, severity, page, record_id, dedupe_key)
  select
    v.owner_id,
    'Seguimiento de visita vencido',
    coalesce(a.name, 'Visita sin cliente') || ' requiere seguimiento.',
    'visitas',
    'warning',
    'visits',
    v.id,
    'visit-followup:' || v.id::text || ':' || v.followup_date::text
  from public.visits v
  left join public.accounts a on a.id = v.account_id
  where v.owner_id is not null
    and v.followup_date is not null
    and v.followup_date < current_date
  on conflict (dedupe_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  insert into public.crm_notifications
    (recipient_id, title, detail, category, severity, page, record_id, dedupe_key)
  select
    o.owner_id,
    'Oportunidad sin próxima acción',
    coalesce(o.name, 'Oportunidad') || ' necesita una próxima acción.',
    'oportunidades',
    'warning',
    'opportunities',
    o.id,
    'opp-no-action:' || o.id::text || ':' || coalesce(o.updated_at::date::text, current_date::text)
  from public.opportunities o
  where o.owner_id is not null
    and coalesce(o.next_action, '') = ''
    and coalesce(o.stage, '') not in ('Ganado', 'Perdido')
  on conflict (dedupe_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  insert into public.crm_notifications
    (recipient_id, title, detail, category, severity, page, record_id, metadata, dedupe_key)
  select
    t.owner_id,
    case when (t.end_date - current_date) <= 1
      then 'Licitación urgente'
      else 'Licitación próxima a vencer'
    end,
    coalesce(t.process_name, t.institution, 'Licitación') || ' vence en ' || (t.end_date - current_date)::text || ' día(s).',
    'licitaciones',
    case when (t.end_date - current_date) <= 1 then 'urgent' else 'warning' end,
    'tenders',
    t.id,
    jsonb_build_object('days_remaining', t.end_date - current_date),
    'tender-due:' || t.id::text || ':' || (t.end_date - current_date)::text
  from public.tenders t
  where t.owner_id is not null
    and t.end_date is not null
    and (t.end_date - current_date) in (7, 3, 1)
  on conflict (dedupe_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  insert into public.crm_notifications
    (recipient_id, title, detail, category, severity, page, record_id, dedupe_key)
  select
    c.owner_id,
    'Cotización enviada sin actualización',
    'La cotización #' || coalesce(c.quote_num_formatted, c.id::text) || ' lleva más de 7 días sin novedades.',
    'cotizaciones',
    'warning',
    'cotizador',
    c.id,
    'quote-stale:' || c.id::text || ':' || coalesce(c.updated_at::date::text, current_date::text)
  from public.cotizaciones c
  where c.owner_id is not null
    and lower(coalesce(c.estado, '')) = 'enviada'
    and coalesce(c.updated_at, c.created_at) < now() - interval '7 days'
  on conflict (dedupe_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  return inserted_count;
end;
$$;

grant execute on function public.refresh_crm_notifications() to authenticated;

create or replace function public.log_crm_entity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (event, actor_id, changes)
  values (
    lower(tg_table_name) || '_' || lower(tg_op),
    auth.uid(),
    jsonb_build_object(
      'table', tg_table_name,
      'action', tg_op,
      'record_id', coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
      'new', case when tg_op <> 'DELETE' then to_jsonb(new) else null end,
      'old', case when tg_op <> 'INSERT' then to_jsonb(old) else null end
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_audit_trigger on public.visits;
create trigger visits_audit_trigger after insert or update or delete on public.visits
for each row execute function public.log_crm_entity_change();

drop trigger if exists opportunities_audit_trigger on public.opportunities;
create trigger opportunities_audit_trigger after insert or update or delete on public.opportunities
for each row execute function public.log_crm_entity_change();

drop trigger if exists tenders_audit_trigger on public.tenders;
create trigger tenders_audit_trigger after insert or update or delete on public.tenders
for each row execute function public.log_crm_entity_change();

drop trigger if exists cotizaciones_audit_trigger on public.cotizaciones;
create trigger cotizaciones_audit_trigger after insert or update or delete on public.cotizaciones
for each row execute function public.log_crm_entity_change();

-- Recommended scheduler, if pg_cron is enabled in the Supabase project:
-- select cron.schedule('medicross-refresh-notifications', '0 * * * *', $$ select public.refresh_crm_notifications(); $$);
