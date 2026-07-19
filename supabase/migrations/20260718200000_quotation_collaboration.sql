-- Collaborative quotation workflow for Storing CRM.
-- Additive and repeatable: preserves cotizaciones.renglones and the current PDF flow.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists department text;

comment on column public.profiles.department is
  'Operational department: ventas, compras, licitaciones, administracion.';

alter table public.cotizaciones
  add column if not exists sales_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists purchasing_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists tender_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists workflow_status text,
  add column if not exists validation_type text,
  add column if not exists validated_by uuid references public.profiles(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists validation_notes text,
  add column if not exists costs_completed_count integer not null default 0,
  add column if not exists costs_pending_count integer not null default 0,
  add column if not exists sent_to_purchasing_at timestamptz,
  add column if not exists returned_to_sales_at timestamptz,
  add column if not exists internal_deadline date,
  add column if not exists procedure_type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists purchasing_queue boolean not null default false;

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  legacy_index integer,
  line_number text,
  subitem text,
  requested_description text,
  quantity numeric not null default 1,
  unit text not null default 'u.',
  product_id uuid references public.products(id) on delete set null,
  desired_brand text,
  desired_model text,
  presentation text,
  sales_notes text,
  suggested_supplier_id uuid references public.suppliers(id) on delete set null,
  suggested_supplier_name text,
  alternative_allowed boolean not null default false,
  sales_decision text not null default 'cotizar',
  purchasing_status text not null default 'pendiente_compras',
  commercial_status text not null default 'bloqueado_costos',
  cost_available boolean not null default false,
  cost_validated_at timestamptz,
  cost_validated_by uuid references public.profiles(id) on delete set null,
  pending_reason text,
  purchasing_notes text,
  commercial_notes text,
  markup numeric,
  gross_margin numeric,
  target_margin numeric,
  commission_pct numeric,
  commercial_expenses numeric not null default 0,
  discount_pct numeric not null default 0,
  sale_price_unit numeric,
  final_price_unit numeric,
  commercial_started_at timestamptz,
  commercial_completed_at timestamptz,
  sort_order integer not null default 0,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_id, legacy_index)
);

create table if not exists public.quotation_item_costs (
  id uuid primary key default gen_random_uuid(),
  quotation_item_id uuid not null references public.quotation_items(id) on delete cascade,
  version integer not null default 1,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  offered_product text,
  brand text,
  model text,
  supplier_code text,
  unit_cost numeric,
  currency text not null default 'ARS',
  exchange_rate numeric,
  converted_cost numeric,
  vat_pct numeric not null default 0,
  taxes numeric not null default 0,
  freight numeric not null default 0,
  additional_expenses numeric not null default 0,
  total_unit_cost numeric,
  minimum_quantity numeric,
  delivery_term text,
  availability text,
  valid_until date,
  payment_terms text,
  supplier_quote_number text,
  supplier_quote_date date,
  confidence text not null default 'pendiente_confirmacion',
  status text not null default 'buscando_proveedor',
  notes text,
  is_current boolean not null default true,
  is_validated boolean not null default false,
  validated_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quotation_item_id, version)
);

create unique index if not exists quotation_item_costs_one_current_idx
  on public.quotation_item_costs (quotation_item_id) where is_current;

