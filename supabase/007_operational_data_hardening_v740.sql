-- PARKS ONE V7.4.0 · HARDENING DE DATOS OPERATIVOS
-- Bloque Emilio 1.1 + 1.2
-- Objetivos:
--   1) Ningún payload nacional puede leerse fuera del alcance autorizado.
--   2) La información operativa real se normaliza en filas con park_id/region_id/division_id.
--   3) RLS aplica el mismo alcance confirmado:
--      Administrador -> Región | Regional -> División | Divisional -> Nacional | Arquitecto -> Nacional.
--   4) Cualquier ausencia de alcance DENIEGA por defecto.
--
-- Este script crea estructura y endurece políticas. NO carga la línea base.
-- La carga se hace después con scripts/migration_v740.js usando una sesión real de Arquitecto.

begin;

-- -----------------------------------------------------------------------------
-- 1. Funciones de seguridad reutilizables
-- -----------------------------------------------------------------------------
create or replace function private.is_national_reader()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(private.current_role()::text, '') in (
    'arquitecto','divisional','direccion','director','ceo','consulta'
  );
$function$;

create or replace function private.can_access_division(target_division uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when target_division is null then false
    when private.is_national_reader() then true
    when private.current_role()::text = 'regional' then exists (
      select 1
      from public.user_scopes us
      where us.user_id = (select auth.uid())
        and us.scope_type::text = 'division'
        and us.division_id = target_division
    )
    -- El Administrador puede conocer la etiqueta de su División, pero su alcance
    -- operativo sigue limitado a la Región asignada.
    when private.current_role()::text = 'administrador' then exists (
      select 1
      from public.user_scopes us
      join public.regions r on r.id = us.region_id
      where us.user_id = (select auth.uid())
        and us.scope_type::text = 'region'
        and r.division_id = target_division
    )
    else false
  end;
$function$;

create or replace function private.can_read_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when target_user is null or auth.uid() is null then false
    when target_user = auth.uid() then true
    when private.is_national_reader() then true
    when private.current_role()::text in ('regional','administrador') then exists (
      select 1
      from public.park_assignments pa
      where pa.user_id = target_user
        and pa.valid_to is null
        and private.can_access_park(pa.park_id)
    ) or exists (
      select 1
      from public.user_scopes us
      where us.user_id = target_user
        and (
          (us.scope_type::text = 'parque' and private.can_access_park(us.park_id))
          or (us.scope_type::text = 'region' and private.can_access_region(us.region_id))
          or (
            us.scope_type::text = 'division'
            and private.current_role()::text = 'regional'
            and private.can_access_division(us.division_id)
          )
        )
    )
    else false
  end;
$function$;

-- -----------------------------------------------------------------------------
-- 2. Repositorio normalizado de información operativa protegida
-- -----------------------------------------------------------------------------
create table if not exists public.operational_records (
  id uuid primary key default gen_random_uuid(),
  dataset_type text not null,
  record_key text not null,
  park_id uuid references public.parks(id) on delete cascade,
  region_id uuid references public.regions(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  source_filename text,
  source_updated_at timestamptz,
  loaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_records_scope_chk check (
    -- Se admite registro nacional sin scope; RLS solo lo entrega a lectores nacionales.
    true
  ),
  constraint operational_records_type_key_uq unique(dataset_type, record_key)
);

create index if not exists idx_operational_records_type
  on public.operational_records(dataset_type);
create index if not exists idx_operational_records_park
  on public.operational_records(park_id);
create index if not exists idx_operational_records_region
  on public.operational_records(region_id);
create index if not exists idx_operational_records_division
  on public.operational_records(division_id);

alter table public.operational_records enable row level security;

-- updated_at consistente
create or replace function private.touch_operational_record()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.loaded_by := auth.uid();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_operational_records_updated_at on public.operational_records;
create trigger trg_operational_records_updated_at
before insert or update on public.operational_records
for each row execute function private.touch_operational_record();

-- Lectura por scope real. Ninguna coincidencia => false.
drop policy if exists operational_records_select_scoped on public.operational_records;
create policy operational_records_select_scoped
on public.operational_records
for select
to authenticated
using (
  private.is_national_reader()
  or (park_id is not null and private.can_access_park(park_id))
  or (
    park_id is null
    and region_id is not null
    and private.can_access_region(region_id)
  )
  or (
    park_id is null
    and region_id is null
    and division_id is not null
    and private.current_role()::text = 'regional'
    and private.can_access_division(division_id)
  )
);

-- Sólo Arquitecto mantiene fuentes nacionales/maestras.
drop policy if exists operational_records_architect_write on public.operational_records;
create policy operational_records_architect_write
on public.operational_records
for all
to authenticated
using (private.current_role()::text = 'arquitecto')
with check (private.current_role()::text = 'arquitecto');

-- -----------------------------------------------------------------------------
-- 3. datasets: se prohíbe entregar payloads nacionales a perfiles regionales/admin.
--    Los módulos de importación son de Arquitecto; los consumidores normales
--    recibirán datos ya filtrados desde operational_records/bootstrap.
-- -----------------------------------------------------------------------------
alter table public.datasets enable row level security;

do $block$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname='public' and tablename='datasets' and cmd='SELECT'
  loop
    execute format('drop policy if exists %I on public.datasets', p.policyname);
  end loop;
end
$block$;

create policy datasets_select_national_only
on public.datasets
for select
to authenticated
using (private.is_national_reader());

-- Sustituir políticas de escritura históricas por Arquitecto exclusivamente.
drop policy if exists "parks one datasets write" on public.datasets;
drop policy if exists "datasets write architect" on public.datasets;
drop policy if exists datasets_architect_write on public.datasets;
create policy datasets_architect_write
on public.datasets
for insert
to authenticated
with check (private.current_role()::text = 'arquitecto');
create policy datasets_architect_update
on public.datasets
for update
to authenticated
using (private.current_role()::text = 'arquitecto')
with check (private.current_role()::text = 'arquitecto');
create policy datasets_architect_delete
on public.datasets
for delete
to authenticated
using (private.current_role()::text = 'arquitecto');

-- -----------------------------------------------------------------------------
-- 4. Catálogos / estructura: eliminar SELECT abiertos y recrearlos por alcance.
-- -----------------------------------------------------------------------------

-- parks
alter table public.parks enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='parks' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.parks',p.policyname); end loop;
end $block$;
create policy parks_select_scoped on public.parks for select to authenticated
using (private.can_access_park(id));

-- regions
alter table public.regions enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='regions' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.regions',p.policyname); end loop;
end $block$;
create policy regions_select_scoped on public.regions for select to authenticated
using (private.can_access_region(id));

-- divisions
alter table public.divisions enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='divisions' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.divisions',p.policyname); end loop;
end $block$;
create policy divisions_select_scoped on public.divisions for select to authenticated
using (private.can_access_division(id));

-- user_scopes: cada usuario ve sus propios scopes; lectores nacionales pueden auditar.
alter table public.user_scopes enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='user_scopes' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.user_scopes',p.policyname); end loop;
end $block$;
create policy user_scopes_select_scoped on public.user_scopes for select to authenticated
using (user_id = auth.uid() or private.is_national_reader());

-- profiles: propio perfil, nacionales o usuarios que pertenecen al alcance operativo.
alter table public.profiles enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='profiles' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.profiles',p.policyname); end loop;
end $block$;
create policy profiles_select_scoped on public.profiles for select to authenticated
using (private.can_read_profile(id));

-- park_assignments: sólo asignaciones de parques visibles.
alter table public.park_assignments enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='park_assignments' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.park_assignments',p.policyname); end loop;
end $block$;
create policy park_assignments_select_scoped on public.park_assignments for select to authenticated
using (private.can_access_park(park_id));

-- park_structure_periods: historial sólo del parque autorizado.
alter table public.park_structure_periods enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='park_structure_periods' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.park_structure_periods',p.policyname); end loop;
end $block$;
create policy park_structure_select_scoped on public.park_structure_periods for select to authenticated
using (private.can_access_park(park_id));

-- org_change_history contiene cambios de usuarios/asignaciones heterogéneos.
-- Se mantiene únicamente para lectores nacionales; no se arriesga inferencia lateral.
alter table public.org_change_history enable row level security;
do $block$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='org_change_history' and cmd='SELECT'
  loop execute format('drop policy if exists %I on public.org_change_history',p.policyname); end loop;
end $block$;
create policy org_change_history_select_national on public.org_change_history for select to authenticated
using (private.is_national_reader());

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN (solo lectura)
-- No debe aparecer ninguna policy SELECT con using_expression = true en estas tablas.
-- -----------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname='public'
  and tablename in (
    'datasets','operational_records','parks','regions','divisions','user_scopes',
    'profiles','park_assignments','park_structure_periods','org_change_history'
  )
order by tablename,cmd,policyname;
