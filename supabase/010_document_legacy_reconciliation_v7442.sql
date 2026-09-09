begin;

-- PARKS ONE V7.4.4.2 CORREGIDO FINAL
-- Conciliación controlada de documentos históricos a parque canónico.
-- No fuerza TLANE PARK II, EL MARQUÉS ni GUADALUPE.
-- Se desactivan temporalmente los triggers documentales solo dentro de esta transacción.

drop table if exists tmp_v7442_targets;
create temp table tmp_v7442_targets (
  label text,
  target_park_id uuid,
  target_park_name text,
  matcher text
);

insert into tmp_v7442_targets(label, target_park_id, target_park_name, matcher)
values
  ('TOLUCA PARK II', '3bc20803-be54-42ba-912f-ad77ce651297', 'TOLUCA PARK II (SANTIN)', 'TOLUCA PARK II'),
  ('JOYA IV', '92717231-9191-41ec-9b32-e7f5e861c83e', 'LA JOYA IV', 'JOYA IV'),
  ('JOYA I Y II', '48f69dc9-4e01-4eff-9634-971f9ae359bb', 'LA JOYA I Y II', 'JOYA I Y II'),
  ('JOYA III', 'c776b716-af19-4f65-9fb1-419683a76750', 'LA JOYA III', 'JOYA III'),
  ('PARQUE INDUSTRIAL TEPEJI', 'dbbed28f-6dd1-4dd1-8048-ca3d6757236c', 'TEPEJI PARK', 'PARQUE INDUSTRIAL TEPEJI'),
  ('COACALCO II', 'a86930fc-f4d5-4d8b-a520-20708fe76b07', 'COACALCO', 'COACALCO II'),
  ('ATIZAPAN PARK', '38d0a9a4-799e-4fd9-9577-9082e8515f2a', 'ATIZAPAN PARK', 'ATIZAPAN PARK');

do $$
declare
  invalid_count int;
begin
  select count(*)
  into invalid_count
  from tmp_v7442_targets t
  where not exists (
    select 1
    from public.operational_records o
    where o.dataset_type = 'sigop_park'
      and o.park_id = t.target_park_id
  );

  if invalid_count > 0 then
    raise exception 'V7.4.4.2 cancelado: % destinos no pertenecen al padrón canónico.', invalid_count;
  end if;
end $$;

drop table if exists tmp_v7442_updates;
create temp table tmp_v7442_updates as
with fuera as (
  select
    d.id,
    d.park_id,
    d.notes,
    d.original_filename,
    case
      when coalesce(d.notes,'') ~* '(^|/)\s*TOLUCA PARK II\s*(/|$)' then 'TOLUCA PARK II'
      when coalesce(d.notes,'') ~* '(^|/)\s*JOYA I Y II\s*(/|$)' then 'JOYA I Y II'
      when coalesce(d.notes,'') ~* '(^|/)\s*JOYA III\s*(/|$)' then 'JOYA III'
      when coalesce(d.notes,'') ~* '(^|/)\s*JOYA IV\s*(/|$)' then 'JOYA IV'
      when coalesce(d.notes,'') ~* '(^|/)\s*PARQUE INDUSTRIAL TEPEJI\s*(/|$)' then 'PARQUE INDUSTRIAL TEPEJI'
      when coalesce(d.notes,'') ~* '(^|/)\s*COACALCO II\s*(/|$)' then 'COACALCO II'
      when coalesce(d.notes,'') ~* 'ATIZAPAN PARK'
        or coalesce(d.original_filename,'') ~* 'ATIZAPAN PARK'
        then 'ATIZAPAN PARK'
      else null
    end as label_detectado
  from public.documents d
  where not exists (
    select 1
    from public.operational_records o
    where o.dataset_type = 'sigop_park'
      and o.park_id = d.park_id
  )
)
select
  f.id,
  f.park_id as old_park_id,
  t.target_park_id as new_park_id,
  t.target_park_name,
  t.label
from fuera f
join tmp_v7442_targets t
  on t.label = f.label_detectado
where f.park_id is distinct from t.target_park_id;

alter table public.documents disable trigger trg_documents_workflow_audit;
alter table public.documents disable trigger trg_documents_workflow_guard;

update public.documents d
set
  park_id = u.new_park_id,
  metadata = coalesce(d.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'reconciliacion_v7442', jsonb_build_object(
        'aplicada_en', now(),
        'motivo', 'Reasignación de documentos históricos a parque canónico operativo',
        'parque_destino', u.target_park_name,
        'label_detectado', u.label,
        'old_park_id', u.old_park_id
      )
    ),
  updated_at = now()
from tmp_v7442_updates u
where d.id = u.id;

alter table public.documents enable trigger trg_documents_workflow_guard;
alter table public.documents enable trigger trg_documents_workflow_audit;

with canonical as (
  select distinct park_id
  from public.operational_records
  where dataset_type = 'sigop_park'
    and park_id is not null
),
stats as (
  select
    count(*)::int as documentos_total,
    count(*) filter (
      where exists (
        select 1 from canonical c where c.park_id = d.park_id
      )
    )::int as documentos_actuales,
    count(*) filter (
      where not exists (
        select 1 from canonical c where c.park_id = d.park_id
      )
    )::int as documentos_historicos_por_conciliar,
    count(distinct d.park_id) filter (
      where exists (
        select 1 from canonical c where c.park_id = d.park_id
      )
    )::int as parques_actuales_con_documentos
  from public.documents d
)
select
  (select count(*) from tmp_v7442_updates)::int as documentos_reparados_v7442,
  s.documentos_total,
  s.documentos_actuales,
  s.documentos_historicos_por_conciliar,
  (s.documentos_actuales + s.documentos_historicos_por_conciliar)::int as control_suma,
  s.parques_actuales_con_documentos,
  (select count(*) from public.operational_records where dataset_type = 'hydrica')::int as hidrica_operational_records,
  (select count(*) from public.operational_records where dataset_type = 'hydrica_unmatched')::int as hidrica_sin_conciliar
from stats s;

commit;
