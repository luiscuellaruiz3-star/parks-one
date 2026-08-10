-- =============================================================
-- PARKS ONE V7.2 · CATÁLOGO MAESTRO Y ESTRUCTURA OPERATIVA
-- Ejecutar UNA VEZ en Supabase SQL Editor antes de publicar V7.2.
-- =============================================================

create extension if not exists pgcrypto;

-- 1) Catálogo vivo ------------------------------------------------
alter table public.parks add column if not exists updated_at timestamptz not null default now();
alter table public.parks add column if not exists created_at timestamptz not null default now();
alter table public.parks add column if not exists notes text;

alter table public.regions add column if not exists updated_at timestamptz not null default now();
alter table public.regions add column if not exists created_at timestamptz not null default now();

-- 2) Responsabilidad directa: uno o varios parques por usuario -----
create table if not exists public.park_assignments (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  constraint park_assignments_dates_chk check (valid_to is null or valid_to >= valid_from)
);
create index if not exists idx_park_assignments_park on public.park_assignments(park_id);
create index if not exists idx_park_assignments_user on public.park_assignments(user_id);
create index if not exists idx_park_assignments_active on public.park_assignments(user_id,park_id) where valid_to is null;
create unique index if not exists uq_park_assignments_active on public.park_assignments(user_id,park_id) where valid_to is null;

-- 3) Bitácora legible de cambios ----------------------------------
create table if not exists public.org_change_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('parque','region','division','asignacion','usuario')),
  entity_id uuid,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  effective_from timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_org_history_entity on public.org_change_history(entity_type,entity_id);
create index if not exists idx_org_history_effective on public.org_change_history(effective_from desc);

-- 4) Periodos históricos parque → región → división ----------------
-- Permite responder: "¿A qué región/división pertenecía este parque el 1/jun/2026?"
create table if not exists public.park_structure_periods (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks(id) on delete cascade,
  region_id uuid references public.regions(id) on delete restrict,
  division_id uuid references public.divisions(id) on delete restrict,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint park_structure_dates_chk check (valid_to is null or valid_to >= valid_from)
);
create index if not exists idx_park_structure_asof on public.park_structure_periods(park_id,valid_from,valid_to);
create unique index if not exists uq_park_structure_current on public.park_structure_periods(park_id) where valid_to is null;

-- Semilla de estructura actual para parques que aún no tienen periodo.
insert into public.park_structure_periods(park_id,region_id,division_id,valid_from)
select p.id,p.region_id,r.division_id,coalesce(p.created_at,now())
from public.parks p
left join public.regions r on r.id=p.region_id
where not exists (select 1 from public.park_structure_periods x where x.park_id=p.id);

-- 5) Funciones auxiliares ------------------------------------------
create or replace function public.parks_one_is_architect()
returns boolean
language sql stable security definer set search_path=public
as $$
  select coalesce((select lower(role::text) in ('arquitecto','architect') from public.profiles where id=auth.uid()),false)
$$;

create or replace function public.park_structure_at(p_park uuid,p_at timestamptz default now())
returns table(park_id uuid,region_id uuid,division_id uuid,valid_from timestamptz,valid_to timestamptz)
language sql stable security definer set search_path=public
as $$
  select s.park_id,s.region_id,s.division_id,s.valid_from,s.valid_to
  from public.park_structure_periods s
  where s.park_id=p_park
    and s.valid_from<=p_at
    and (s.valid_to is null or s.valid_to>p_at)
  order by s.valid_from desc limit 1
$$;

