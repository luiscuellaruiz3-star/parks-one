-- PARKS ONE V7.3.0
-- PASO 4 CORREGIDO - HARDENING SUPABASE / RLS / STORAGE
-- REGLA FUNCIONAL CONFIRMADA:
--   Regional      = todas las regiones de SU DIVISION
--   Divisional    = alcance NACIONAL (coberturas)
--   Administrador = SU REGION
--   Arquitecto    = NACIONAL
-- Proyecto: parks-one-demo / xmiushrjmlatrogfrsxu
--
-- IMPORTANTE:
-- Este script NO cambia a Eric Leon a R3.
-- Conserva su alcance actual DIVISION 1, que incluye R1-R5 y T-MEX.
-- Es transaccional y aborta si el preflight no coincide con lo auditado.

BEGIN;

-- ============================================================
-- A. PREFLIGHT
-- ============================================================
DO $$
DECLARE
  v_user_count integer;
  v_scope_count integer;
  v_bucket_count integer;
BEGIN
  SELECT count(*) INTO v_user_count
  FROM public.profiles
  WHERE lower(email) = 'eleon@prk.com.mx'
    AND role::text = 'regional';

  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT: se esperaba exactamente un Regional eleon@prk.com.mx y se encontraron %.', v_user_count;
  END IF;

  SELECT count(*) INTO v_scope_count
  FROM public.user_scopes us
  JOIN public.profiles p ON p.id = us.user_id
  JOIN public.divisions d ON d.id = us.division_id
  WHERE lower(p.email) = 'eleon@prk.com.mx'
    AND us.scope_type::text = 'division'
    AND d.name = 'DIVISION 1';

  IF v_scope_count <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT: eleon@prk.com.mx debe conservar exactamente un alcance DIVISION 1; coincidencias=%', v_scope_count;
  END IF;

  IF (SELECT count(*) FROM public.regions r
      JOIN public.divisions d ON d.id = r.division_id
      WHERE d.name = 'DIVISION 1'
        AND upper(trim(r.code)) IN ('R1','R2','R3','R4','R5','T-MEX')) <> 6 THEN
    RAISE EXCEPTION 'PREFLIGHT: DIVISION 1 ya no coincide con R1-R5 y T-MEX.';
  END IF;

  SELECT count(*) INTO v_bucket_count
  FROM storage.buckets
  WHERE id = 'parks-documentos';

  IF v_bucket_count <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT: no se encontró exactamente un bucket parks-documentos.';
  END IF;
END
$$;

-- ============================================================
-- B. NOTA SOBRE is_executive()
-- ============================================================
-- No se modifica private.is_executive() para evitar efectos colaterales
-- sobre otras policies no auditadas. Los roles nacionales se declaran
-- explícitamente dentro de las funciones de acceso de parque/región.

