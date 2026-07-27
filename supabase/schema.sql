-- PARKS ONE pilot schema (run in Supabase SQL Editor)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null check (role in ('director','architect','regional','administrator')) default 'administrator',
  regions text[] not null default '{}',
  parks text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  filename text not null,
  region text not null,
  park text not null,
  document_type text not null,
  year integer,
  expiry date,
  status text not null check (status in ('review','approved','returned','archived')) default 'approved',
  uploaded_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.datasets (
  name text primary key,
  payload jsonb not null,
  source_filename text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.datasets enable row level security;

create or replace function public.current_profile() returns public.profiles language sql stable security definer set search_path=public as $$ select * from public.profiles where id=auth.uid() $$;

create policy "profile self read" on public.profiles for select to authenticated using (id=auth.uid() or (select role from public.current_profile()) in ('director','architect'));
create policy "documents read by scope" on public.documents for select to authenticated using (
  (select role from public.current_profile()) in ('director','architect')
  or region=any((select regions from public.current_profile()))
  or park=any((select parks from public.current_profile()))
);
create policy "documents insert by operational roles" on public.documents for insert to authenticated with check (
  (select role from public.current_profile()) in ('director','architect')
  or region=any((select regions from public.current_profile()))
  or park=any((select parks from public.current_profile()))
);
create policy "documents update architect" on public.documents for update to authenticated using ((select role from public.current_profile()) in ('director','architect'));
create policy "datasets read" on public.datasets for select to authenticated using (true);
create policy "datasets write architect" on public.datasets for all to authenticated using ((select role from public.current_profile()) in ('director','architect')) with check ((select role from public.current_profile()) in ('director','architect'));

insert into storage.buckets(id,name,public,file_size_limit) values ('parks-documents','parks-documents',false,524288000) on conflict(id) do update set public=false;
create policy "storage read by authenticated" on storage.objects for select to authenticated using (bucket_id='parks-documents');
create policy "storage upload by authenticated" on storage.objects for insert to authenticated with check (bucket_id='parks-documents');
create policy "storage update architect" on storage.objects for update to authenticated using (bucket_id='parks-documents' and (select role from public.current_profile()) in ('director','architect'));
create policy "storage delete architect" on storage.objects for delete to authenticated using (bucket_id='parks-documents' and (select role from public.current_profile()) in ('director','architect'));