-- Mantener periodos al mover un parque de región.
create or replace function public.sync_park_structure_period()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_division uuid;
begin
  if tg_op='INSERT' or old.region_id is distinct from new.region_id then
    select division_id into v_division from public.regions where id=new.region_id;
    if tg_op='UPDATE' then
      update public.park_structure_periods set valid_to=now()
      where park_id=new.id and valid_to is null;
    end if;
    if not exists(select 1 from public.park_structure_periods where park_id=new.id and valid_to is null) then
      insert into public.park_structure_periods(park_id,region_id,division_id,valid_from)
      values(new.id,new.region_id,v_division,now());
    end if;
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists trg_parks_structure_period on public.parks;
create trigger trg_parks_structure_period before insert or update of region_id on public.parks
for each row execute function public.sync_park_structure_period();

-- Si una región cambia de división, actualiza el periodo vigente de todos sus parques.
create or replace function public.sync_region_division_periods()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now();
  if old.division_id is distinct from new.division_id then
    update public.park_structure_periods s set valid_to=now()
      where s.region_id=new.id and s.valid_to is null;
    insert into public.park_structure_periods(park_id,region_id,division_id,valid_from)
      select p.id,new.id,new.division_id,now() from public.parks p where p.region_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_regions_division_period on public.regions;
create trigger trg_regions_division_period before update of division_id on public.regions
for each row execute function public.sync_region_division_periods();

-- 6) Migración de administradores antiguos -------------------------
-- Su viejo alcance "parque" se conserva como responsabilidad directa,
-- pero su autorización efectiva pasa a la región del parque.
insert into public.park_assignments(park_id,user_id,is_primary,valid_from,created_by,change_reason)
select us.park_id,us.user_id,true,coalesce(us.created_at,now()),auth.uid(),'Migración V7.2 desde alcance por parque'
from public.user_scopes us
join public.profiles pr on pr.id=us.user_id
where lower(pr.role::text) in ('administrador','administrator')
  and us.scope_type::text='parque' and us.park_id is not null
on conflict do nothing;

insert into public.user_scopes(user_id,scope_type,region_id,created_by,created_at)
select distinct us.user_id,'region'::public.parks_one_scope_type,p.region_id,auth.uid(),now()
from public.user_scopes us
join public.profiles pr on pr.id=us.user_id
join public.parks p on p.id=us.park_id
where lower(pr.role::text) in ('administrador','administrator')
  and us.scope_type::text='parque' and p.region_id is not null
on conflict do nothing;

delete from public.user_scopes us
using public.profiles pr
where pr.id=us.user_id
  and lower(pr.role::text) in ('administrador','administrator')
  and us.scope_type::text='parque';

-- 7) Seguridad ------------------------------------------------------
alter table public.park_assignments enable row level security;
alter table public.org_change_history enable row level security;
alter table public.park_structure_periods enable row level security;

-- Lectura autenticada de catálogos/historial; escritura exclusiva del Arquitecto.
do $$ begin
  create policy "park_assignments_read" on public.park_assignments for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "park_assignments_architect_write" on public.park_assignments for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "org_history_read" on public.org_change_history for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "org_history_architect_write" on public.org_change_history for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "park_structure_read" on public.park_structure_periods for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "park_structure_architect_write" on public.park_structure_periods for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;

-- Asegurar que el Arquitecto pueda mantener catálogos existentes.
do $$ begin
  create policy "divisions_architect_write_v72" on public.divisions for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "regions_architect_write_v72" on public.regions for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "parks_architect_write_v72" on public.parks for all to authenticated using (public.parks_one_is_architect()) with check (public.parks_one_is_architect());
exception when duplicate_object then null; end $$;

-- 8) Vista de control actual ---------------------------------------
create or replace view public.v_park_structure_current as
select p.id park_id,p.code park_code,p.name park_name,p.commercial_name,p.status,
       r.id region_id,r.code region_code,r.name region_name,
       d.id division_id,d.code division_code,d.name division_name,
       s.valid_from structure_valid_from
from public.parks p
left join public.regions r on r.id=p.region_id
left join public.divisions d on d.id=r.division_id
left join public.park_structure_periods s on s.park_id=p.id and s.valid_to is null;

grant select on public.v_park_structure_current to authenticated;
