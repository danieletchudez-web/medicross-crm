-- ============================================================
--  DAILY MOTIVATION — Supabase SQL
--  Tabla: daily_motivational_messages
--  Tabla: user_daily_message_views
--  RLS basado en tabla "profiles" existente (campo: role)
--  Roles con permisos de administración: super_admin, manager
-- ============================================================

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────
--  1. TABLA: daily_motivational_messages
-- ────────────────────────────────────────────────────────────
create table if not exists public.daily_motivational_messages (
  id             uuid        primary key default gen_random_uuid(),
  message        text        not null,
  subtitle       text,
  category       text        not null default 'general',
  is_active      boolean     not null default true,
  scheduled_date date,
  created_by     uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table  public.daily_motivational_messages is 'Mensajes motivadores que se muestran al inicio de jornada.';
comment on column public.daily_motivational_messages.scheduled_date is 'Si está definida, el mensaje se muestra solo ese día. Null = pool aleatorio.';

-- ────────────────────────────────────────────────────────────
--  2. TABLA: user_daily_message_views
-- ────────────────────────────────────────────────────────────
create table if not exists public.user_daily_message_views (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  message_id uuid        not null references public.daily_motivational_messages(id) on delete cascade,
  view_date  date        not null default current_date,
  viewed_at  timestamptz not null default now(),
  unique(user_id, view_date)
);

comment on table public.user_daily_message_views is 'Registro de qué usuario vio qué mensaje cada día. Max 1 por usuario por día.';

-- ────────────────────────────────────────────────────────────
--  3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
alter table public.daily_motivational_messages enable row level security;
alter table public.user_daily_message_views     enable row level security;

-- daily_motivational_messages: LECTURA (todos los autenticados ven mensajes activos)
create policy "dmm_select_authenticated"
  on public.daily_motivational_messages
  for select
  to authenticated
  using (is_active = true);

-- daily_motivational_messages: INSERT (solo super_admin / manager)
create policy "dmm_insert_admin"
  on public.daily_motivational_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('super_admin', 'manager')
    )
  );

-- daily_motivational_messages: UPDATE (solo super_admin / manager)
create policy "dmm_update_admin"
  on public.daily_motivational_messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('super_admin', 'manager')
    )
  );

-- daily_motivational_messages: DELETE (solo super_admin / manager)
create policy "dmm_delete_admin"
  on public.daily_motivational_messages
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('super_admin', 'manager')
    )
  );

-- user_daily_message_views: SELECT (cada usuario solo ve los suyos)
create policy "udmv_select_own"
  on public.user_daily_message_views
  for select
  to authenticated
  using (user_id = auth.uid());

