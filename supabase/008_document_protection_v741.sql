-- PARKS ONE V7.4.1 · PROTECCIÓN DOCUMENTAL
-- Completa auditoría servidor para modificaciones documentales.
-- No altera Top 5, Hídrica, operational_records ni el padrón.

begin;

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
  -- Procesos internos sin usuario interactivo no generan una identidad falsa.
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

  elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    v_action := 'DOCUMENT_UPDATED';
    v_message := 'Información documental modificada.';

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
    jsonb_build_object(
      'server_enforced', true,
      'workflow_status', new.workflow_status::text,
      'change_type', case when tg_op='INSERT' then 'insert' else 'update' end
    )
  );

  return new;
end;
$function$;

-- Antes sólo escuchaba cambios de workflow_status; ahora escucha TODO UPDATE.
drop trigger if exists trg_documents_workflow_audit on public.documents;
create trigger trg_documents_workflow_audit
after insert or update on public.documents
for each row execute function private.audit_document_workflow();

commit;

-- Verificación final
select
  t.tgname as trigger,
  pg_get_triggerdef(t.oid) as definicion
from pg_trigger t
where t.tgrelid = 'public.documents'::regclass
  and t.tgname = 'trg_documents_workflow_audit';
