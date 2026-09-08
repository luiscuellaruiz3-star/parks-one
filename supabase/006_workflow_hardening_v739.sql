-- PARKS ONE V7.3.9 · FLUJOS PERSISTENTES + HARDENING DE APROBACION
-- Ejecutar UNA sola vez en Supabase SQL Editor.
-- Conserva alcances confirmados:
--   Administrador -> su Región
--   Regional      -> su División
--   Divisional    -> nacional
--   Arquitecto    -> nacional + control total

begin;

-- 1) Gestión posterior a la carga: Administrador puede INSERTAR en su Región,
--    pero no modificar/aprobar documentos ya creados. Regional gestiona su División.
create or replace function private.can_manage_park_document(target_park uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when private.current_role()::text in ('arquitecto','divisional') then true
    when private.current_role()::text = 'regional' then private.can_access_park(target_park)
    else false
  end;
$function$;

-- 2) Estado documental que se aplica al publicar un archivo real.
--    No usa "integrado" porque ese valor NO existe en public.document_status.
create or replace function private.workflow_published_status(target_expiration date)
returns public.document_status
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when target_expiration is not null and target_expiration < current_date
      then 'vencido'::public.document_status
    when target_expiration is not null and target_expiration <= current_date + 60
      then 'por_vencer'::public.document_status
    else 'vigente'::public.document_status
  end;
$function$;

-- 3) El servidor impone el flujo. El cliente NO puede autoaprobarse.
create or replace function private.enforce_document_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_role text := coalesce(private.current_role()::text, '');
  v_service boolean := coalesce(auth.role() = 'service_role', false);
begin
  -- Importaciones administrativas con service_role conservan su comportamiento.
  if v_service then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception 'Sesión requerida para cargar documentos.';
    end if;

    new.uploaded_by := auth.uid();

    if v_role = 'administrador' then
      new.workflow_status := 'en_revision'::public.workflow_status;
      new.status := 'por_validar'::public.document_status;
      new.approved_by := null;
      new.approved_at := null;

    elsif v_role in ('regional','divisional','arquitecto') then
      if not private.can_write_park(new.park_id) then
        raise exception 'El usuario no puede publicar en este parque.';
      end if;
      new.workflow_status := 'aprobado'::public.workflow_status;
      new.status := private.workflow_published_status(new.expiration_date);
      new.approved_by := auth.uid();
      new.approved_at := now();

    else
      raise exception 'El rol % no puede cargar documentos.', v_role;
    end if;

    return new;
  end if;

  -- No se permite mover un documento entre parques mediante UPDATE.
  if new.park_id is distinct from old.park_id then
    raise exception 'No se permite cambiar el parque de un documento existente.';
  end if;

  -- El autor original nunca se sustituye.
  new.uploaded_by := old.uploaded_by;

  -- Toda transición de flujo o cambio manual de estado exige facultad de gestión.
  if new.workflow_status is distinct from old.workflow_status
     or new.status is distinct from old.status
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then

    if not private.can_manage_park_document(old.park_id) then
      raise exception 'Tu rol no tiene facultad para dictaminar este documento.';
    end if;

    if new.workflow_status = 'aprobado'::public.workflow_status then
      new.status := private.workflow_published_status(new.expiration_date);
      new.approved_by := auth.uid();
      new.approved_at := now();

    elsif new.workflow_status = 'rechazado'::public.workflow_status then
      new.status := 'por_validar'::public.document_status;
      new.approved_by := null;
      new.approved_at := null;

    elsif new.workflow_status is distinct from old.workflow_status then
      raise exception 'Transición de flujo no permitida: % -> %.', old.workflow_status, new.workflow_status;

    else
      -- Si solo intentaron alterar status/approved_* sin transición, manda el flujo.
      if old.workflow_status = 'aprobado'::public.workflow_status then
        new.status := private.workflow_published_status(new.expiration_date);
        new.approved_by := old.approved_by;
        new.approved_at := old.approved_at;
      else
        new.status := old.status;
        new.approved_by := old.approved_by;
        new.approved_at := old.approved_at;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_documents_workflow_guard on public.documents;
create trigger trg_documents_workflow_guard
before insert or update on public.documents
for each row execute function private.enforce_document_workflow();

-- 4) UPDATE documental: Administrador ya no puede alterar/aprobar filas existentes.
drop policy if exists documents_update on public.documents;
create policy documents_update
on public.documents
for update
to authenticated
using (private.can_manage_park_document(park_id))
with check (private.can_manage_park_document(park_id));