-- user_daily_message_views: INSERT (cada usuario solo puede insertar los suyos)
create policy "udmv_insert_own"
  on public.user_daily_message_views
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
--  4. MENSAJES INICIALES (35 mensajes)
-- ────────────────────────────────────────────────────────────
insert into public.daily_motivational_messages (message, subtitle, category) values

  -- ventas
  ('La venta empieza cuando el cliente siente que lo entendés.',
   'Escuchá antes de proponer. La empatía cierra más que la insistencia.',
   'ventas'),

  ('El mejor vendedor no es el que insiste más, sino el que acompaña mejor.',
   'Construí confianza y el cierre llega naturalmente.',
   'ventas'),

  ('Cerrar una venta no es el final: es el inicio de una relación.',
   'El cliente que vuelve vale más que el que llegó por primera vez.',
   'ventas'),

  ('Una propuesta enviada sin seguimiento es una oportunidad a mitad de camino.',
   'El 80 % de las ventas requieren al menos cinco contactos. ¿Estás en el primero?',
   'ventas'),

  ('El cierre no ocurre en un momento, se construye en cada interacción.',
   'Cada conversación es un ladrillo. Hoy, ¿cuántos vas a poner?',
   'ventas'),

  -- seguimiento
  ('Cada seguimiento bien hecho acerca una oportunidad al cierre.',
   'No dejes que el silencio del cliente se convierta en un "no" por defecto.',
   'seguimiento'),

  ('Las oportunidades no desaparecen: se pierden por falta de seguimiento.',
   'Un recordatorio a tiempo puede reactivar un negocio dormido.',
   'seguimiento'),

  ('El seguimiento oportuno diferencia a los que cierran de los que esperan.',
   'Agendá tu próxima acción antes de cerrar la visita.',
   'seguimiento'),

  ('Un cliente sin próxima acción agendada es un cliente en pausa.',
   'Siempre salí de una reunión con una fecha confirmada.',
   'seguimiento'),

  ('La próxima acción define si una oportunidad avanza o se congela.',
   'Sin paso siguiente, no hay pipeline que gestionar.',
   'seguimiento'),

  -- crm / registro
  ('Un CRM ordenado vende más que una memoria improvisada.',
   'Registrá hoy lo que no vas a poder recordar mañana.',
   'crm'),

  ('Lo que no se registra, se pierde.',
   'Cada dato en el sistema es una decisión que podés tomar mejor.',
   'crm'),

  ('Empezar el día con el CRM actualizado es empezar con ventaja.',
   'Tres minutos al inicio valen más que una hora de improvisación al final.',
   'crm'),

  ('Cada registro es un activo. Cada olvido, un costo.',
   'El historial de un cliente es la memoria del equipo comercial.',
   'crm'),

  ('Conocer el estado de cada cuenta es conocer el estado de tu negocio.',
   'Revisá tu pipeline. Las respuestas están en los datos.',
   'crm'),

  -- productividad / orden
  ('Hoy no se trata de hacer todo, sino de avanzar en lo que realmente importa.',
   'Priorizá una tarea clave y ejecutala con foco.',
   'productividad'),

  ('Cerrar tareas también es abrir oportunidades.',
   'Cada tarea completada libera energía para lo que sigue.',
   'productividad'),

  ('Cada tarea completada es un paso más hacia el objetivo mensual.',
   'No subestimes el valor de lo que tachás de la lista hoy.',
   'productividad'),

  ('No hay mejor mañana que el que se planifica hoy.',
   'Cinco minutos de planificación al final del día valen una hora al inicio.',
   'productividad'),

  ('Un vendedor organizado tiene más energía para lo que importa: el cliente.',
   'El orden no resta tiempo: lo crea.',
   'productividad'),

  -- visitas
  ('Una visita bien preparada vale el doble.',
   'Conocé la situación del cliente antes de llegar. El contexto cierra puertas y también las abre.',
   'visitas'),

  ('Las visitas planeadas convierten más que las visitas improvisadas.',
   'Definí un objetivo claro para cada salida.',
   'visitas'),

  ('Cada visita sin registro es una oportunidad sin historia.',
   'Tomá nota inmediatamente después. La memoria se desvanece antes de lo que pensás.',
   'visitas'),

  ('Una visita bien registrada acelera la siguiente.',
   'El contexto que anotás hoy es el argumento que usás en la próxima reunión.',
   'visitas'),

  -- clientes / relaciones
  ('El cliente recuerda quién resolvió, no quién prometió.',
   'Acción concreta hoy. No mañana.',
   'clientes'),

  ('La confianza del cliente se construye visita a visita, llamada a llamada.',
   'No hay atajo para la confianza. Hay constancia.',
   'clientes'),

  ('Acompañar a un cliente es más poderoso que convencerlo.',
   'Ser un recurso valioso para él es la mejor estrategia de venta.',
   'clientes'),

  ('Las mejores relaciones comerciales se construyen con constancia, no con premura.',
   'La urgencia espanta. La presencia sostenida genera lealtad.',
   'clientes'),

  -- equipo / gestión
  ('La constancia comercial construye resultados invisibles hasta que aparecen.',
   'Seguí adelante. Los resultados de hoy son la suma de lo que hiciste semanas atrás.',
   'constancia'),

  ('Los pequeños avances diarios son los únicos que acumulan resultados.',
   'Un porcentaje por día, todos los días, construye meses ganadores.',
   'constancia'),

  ('El equipo que comparte información vende más que el que compite por ella.',
   'Los datos compartidos multiplican las oportunidades de todos.',
   'equipo'),

  ('Un equipo alineado con datos toma mejores decisiones.',
   'Registrá lo que sabés para que el equipo se beneficie de tu experiencia.',
   'equipo'),

  -- oportunidades / pipeline
  ('Un pipeline ordenado es una meta visible.',
   'Lo que podés ver, podés gestionar. Lo que podés gestionar, podés mejorar.',
   'pipeline'),

  ('La oportunidad más valiosa es la que está justo frente a vos.',
   'Revisá tu lista de oportunidades abiertas. Hay una que está esperando tu llamado.',
   'pipeline'),

  ('Registrar hoy lo que pasó ayer es retrasar una decisión.',
   'El tiempo real entre visita y registro es el tiempo que tardás en perder contexto.',
   'pipeline');