create table if not exists public.quotation_validations (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  validation_type text not null check (validation_type in ('partial', 'total', 'incremental')),
  reason text,
  notes text not null,
  total_items integer not null default 0,
  available_items integer not null default 0,
  pending_items integer not null default 0,
  confirmed_items integer not null default 0,
  estimated_items integer not null default 0,
  alternative_items integer not null default 0,
  non_quotable_items integer not null default 0,
  validated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.quotation_validation_items (
  validation_id uuid not null references public.quotation_validations(id) on delete cascade,
  quotation_item_id uuid not null references public.quotation_items(id) on delete cascade,
  resolution text not null,
  cost_id uuid references public.quotation_item_costs(id) on delete set null,
  primary key (validation_id, quotation_item_id)
);

create table if not exists public.quotation_attachments (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  quotation_item_id uuid references public.quotation_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  original_name text not null,
  internal_name text not null,
  storage_path text not null,
  mime_type text,
  document_category text not null default 'otro',
  description text,
  file_size bigint,
  version integer not null default 1,
  replaces_attachment_id uuid references public.quotation_attachments(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_department text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (storage_path)
);

create table if not exists public.quotation_activity_log (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  quotation_item_id uuid references public.quotation_items(id) on delete cascade,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_department text,
  previous_value jsonb,
  new_value jsonb,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quotation_comments (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  quotation_item_id uuid references public.quotation_items(id) on delete cascade,
  body text not null,
  sector text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.quotation_comments(id) on delete cascade,
  is_internal boolean not null default true,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.quotation_item_reviews (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.cotizaciones(id) on delete cascade,
  quotation_item_id uuid not null references public.quotation_items(id) on delete cascade,
  reason text not null,
  comment text not null,
  previous_cost_id uuid references public.quotation_item_costs(id) on delete set null,
  status text not null default 'requested',
  requested_by uuid not null references public.profiles(id) on delete restrict,
  assigned_to uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists quotation_items_quote_idx on public.quotation_items (quotation_id, sort_order);
create index if not exists quotation_items_cost_progress_idx on public.quotation_items (quotation_id, cost_available);
create index if not exists quotation_costs_item_idx on public.quotation_item_costs (quotation_item_id, version desc);
create index if not exists quotation_validations_quote_idx on public.quotation_validations (quotation_id, created_at desc);
create index if not exists quotation_attachments_quote_idx on public.quotation_attachments (quotation_id, quotation_item_id, is_active);
create index if not exists quotation_activity_quote_idx on public.quotation_activity_log (quotation_id, created_at desc);
create index if not exists quotation_comments_quote_idx on public.quotation_comments (quotation_id, created_at);
create index if not exists quotation_reviews_open_idx on public.quotation_item_reviews (quotation_id, status);
create index if not exists cotizaciones_workflow_idx on public.cotizaciones (workflow_status, internal_deadline);
create index if not exists profiles_department_idx on public.profiles (department) where is_active is true;

create or replace function public.set_quotation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quotation_items_updated_at on public.quotation_items;
create trigger quotation_items_updated_at before update on public.quotation_items
for each row execute function public.set_quotation_updated_at();

create or replace function public.quotation_user_department()
returns text language sql stable security definer set search_path = public as $$
  select lower(coalesce(department, role, '')) from public.profiles where id = auth.uid();
$$;

-- Some installations do not include the legacy authorization helper. Keep the
-- workflow migration self-contained while preserving the existing role model.
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(coalesce(role, '')) in ('super_admin', 'admin')
  );
$$;

create or replace function public.can_access_quotation(target_quote uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cotizaciones q
    where q.id = target_quote
      and (
        public.is_super_admin()
        or q.owner_id = auth.uid()
        or q.sales_owner_id = auth.uid()
        or q.purchasing_owner_id = auth.uid()
        or q.tender_owner_id = auth.uid()
        or public.quotation_user_department() in ('compras', 'licitaciones', 'administracion', 'manager')
      )
  );
$$;

create or replace function public.sync_legacy_quotation_items(target_quote uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  legacy_rows jsonb;
  inserted_count integer := 0;
begin
  if not public.can_access_quotation(target_quote) then raise exception 'not authorized'; end if;
  select coalesce(renglones, '[]'::jsonb) into legacy_rows from public.cotizaciones where id = target_quote;

  insert into public.quotation_items (
    quotation_id, legacy_index, line_number, subitem, requested_description,
    quantity, product_id, desired_brand, suggested_supplier_name,
    markup, sale_price_unit, sort_order, legacy_payload, created_by
  )
  select
    target_quote, ordinality::integer - 1, value->>'renglon', value->>'subitem',
    coalesce(value->>'descr', value->>'codigo'), coalesce((value->>'cant')::numeric, 1),
    nullif(value->>'catalog_product_id', '')::uuid, value->>'marca', value->>'empresa',
    nullif(value->>'markup', '')::numeric, nullif(value->>'pvManual', '')::numeric,
    ordinality::integer - 1, value, auth.uid()
  from jsonb_array_elements(legacy_rows) with ordinality
  on conflict (quotation_id, legacy_index) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.sync_quotation_items_after_legacy_save()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.quotation_items (
    quotation_id, legacy_index, line_number, subitem, requested_description,
    quantity, product_id, desired_brand, suggested_supplier_name,
    markup, sale_price_unit, sort_order, legacy_payload, created_by, updated_by
  )
  select
    new.id, ordinality::integer - 1, value->>'renglon', value->>'subitem',
    coalesce(value->>'descr', value->>'codigo'), coalesce(nullif(value->>'cant', '')::numeric, 1),
    nullif(value->>'catalog_product_id', '')::uuid, value->>'marca', value->>'empresa',
    case when nullif(value->>'markup', '') is null then null else (nullif(value->>'markup', '')::numeric - 1) * 100 end,
    nullif(value->>'pvManual', '')::numeric, ordinality::integer - 1, value,
    coalesce(new.owner_id, auth.uid()), auth.uid()
  from jsonb_array_elements(coalesce(new.renglones, '[]'::jsonb)) with ordinality
  on conflict (quotation_id, legacy_index) do update set
    line_number = excluded.line_number,
    subitem = excluded.subitem,
    requested_description = excluded.requested_description,
    quantity = excluded.quantity,
    product_id = excluded.product_id,
    desired_brand = excluded.desired_brand,
    suggested_supplier_name = excluded.suggested_supplier_name,
    sort_order = excluded.sort_order,
    legacy_payload = excluded.legacy_payload,
    updated_by = excluded.updated_by;
  return new;
end;
$$;

drop trigger if exists cotizaciones_sync_workflow_items on public.cotizaciones;
create trigger cotizaciones_sync_workflow_items
after insert or update of renglones on public.cotizaciones
for each row execute function public.sync_quotation_items_after_legacy_save();

create or replace function public.sync_quotation_item_to_legacy(target_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  item_row public.quotation_items%rowtype;
  cost_row public.quotation_item_costs%rowtype;
  legacy jsonb;
  updated_payload jsonb;
begin
  select * into item_row from public.quotation_items where id = target_item;
  if item_row.id is null or not public.can_access_quotation(item_row.quotation_id) then raise exception 'not authorized'; end if;
  select * into cost_row from public.quotation_item_costs where quotation_item_id = target_item and is_current limit 1;
  select renglones into legacy from public.cotizaciones where id = item_row.quotation_id for update;
  if item_row.legacy_index is null or item_row.legacy_index >= jsonb_array_length(coalesce(legacy, '[]'::jsonb)) then return; end if;
  updated_payload := coalesce(legacy->item_row.legacy_index, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'empresa', coalesce(cost_row.supplier_name, item_row.suggested_supplier_name),
      'marca', coalesce(cost_row.brand, item_row.desired_brand),
      'costo', coalesce(cost_row.total_unit_cost, cost_row.converted_cost, cost_row.unit_cost),
      'moneda', cost_row.currency,
      'iva', cost_row.vat_pct,
      'tcInd', cost_row.exchange_rate,
      'markup', case when item_row.markup is null then null else 1 + item_row.markup / 100 end,
      'modoManual', case when item_row.final_price_unit is not null or item_row.sale_price_unit is not null then 'manual' else null end,
      'pvManual', coalesce(item_row.final_price_unit, item_row.sale_price_unit)
    ));
  update public.cotizaciones
  set renglones = jsonb_set(legacy, array[item_row.legacy_index::text], updated_payload, false), updated_at = now()
  where id = item_row.quotation_id;
end;
$$;

create or replace function public.validate_quotation_costs(
  target_quote uuid,
  requested_type text,
  validation_reason text,
  validation_notes text,
  selected_items uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  validation_id uuid;
  total_count integer;
  available_count integer;
  pending_count integer;
  selected_count integer;
  sales_recipient uuid;
  quote_number text;
begin
  if public.quotation_user_department() <> 'compras' and not public.is_super_admin() then
    raise exception 'Only purchasing or super admin can validate costs';
  end if;
  if requested_type not in ('partial', 'total', 'incremental') then raise exception 'Invalid validation type'; end if;
  if trim(coalesce(validation_notes, '')) = '' then raise exception 'Validation notes are required'; end if;
  if requested_type <> 'total' and trim(coalesce(validation_reason, '')) = '' then raise exception 'A reason is required'; end if;

  select count(*) into total_count from public.quotation_items where quotation_id = target_quote;
  select count(*) into selected_count
  from public.quotation_items i
  join public.quotation_item_costs c on c.quotation_item_id = i.id and c.is_current
  where i.quotation_id = target_quote and i.id = any(selected_items)
    and c.status in ('costo_cargado', 'completo', 'alternativa_propuesta')
    and coalesce(c.total_unit_cost, c.converted_cost, c.unit_cost) is not null;

  if selected_count <> coalesce(array_length(selected_items, 1), 0) then
    raise exception 'Every selected item must have a current resolvable cost';
  end if;
  if requested_type = 'total' and selected_count + (
    select count(*) from public.quotation_items where quotation_id = target_quote and cost_available
  ) <> total_count then
    raise exception 'Total validation requires every line to be resolved';
  end if;
  if requested_type <> 'total' and exists (
    select 1 from public.quotation_items
    where quotation_id = target_quote and id <> all(selected_items)
      and (purchasing_status is null or purchasing_status in ('pendiente_compras', 'buscando_proveedor', 'esperando_respuesta'))
      and trim(coalesce(pending_reason, '')) = ''
  ) then raise exception 'Every unresolved line requires an explicit reason'; end if;

  insert into public.quotation_validations (
    quotation_id, validation_type, reason, notes, total_items, available_items,
    pending_items, confirmed_items, estimated_items, alternative_items,
    non_quotable_items, validated_by
  )
  select target_quote, requested_type, validation_reason, validation_notes, total_count,
    selected_count, (select count(*) from public.quotation_items where quotation_id = target_quote and not cost_available and id <> all(selected_items)),
    count(*) filter (where c.confidence = 'confirmado'),
    count(*) filter (where c.confidence in ('estimado', 'historico')),
    count(*) filter (where c.status = 'alternativa_propuesta'),
    (select count(*) from public.quotation_items where quotation_id = target_quote and purchasing_status = 'no_cotizable'),
    auth.uid()
  from public.quotation_items i
  join public.quotation_item_costs c on c.quotation_item_id = i.id and c.is_current
  where i.quotation_id = target_quote and i.id = any(selected_items)
  returning id into validation_id;

  insert into public.quotation_validation_items (validation_id, quotation_item_id, resolution, cost_id)
  select validation_id, i.id, c.status, c.id
  from public.quotation_items i
  join public.quotation_item_costs c on c.quotation_item_id = i.id and c.is_current
  where i.quotation_id = target_quote and i.id = any(selected_items);

  update public.quotation_item_costs c set is_validated = true, validated_at = now(), validated_by = auth.uid()
  where c.is_current and c.quotation_item_id = any(selected_items);

  update public.quotation_items set
    cost_available = true,
    purchasing_status = 'validado_compras',
    commercial_status = case when commercial_status = 'bloqueado_costos' then 'pendiente_definicion' else commercial_status end,
    cost_validated_at = now(), cost_validated_by = auth.uid()
  where quotation_id = target_quote and id = any(selected_items);

  select count(*) filter (where cost_available), count(*) filter (where not cost_available)
    into available_count, pending_count from public.quotation_items where quotation_id = target_quote;

  update public.cotizaciones set
    workflow_status = case when pending_count = 0 then 'costos_completos' else 'costos_parciales' end,
    validation_type = case when pending_count = 0 then 'total' else 'partial' end,
    validated_by = auth.uid(), validated_at = now(), validation_notes = validate_quotation_costs.validation_notes,
    costs_completed_count = available_count, costs_pending_count = pending_count,
    returned_to_sales_at = now()
  where id = target_quote
  returning coalesce(sales_owner_id, owner_id), quote_num_formatted into sales_recipient, quote_number;

  insert into public.quotation_activity_log
    (quotation_id, action, actor_id, actor_department, comment, metadata)
  values
    (target_quote, 'cost_validation_' || requested_type, auth.uid(), 'compras', validation_notes,
      jsonb_build_object('validation_id', validation_id, 'available_count', available_count, 'pending_count', pending_count));

  if sales_recipient is not null then
    insert into public.crm_notifications
      (recipient_id, title, detail, category, severity, page, record_id, metadata, dedupe_key)
    values (
      sales_recipient,
      case when pending_count = 0 then 'Cotización validada por Compras' else 'Cotización validada parcialmente' end,
      case when pending_count = 0
        then 'Compras validó la cotización Nº ' || coalesce(quote_number, '') || '. Ya podés definir precios.'
        else 'Cotización validada parcialmente: ' || available_count || ' de ' || total_count || ' renglones disponibles para definición comercial.' end,
      'cotizaciones', case when pending_count = 0 then 'success' else 'warning' end,
      'cotizador', target_quote,
      jsonb_build_object('validation_id', validation_id, 'validation_type', requested_type, 'available_count', available_count, 'pending_count', pending_count),
      'quotation-validation-' || validation_id::text
    ) on conflict (dedupe_key) do nothing;
  end if;
  return validation_id;
end;
$$;

create or replace view public.quotation_workflow_metrics as
select
  q.id quotation_id, q.quote_num_formatted, q.institucion, q.workflow_status,
  q.sales_owner_id, q.purchasing_owner_id, q.internal_deadline, q.priority,
  count(i.id) total_items,
  count(i.id) filter (where i.cost_available) available_items,
  count(i.id) filter (where not i.cost_available) pending_items,
  count(i.id) filter (where i.commercial_status in ('precio_definido', 'aprobado_ventas', 'descartado')) commercial_resolved_items,
  min(q.sent_to_purchasing_at) sent_to_purchasing_at,
  max(i.cost_validated_at) last_cost_validation_at
from public.cotizaciones q
left join public.quotation_items i on i.quotation_id = q.id
group by q.id;

-- Older/free-plan installations may not have the shared settings table yet.
create table if not exists public.crm_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.crm_settings enable row level security;
drop policy if exists crm_settings_authenticated_read on public.crm_settings;
create policy crm_settings_authenticated_read on public.crm_settings
for select to authenticated using (true);
drop policy if exists crm_settings_admin_write on public.crm_settings;
create policy crm_settings_admin_write on public.crm_settings
for all to authenticated
using (
  public.is_super_admin()
  or public.quotation_user_department() in ('administracion', 'manager')
)
with check (
  public.is_super_admin()
  or public.quotation_user_department() in ('administracion', 'manager')
);
grant select, insert, update on public.crm_settings to authenticated;

insert into public.crm_settings (key, value)
values ('quotation_collaboration', '{"enabled": true, "pilot_departments": ["ventas", "compras", "licitaciones", "administracion"], "version": 1}'::jsonb)
on conflict (key) do nothing;

insert into storage.buckets (id, name, public)
values ('quotation-files', 'quotation-files', false)
on conflict (id) do update set public = false;

alter table public.quotation_items enable row level security;
alter table public.quotation_item_costs enable row level security;
alter table public.quotation_validations enable row level security;
alter table public.quotation_validation_items enable row level security;
alter table public.quotation_attachments enable row level security;
alter table public.quotation_activity_log enable row level security;
alter table public.quotation_comments enable row level security;
alter table public.quotation_item_reviews enable row level security;

drop policy if exists quotation_items_read on public.quotation_items;
create policy quotation_items_read on public.quotation_items for select
using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_items_insert on public.quotation_items;
create policy quotation_items_insert on public.quotation_items for insert
with check (public.can_access_quotation(quotation_id));
drop policy if exists quotation_items_update on public.quotation_items;
create policy quotation_items_update on public.quotation_items for update
using (public.can_access_quotation(quotation_id)) with check (public.can_access_quotation(quotation_id));

drop policy if exists quotation_costs_read on public.quotation_item_costs;
create policy quotation_costs_read on public.quotation_item_costs for select using (
  exists (select 1 from public.quotation_items i where i.id = quotation_item_id and public.can_access_quotation(i.quotation_id))
);
drop policy if exists quotation_costs_purchasing_write on public.quotation_item_costs;
create policy quotation_costs_purchasing_write on public.quotation_item_costs for all
using (public.quotation_user_department() = 'compras' or public.is_super_admin())
with check (public.quotation_user_department() = 'compras' or public.is_super_admin());

drop policy if exists quotation_validations_read on public.quotation_validations;
create policy quotation_validations_read on public.quotation_validations for select using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_validation_items_read on public.quotation_validation_items;
create policy quotation_validation_items_read on public.quotation_validation_items for select using (
  exists (select 1 from public.quotation_items i where i.id = quotation_item_id and public.can_access_quotation(i.quotation_id))
);

drop policy if exists quotation_attachments_read on public.quotation_attachments;
create policy quotation_attachments_read on public.quotation_attachments for select using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_attachments_insert on public.quotation_attachments;
create policy quotation_attachments_insert on public.quotation_attachments for insert with check (
  public.can_access_quotation(quotation_id) and uploaded_by = auth.uid()
);
drop policy if exists quotation_attachments_update on public.quotation_attachments;
create policy quotation_attachments_update on public.quotation_attachments for update
using (uploaded_by = auth.uid() or public.is_super_admin());

drop policy if exists quotation_activity_read on public.quotation_activity_log;
create policy quotation_activity_read on public.quotation_activity_log for select using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_activity_insert on public.quotation_activity_log;
create policy quotation_activity_insert on public.quotation_activity_log for insert with check (
  public.can_access_quotation(quotation_id) and actor_id = auth.uid()
);

drop policy if exists quotation_comments_read on public.quotation_comments;
create policy quotation_comments_read on public.quotation_comments for select using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_comments_write on public.quotation_comments;
create policy quotation_comments_write on public.quotation_comments for insert with check (
  public.can_access_quotation(quotation_id) and author_id = auth.uid()
);

drop policy if exists quotation_reviews_read on public.quotation_item_reviews;
create policy quotation_reviews_read on public.quotation_item_reviews for select using (public.can_access_quotation(quotation_id));
drop policy if exists quotation_reviews_insert on public.quotation_item_reviews;
create policy quotation_reviews_insert on public.quotation_item_reviews for insert with check (
  public.can_access_quotation(quotation_id) and requested_by = auth.uid()
);
drop policy if exists quotation_reviews_update on public.quotation_item_reviews;
create policy quotation_reviews_update on public.quotation_item_reviews for update using (
  assigned_to = auth.uid() or public.quotation_user_department() = 'compras' or public.is_super_admin()
);

drop policy if exists quotation_files_read on storage.objects;
create policy quotation_files_read on storage.objects for select using (
  bucket_id = 'quotation-files'
  and public.can_access_quotation((storage.foldername(name))[1]::uuid)
);
drop policy if exists quotation_files_insert on storage.objects;
create policy quotation_files_insert on storage.objects for insert with check (
  bucket_id = 'quotation-files'
  and public.can_access_quotation((storage.foldername(name))[1]::uuid)
);
drop policy if exists quotation_files_update on storage.objects;
create policy quotation_files_update on storage.objects for update using (
  bucket_id = 'quotation-files' and owner_id = auth.uid()::text
);
drop policy if exists quotation_files_delete_super_admin on storage.objects;
create policy quotation_files_delete_super_admin on storage.objects for delete using (
  bucket_id = 'quotation-files' and public.is_super_admin()
);

grant select, insert, update on public.quotation_items to authenticated;
grant select, insert, update on public.quotation_item_costs to authenticated;
grant select on public.quotation_validations, public.quotation_validation_items to authenticated;
grant select, insert, update on public.quotation_attachments to authenticated;
grant select, insert on public.quotation_activity_log to authenticated;
grant select, insert, update on public.quotation_comments to authenticated;
grant select, insert, update on public.quotation_item_reviews to authenticated;
grant select on public.quotation_workflow_metrics to authenticated;
grant execute on function public.sync_legacy_quotation_items(uuid) to authenticated;
grant execute on function public.sync_quotation_item_to_legacy(uuid) to authenticated;
grant execute on function public.validate_quotation_costs(uuid, text, text, text, uuid[]) to authenticated;
