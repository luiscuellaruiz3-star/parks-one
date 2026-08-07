-- =========================================================
-- PARKS ONE
-- Migración 001 corregida:
-- usuarios, roles, divisiones y alcances
-- Compatible con la base existente
-- =========================================================

-- ---------------------------------------------------------
-- 1. Ampliar roles existentes
-- Se conservan direccion y consulta por compatibilidad
-- ---------------------------------------------------------

alter type public.app_role add value if not exists 'ceo';
alter type public.app_role add value if not exists 'director';
alter type public.app_role add value if not exists 'divisional';

-- Ya existentes:
-- arquitecto
-- direccion
-- regional
-- administrador
-- consulta

-- ---------------------------------------------------------
-- 2. Estados de usuario
-- ---------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'parks_one_user_status'
  ) then
    create type public.parks_one_user_status as enum (
      'pendiente',
      'activo',
      'suspendido'
    );
  end if;
end
$$;

-- ---------------------------------------------------------
-- 3. Tipos de alcance
-- ---------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'parks_one_scope_type'
  ) then
    create type public.parks_one_scope_type as enum (
      'nacional',
      'division',
      'region',
      'parque'
    );
  end if;
end
$$;

-- ---------------------------------------------------------
-- 4. Divisiones
-- ---------------------------------------------------------

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 5. Relacionar regiones con divisiones
-- Se deja nullable hasta cargar el catálogo real
-- ---------------------------------------------------------

alter table public.regions
  add column if not exists division_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'regions_division_id_fkey'
  ) then
    alter table public.regions
      add constraint regions_division_id_fkey
      foreign key (division_id)
      references public.divisions(id)
      on update cascade
      on delete restrict;
  end if;
end
$$;

create index if not exists idx_regions_division_id
  on public.regions(division_id);

-- ---------------------------------------------------------
-- 6. Ampliar profiles existente
-- ---------------------------------------------------------

alter table public.profiles
  add column if not exists status public.parks_one_user_status;

alter table public.profiles
  add column if not exists approved_by uuid;

alter table public.profiles
  add column if not exists approved_at timestamptz;

alter table public.profiles
  add column if not exists suspended_at timestamptz;

alter table public.profiles
  add column if not exists last_login_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_approved_by_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_approved_by_fkey
      foreign key (approved_by)
      references auth.users(id)
      on delete set null;
  end if;
end
$$;

-- Convertir el usuario actual a estado activo
update public.profiles
set status = case
  when is_active = true then 'activo'::public.parks_one_user_status
  else 'suspendido'::public.parks_one_user_status
end
where status is null;

alter table public.profiles
  alter column status set default 'pendiente';

alter table public.profiles
  alter column status set not null;

-- ---------------------------------------------------------
-- 7. Alcances de usuario
-- Un usuario puede tener una o varias regiones/parques
-- ---------------------------------------------------------

create table if not exists public.user_scopes (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  scope_type public.parks_one_scope_type not null,

  division_id uuid
    references public.divisions(id)
    on delete cascade,

  region_id uuid
    references public.regions(id)
    on delete cascade,

  park_id uuid
    references public.parks(id)
    on delete cascade,

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default now(),

  constraint user_scopes_valid_scope check (
    (
      scope_type = 'nacional'
      and division_id is null
      and region_id is null
      and park_id is null
    )
    or
    (
      scope_type = 'division'
      and division_id is not null
      and region_id is null
      and park_id is null
    )
    or
    (
      scope_type = 'region'
      and division_id is null
      and region_id is not null
      and park_id is null
    )
    or
    (
      scope_type = 'parque'
      and division_id is null
      and region_id is null
      and park_id is not null
    )
  )
);

create index if not exists idx_user_scopes_user
  on public.user_scopes(user_id);

create index if not exists idx_user_scopes_division
  on public.user_scopes(division_id);

create index if not exists idx_user_scopes_region
  on public.user_scopes(region_id);

create index if not exists idx_user_scopes_park
  on public.user_scopes(park_id);

create unique index if not exists uq_user_scope_national
  on public.user_scopes(user_id, scope_type)
  where scope_type = 'nacional';

create unique index if not exists uq_user_scope_division
  on public.user_scopes(user_id, division_id)
  where scope_type = 'division';

create unique index if not exists uq_user_scope_region
  on public.user_scopes(user_id, region_id)
  where scope_type = 'region';

create unique index if not exists uq_user_scope_park
  on public.user_scopes(user_id, park_id)
  where scope_type = 'parque';

-- ---------------------------------------------------------
-- 8. Función updated_at
-- ---------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_divisions_updated_at
  on public.divisions;

create trigger trg_divisions_updated_at
before update on public.divisions
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 9. Seguridad RLS
-- Las políticas se crearán en la migración 002
-- ---------------------------------------------------------

alter table public.divisions enable row level security;
alter table public.user_scopes enable row level security;