-- 5) Storage UPDATE: misma regla. Administrador conserva INSERT para nuevas cargas.
drop policy if exists parks_docs_update on storage.objects;
create policy parks_docs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'parks-documentos'
  and private.can_manage_park_document(private.path_park_id(name))
)
with check (
  bucket_id = 'parks-documentos'
  and private.can_manage_park_document(private.path_park_id(name))
);

-- 6) Bitácora: cada usuario inserta únicamente eventos propios.
alter table public.audit_events enable row level security;

drop policy if exists audit_events_insert_self on public.audit_events;
create policy audit_events_insert_self
on public.audit_events
for insert
to authenticated
with check (actor_id = (select auth.uid()));

drop policy if exists audit_events_select_scoped on public.audit_events;
create policy audit_events_select_scoped
on public.audit_events
for select
to authenticated
using (
  actor_id = (select auth.uid())
  or private.current_role()::text in ('arquitecto','divisional','direccion','director','ceo')
  or (
    private.current_role()::text = 'regional'
    and park_id is not null
    and private.can_access_park(park_id)
  )
);

-- 7) Auditoría SERVIDOR: carga/aprobación/devolución quedan registradas aunque
--    alguien intente saltarse la interfaz.
create or replace function private.audit_document_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := '';
  v_email text := '';
  v_role text := '';
  v_park_name text := '';
  v_region_id uuid;
  v_region_code text := '';
  v_division_id uuid;
  v_division_code text := '';
  v_action text := '';
  v_result text := 'success';
  v_message text := '';
begin
  -- Service-role/importaciones sin usuario interactivo no generan evento aquí.
  if v_uid is null then
    return new;
  end if;

  select coalesce(p.full_name,p.email,'Usuario'), coalesce(p.email,''), p.role::text
    into v_name, v_email, v_role
  from public.profiles p
  where p.id = v_uid;

  select coalesce(pk.commercial_name,pk.name,''), r.id, coalesce(r.code,''), d.id, coalesce(d.code,'')
    into v_park_name, v_region_id, v_region_code, v_division_id, v_division_code
  from public.parks pk
  left join public.regions r on r.id = pk.region_id
  left join public.divisions d on d.id = r.division_id
  where pk.id = new.park_id;

  if tg_op = 'INSERT' then
    v_action := 'DOCUMENT_UPLOADED';
    if new.workflow_status = 'en_revision'::public.workflow_status then
      v_result := 'pending';
      v_message := 'Documento cargado y enviado a revisión.';
    else
      v_result := 'success';
      v_message := 'Documento cargado y publicado directamente.';
    end if;

  elsif new.workflow_status is distinct from old.workflow_status
        and new.workflow_status = 'aprobado'::public.workflow_status then
    v_action := 'DOCUMENT_APPROVED';
    v_message := 'Documento aprobado y publicado.';

  elsif new.workflow_status is distinct from old.workflow_status
        and new.workflow_status = 'rechazado'::public.workflow_status then
    v_action := 'DOCUMENT_RETURNED';
    v_result := 'pending';
    v_message := coalesce(new.metadata->>'return_note','Documento devuelto para corrección.');

  else
    return new;
  end if;

  insert into public.audit_events (
    actor_id, actor_name, actor_email, actor_role,
    division_id, division_code, region_id, region_code,
    park_id, park_name, document_id, document_name, file_name,
    category, action, result, message, before_data, after_data, metadata
  ) values (
    v_uid, coalesce(nullif(v_name,''),'Usuario'), coalesce(v_email,''), coalesce(v_role,''),
    v_division_id, coalesce(v_division_code,''), v_region_id, coalesce(v_region_code,''),
    new.park_id, coalesce(v_park_name,''), new.id, coalesce(new.title,''), coalesce(new.original_filename,''),
    'document', v_action, v_result, v_message,
    case when tg_op='UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),
    jsonb_build_object('server_enforced',true,'workflow_status',new.workflow_status::text)
  );

  return new;
end;
$function$;

drop trigger if exists trg_documents_workflow_audit on public.documents;
create trigger trg_documents_workflow_audit
after insert or update of workflow_status on public.documents
for each row execute function private.audit_document_workflow();

commit;

-- VERIFICACION FINAL (solo lectura)
select 'trigger' as tipo, tgname as nombre
from pg_trigger
where tgrelid='public.documents'::regclass and not tgisinternal
union all
select 'policy', policyname
from pg_policies
where (schemaname='public' and tablename in ('documents','audit_events'))
   or (schemaname='storage' and tablename='objects')
order by tipo,nombre;
