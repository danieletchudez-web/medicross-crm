-- Admin security hardening for MediCross CRM.
-- Run this in Supabase SQL editor after verifying table/column names in your project.

alter table public.profiles enable row level security;

alter table public.profiles
  add column if not exists allowed_actions text[] default array['view']::text[],
  add column if not exists permission_preset text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists last_access_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists is_active boolean not null default false;

update public.profiles
set allowed_actions = case
  when role = 'super_admin' then array['view','create','edit','delete','export','approve_users']::text[]
  when role = 'manager' then array['view','create','edit','export']::text[]
  else coalesce(allowed_actions, array['view','create','edit']::text[])
end
where allowed_actions is null;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  target_user_id uuid,
  actor_id uuid,
  actor_email text,
  changes jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'pendiente',
  priority text not null default 'media',
  due_date date,
  account_id uuid,
  opportunity_id uuid,
  tender_id uuid,
  owner_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_audit_logs enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_tasks enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
      and p.approved is true
      and coalesce(p.is_active, true) is true
  );
$$;

drop policy if exists "profiles_select_own_or_super_admin" on public.profiles;
create policy "profiles_select_own_or_super_admin"
on public.profiles
for select
using (id = auth.uid() or public.is_super_admin());

drop policy if exists "profiles_update_super_admin_only" on public.profiles;
create policy "profiles_update_super_admin_only"
on public.profiles
for update
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "admin_audit_logs_select_super_admin_only" on public.admin_audit_logs;
create policy "admin_audit_logs_select_super_admin_only"
on public.admin_audit_logs
for select
using (public.is_super_admin());

drop policy if exists "admin_audit_logs_insert_super_admin_only" on public.admin_audit_logs;
create policy "admin_audit_logs_insert_super_admin_only"
on public.admin_audit_logs
for insert
with check (public.is_super_admin());

drop policy if exists "crm_settings_select_authenticated" on public.crm_settings;
create policy "crm_settings_select_authenticated"
on public.crm_settings
for select
using (auth.uid() is not null);

drop policy if exists "crm_settings_write_super_admin_only" on public.crm_settings;
create policy "crm_settings_write_super_admin_only"
on public.crm_settings
for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "crm_tasks_owner_or_super_admin" on public.crm_tasks;
create policy "crm_tasks_owner_or_super_admin"
on public.crm_tasks
for all
using (owner_id = auth.uid() or public.is_super_admin())
with check (owner_id = auth.uid() or public.is_super_admin());
