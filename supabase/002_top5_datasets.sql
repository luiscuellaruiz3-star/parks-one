-- PARKS ONE V10 · dataset mensual TOP 5
-- Ejecutar una sola vez en Supabase SQL Editor.

create table if not exists public.datasets (
  name text primary key,
  payload jsonb not null,
  source_filename text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.datasets enable row level security;

drop policy if exists "datasets read" on public.datasets;
drop policy if exists "datasets write architect" on public.datasets;
drop policy if exists "parks one datasets read" on public.datasets;
drop policy if exists "parks one datasets write" on public.datasets;

create policy "parks one datasets read"
on public.datasets
for select
to authenticated
using (true);

create policy "parks one datasets write"
on public.datasets
for all
to authenticated
using (
  coalesce((
    select p.role::text
    from public.profiles p
    where p.id = auth.uid()
  ), '') in ('arquitecto','director','direccion','ceo')
)
with check (
  coalesce((
    select p.role::text
    from public.profiles p
    where p.id = auth.uid()
  ), '') in ('arquitecto','director','direccion','ceo')
);
