-- Alcance operativo de Cotizador / Compras.
-- Ventas: cotizaciones propias. Compras: cola compartida y asignadas.
-- Managers / Administración: visión completa. Super Admin: acceso completo.

create or replace function public.quotation_is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (
        lower(coalesce(role, '')) in ('super_admin', 'admin', 'manager', 'sales_manager', 'purchasing_manager', 'team_lead')
        or lower(coalesce(department, '')) in ('administracion', 'manager')
      )
  );
$$;

create or replace function public.can_access_quotation(target_quote uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.cotizaciones q
    where q.id = target_quote
      and (
        public.quotation_is_manager()
        or q.owner_id = auth.uid()
        or q.sales_owner_id = auth.uid()
        or q.purchasing_owner_id = auth.uid()
        or q.tender_owner_id = auth.uid()
        or (
          public.quotation_user_department() = 'compras'
          and q.sent_to_purchasing_at is not null
        )
        or (
          public.quotation_user_department() = 'licitaciones'
          and q.workflow_status in ('lista_para_licitaciones', 'en_licitaciones', 'adjudicada', 'cerrada')
        )
      )
  );
$$;

create or replace function public.can_edit_quotation(target_quote uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.cotizaciones q
    where q.id = target_quote
      and (
        public.quotation_is_manager()
        or q.owner_id = auth.uid()
        or q.sales_owner_id = auth.uid()
        or q.purchasing_owner_id = auth.uid()
        or q.tender_owner_id = auth.uid()
      )
  );
$$;

-- Vincula cotizaciones históricas con el usuario de Ventas cuando el nombre o
-- email guardado permite identificarlo sin ambigüedad.
update public.cotizaciones q
set sales_owner_id = p.id,
    owner_id = coalesce(q.owner_id, p.id)
from public.profiles p
where q.sales_owner_id is null
  and (
    lower(trim(coalesce(q.vendedor, ''))) = lower(trim(coalesce(p.full_name, '')))
    or lower(trim(coalesce(q.vendedor, ''))) = lower(trim(coalesce(p.email, '')))
  )
  and coalesce(q.vendedor, '') <> '';

alter table public.cotizaciones enable row level security;
drop policy if exists cotizaciones_authenticated_all on public.cotizaciones;
drop policy if exists cotizaciones_scoped_read on public.cotizaciones;
drop policy if exists cotizaciones_scoped_insert on public.cotizaciones;
drop policy if exists cotizaciones_scoped_update on public.cotizaciones;
drop policy if exists cotizaciones_scoped_delete on public.cotizaciones;

create policy cotizaciones_scoped_read on public.cotizaciones
for select to authenticated
using (public.can_access_quotation(id));

create policy cotizaciones_scoped_insert on public.cotizaciones
for insert to authenticated
with check (
  public.quotation_is_manager()
  or owner_id = auth.uid()
  or sales_owner_id = auth.uid()
);

create policy cotizaciones_scoped_update on public.cotizaciones
for update to authenticated
using (
  public.can_edit_quotation(id)
  or (
    public.quotation_user_department() = 'compras'
    and sent_to_purchasing_at is not null
    and purchasing_owner_id is null
  )
)
with check (
  public.quotation_is_manager()
  or owner_id = auth.uid()
  or sales_owner_id = auth.uid()
  or purchasing_owner_id = auth.uid()
  or tender_owner_id = auth.uid()
);

create policy cotizaciones_scoped_delete on public.cotizaciones
for delete to authenticated
using (
  public.quotation_is_manager()
  or owner_id = auth.uid()
  or sales_owner_id = auth.uid()
);

-- Los renglones se leen con la cotización, pero solo sus responsables pueden
-- escribir. Un comprador debe tomar una solicitud antes de cargar costos.
drop policy if exists quotation_items_insert on public.quotation_items;
drop policy if exists quotation_items_update on public.quotation_items;
create policy quotation_items_insert on public.quotation_items for insert to authenticated
with check (public.can_edit_quotation(quotation_id));
create policy quotation_items_update on public.quotation_items for update to authenticated
using (public.can_edit_quotation(quotation_id))
with check (public.can_edit_quotation(quotation_id));

drop policy if exists quotation_costs_purchasing_write on public.quotation_item_costs;
create policy quotation_costs_purchasing_write on public.quotation_item_costs for all to authenticated
using (
  public.quotation_is_manager()
  or exists (
    select 1 from public.quotation_items i
    join public.cotizaciones q on q.id = i.quotation_id
    where i.id = quotation_item_id
      and q.purchasing_owner_id = auth.uid()
  )
)
with check (
  public.quotation_is_manager()
  or exists (
    select 1 from public.quotation_items i
    join public.cotizaciones q on q.id = i.quotation_id
    where i.id = quotation_item_id
      and q.purchasing_owner_id = auth.uid()
  )
);

drop policy if exists quotation_attachments_insert on public.quotation_attachments;
create policy quotation_attachments_insert on public.quotation_attachments for insert to authenticated
with check (public.can_edit_quotation(quotation_id) and uploaded_by = auth.uid());

drop policy if exists quotation_activity_insert on public.quotation_activity_log;
create policy quotation_activity_insert on public.quotation_activity_log for insert to authenticated
with check (public.can_edit_quotation(quotation_id) and actor_id = auth.uid());

drop policy if exists quotation_comments_write on public.quotation_comments;
create policy quotation_comments_write on public.quotation_comments for insert to authenticated
with check (public.can_edit_quotation(quotation_id) and author_id = auth.uid());

-- validate_quotation_costs es SECURITY DEFINER; este trigger mantiene la regla
-- de asignación incluso si alguien invoca el RPC fuera de la interfaz.
create or replace function public.enforce_quotation_validation_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  assigned_buyer uuid;
begin
  if public.quotation_is_manager() then return new; end if;
  select purchasing_owner_id into assigned_buyer
  from public.cotizaciones where id = new.quotation_id;
  if assigned_buyer is null or assigned_buyer <> auth.uid() then
    raise exception 'La cotización debe estar asignada al comprador que la valida';
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_validation_owner_guard on public.quotation_validations;
create trigger quotation_validation_owner_guard
before insert on public.quotation_validations
for each row execute function public.enforce_quotation_validation_owner();

-- La vista debe respetar RLS de las tablas base. Sin security_invoker una vista
-- creada por postgres puede exponer métricas de cotizaciones ajenas.
create or replace view public.quotation_workflow_metrics
with (security_invoker = true) as
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

grant select on public.quotation_workflow_metrics to authenticated;