-- ============================================================
-- C. ACCESO A REGION
-- ============================================================
CREATE OR REPLACE FUNCTION private.can_access_region(target_region uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    -- Lectura nacional
    WHEN private.current_role()::text IN (
      'direccion','director','ceo','arquitecto','consulta','divisional'
    ) THEN true

    -- Regional: cualquier región que pertenezca a su División asignada
    WHEN private.current_role()::text = 'regional' THEN EXISTS (
      SELECT 1
      FROM public.regions r
      JOIN public.user_scopes us
        ON us.scope_type::text = 'division'
       AND us.division_id = r.division_id
      WHERE r.id = target_region
        AND us.user_id = (SELECT auth.uid())
    )

    -- Administrador: su Región; admite alcance parque legado/directo
    WHEN private.current_role()::text = 'administrador' THEN EXISTS (
      SELECT 1
      FROM public.user_scopes us
      WHERE us.user_id = (SELECT auth.uid())
        AND (
          (us.scope_type::text = 'region' AND us.region_id = target_region)
          OR
          (
            us.scope_type::text = 'parque'
            AND EXISTS (
              SELECT 1
              FROM public.parks p
              WHERE p.id = us.park_id
                AND p.region_id = target_region
            )
          )
        )
    )

    ELSE false
  END;
$function$;

-- ============================================================
-- D. ACCESO A PARQUE
-- ============================================================
CREATE OR REPLACE FUNCTION private.can_access_park(target_park uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    -- Lectura nacional
    WHEN private.current_role()::text IN (
      'direccion','director','ceo','arquitecto','consulta','divisional'
    ) THEN true

    -- Regional: parque dentro de cualquiera de las regiones de su División
    WHEN private.current_role()::text = 'regional' THEN EXISTS (
      SELECT 1
      FROM public.parks p
      JOIN public.regions r ON r.id = p.region_id
      JOIN public.user_scopes us
        ON us.scope_type::text = 'division'
       AND us.division_id = r.division_id
      WHERE p.id = target_park
        AND us.user_id = (SELECT auth.uid())
    )

    -- Administrador: su Región; se soporta alcance parque directo
    WHEN private.current_role()::text = 'administrador' THEN EXISTS (
      SELECT 1
      FROM public.parks p
      JOIN public.user_scopes us
        ON us.user_id = (SELECT auth.uid())
      WHERE p.id = target_park
        AND (
          (us.scope_type::text = 'region' AND us.region_id = p.region_id)
          OR
          (us.scope_type::text = 'parque' AND us.park_id = p.id)
        )
    )

    ELSE false
  END;
$function$;

-- ============================================================
-- E. ESCRITURA DOCUMENTAL
-- ============================================================
CREATE OR REPLACE FUNCTION private.can_write_park(target_park uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    -- Divisional puede cubrir cualquier División; Arquitecto nacional
    WHEN private.current_role()::text IN ('arquitecto','divisional') THEN true

    -- Regional escribe dentro de su División; Administrador dentro de su Región
    WHEN private.current_role()::text IN ('regional','administrador')
      THEN private.can_access_park(target_park)

    ELSE false
  END;
$function$;

-- ============================================================
-- F. STORAGE
-- ============================================================
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 52428800, -- 50 MB
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
WHERE id = 'parks-documentos';

-- Eliminar solamente la policy amplia que permitía leer todo el bucket
-- a cualquier usuario authenticated.
DROP POLICY IF EXISTS "parks_documentos_authenticated_read"
ON storage.objects;

-- Se conservan:
-- parks_docs_select -> private.can_access_park(...)
-- parks_docs_insert -> private.can_write_park(...)
-- parks_docs_update -> private.can_write_park(...)
-- parks_docs_delete -> private.is_architect()

COMMIT;

-- ============================================================
-- G. VERIFICACION POSTERIOR (SOLO LECTURA)
-- ============================================================

-- G1. Eric debe seguir como Regional / DIVISION 1
SELECT
  p.email,
  p.role::text AS role,
  us.scope_type,
  d.code AS division_code,
  d.name AS division,
  r.code AS region_code
FROM public.profiles p
LEFT JOIN public.user_scopes us ON us.user_id = p.id
LEFT JOIN public.divisions d ON d.id = us.division_id
LEFT JOIN public.regions r ON r.id = us.region_id
WHERE lower(p.email) = 'eleon@prk.com.mx';

-- G2. Las seis regiones de DIVISION 1
SELECT d.code AS division_code, r.code AS region_code, r.name AS region
FROM public.regions r
JOIN public.divisions d ON d.id = r.division_id
WHERE d.name = 'DIVISION 1'
ORDER BY r.code;

-- G3. Bucket
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'parks-documentos';

-- G4. Policies; parks_documentos_authenticated_read ya NO debe aparecer
SELECT policyname, cmd, roles, qual AS using_expression, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

-- G5. Funciones activas
SELECT p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname IN ('can_access_region','can_access_park','can_write_park')
ORDER BY p.proname;
