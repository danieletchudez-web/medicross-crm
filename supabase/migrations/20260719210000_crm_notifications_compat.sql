-- Compatibility layer for Storing installations created before persistent CRM alerts.
-- Additive and repeatable: does not modify existing quotations or users.

create extension if not exists pgcrypto;

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  detail text,
  category text not null default 'general',
  severity text not null default 'info',
  page text,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists crm_notifications_dedupe_idx
  on public.crm_notifications (dedupe_key) where dedupe_key is not null;
create index if not exists crm_notifications_recipient_idx
  on public.crm_notifications (recipient_id, read_at, created_at desc);

alter table public.crm_notifications enable row level security;

drop policy if exists crm_notifications_read_own on public.crm_notifications;
create policy crm_notifications_read_own on public.crm_notifications
for select to authenticated using (recipient_id = auth.uid() or public.is_super_admin());

drop policy if exists crm_notifications_update_own on public.crm_notifications;
create policy crm_notifications_update_own on public.crm_notifications
for update to authenticated using (recipient_id = auth.uid() or public.is_super_admin())
with check (recipient_id = auth.uid() or public.is_super_admin());

drop policy if exists crm_notifications_create_authenticated on public.crm_notifications;
create policy crm_notifications_create_authenticated on public.crm_notifications
for insert to authenticated with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active is true)
);

grant select, insert, update on public.crm_notifications to authenticated;

notify pgrst, 'reload schema';
