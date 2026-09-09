// PARKS ONE 7.4.0 · Bootstrap institucional protegido.
// No contiene parques, administradores, Top 23, hidráulica ni Top 5 incrustados.
// Toda información operativa se consulta en Supabase DESPUÉS de validar JWT y RLS.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xmiushrjmlatrogfrsxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_fMFhhpXsDy4R723oWPBcbw_uTMIHivS';

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function statusBucket(value) {
  const v = norm(value);
  if (v === 'N A' || v === 'NA') return 'na';
  if (String(value || '').includes('✅')) return 'ok';
  if (String(value || '').includes('❌')) return 'pending';
  if (v.includes('VALIDAR') || v.includes('DEFINIR')) return 'validating';
  return 'other';
}

function buildComputed(parks) {
  const req = new Map();
  let integrated = 0;
  let pending = 0;
  let na = 0;
  let validating = 0;

  for (const park of parks) {
    for (const [name, value] of Object.entries(park.statuses || {})) {
      if (!req.has(name)) req.set(name, {document:name, integrated:0,pending:0,na:0,validating:0});
      const row = req.get(name);
      const bucket = statusBucket(value);
      if (bucket === 'ok') { row.integrated++; integrated++; }
      else if (bucket === 'pending') { row.pending++; pending++; }
      else if (bucket === 'na') { row.na++; na++; }
      else if (bucket === 'validating') { row.validating++; validating++; }
    }
  }

  const documents = [...req.values()].map(row => {
    row.applicable = row.integrated + row.pending + row.validating;
    row.compliance = row.applicable ? row.integrated / row.applicable : 0;
    return row;
  });

  const byRegion = new Map();
  for (const park of parks) {
    const code = park.region || 'SIN REGION';
    if (!byRegion.has(code)) byRegion.set(code, {region:code,parks:0,integrated:0,applicable:0,critical:0});
    const r = byRegion.get(code);
    r.parks++;
    if (norm(park.risk).includes('CRITICO')) r.critical++;
    for (const value of Object.values(park.statuses || {})) {
      const b = statusBucket(value);
      if (b === 'ok') { r.integrated++; r.applicable++; }
      else if (b === 'pending' || b === 'validating') r.applicable++;
    }
  }
  const regions = [...byRegion.values()].map(r => ({...r, compliance:r.applicable ? r.integrated/r.applicable : 0}));

  const files = parks.flatMap(p => (p.files || []).map(f => ({...f, park:f.park || p.park, region:f.region || p.region})));
  const administrators = new Set(parks.map(p => p.administrator).filter(Boolean));
  const evaluated = integrated + pending + validating;
  const metrics = {
    parks: parks.length,
    evaluated,
    integrated,
    pending,
    compliance: evaluated ? integrated/evaluated : 0,
    audited: parks.filter(p => norm(p.audit) === 'SI').length,
    na_confirmed: na,
    files: files.length,
    administrators: administrators.size,
    physical_parks: parks.filter(p => (p.files || []).length > 0).length,
    critical_parks: parks.filter(p => norm(p.risk).includes('CRITICO')).length,
    high_parks: parks.filter(p => norm(p.risk).includes('ALTO')).length,
    ptar_yes: parks.filter(p => /^SI\b/.test(norm(p.ptar || p.hydrica?.ptar))).length,
    hydrica_records: parks.filter(p => p.hydrica && Object.keys(p.hydrica).length).length,
    hydrica_matched: parks.filter(p => p.hydrica && Object.keys(p.hydrica).length).length
  };

  return {documents, regions, files, metrics};
}

function deriveTop5Months(admins, explicitMonths) {
  if (explicitMonths?.length) return explicitMonths;
  const groups = new Map();
  for (const row of admins || []) {
    const year = Number(row.year || 2026);
    const month = row.month || '';
    const key = `${year}:${month}`;
    if (!groups.has(key)) groups.set(key, {month,year,records:0,expected:0,administrators:new Set(),regions:new Set()});
    const g = groups.get(key);
    g.records += Number(row.records || 0);
    g.expected += Number(row.expected || 0);
    if (row.administrator) g.administrators.add(norm(row.administrator));
    if (row.region) g.regions.add(norm(row.region));
  }
  return [...groups.values()].map(g => ({
    month:g.month,
    year:g.year,
    records:g.records,
    expected:g.expected,
    compliance:g.expected ? g.records/g.expected : 0,
    administrators:g.administrators.size,
    regions:g.regions.size,
    scoped:true
  }));
}

function maxDate(rows, types) {
  const allowed = new Set(Array.isArray(types) ? types : [types]);
  return (rows || [])
    .filter(r => allowed.has(r.dataset_type))
    .map(r => r.source_updated_at || r.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function sourceFile(rows, types) {
  const allowed = new Set(Array.isArray(types) ? types : [types]);
  return (rows || []).find(r => allowed.has(r.dataset_type) && r.source_filename)?.source_filename || null;
}

async function supabaseGet(path, token, extraHeaders = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...extraHeaders
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text.slice(0,300)}`);
  }
  return response.json();
}

async function supabaseGetAll(path, token, pageSize = 1000) {
  const all = [];
  for (let start = 0; ; start += pageSize) {
    const rows = await supabaseGet(path, token, {Range:`${start}-${start + pageSize - 1}`});
    all.push(...(rows || []));
    if (!rows || rows.length < pageSize) break;
    if (start > 20000) throw new Error('La fuente operativa excede el límite de seguridad previsto.');
  }
  return all;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error:'Método no permitido'});
  }

  try {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) return res.status(401).json({error:'Sesión requerida'});
    const token = auth.slice(7).trim();

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${token}`}
    });
    if (!userResponse.ok) return res.status(401).json({error:'Sesión inválida o expirada'});
    const user = await userResponse.json();

    const profileRows = await supabaseGet(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,role,is_active,full_name`, token
    );
    const profile = profileRows?.[0];
    if (!profile?.is_active) return res.status(403).json({error:'Usuario inactivo'});

    // El catálogo parks también está protegido por RLS. Si el usuario no tiene
    // scope verificable, esta consulta devuelve cero y NO se amplía el acceso.
    const parkSelect = encodeURIComponent(
      'id,code,name,commercial_name,administrator_name,region_id,regions(id,code,name,division_id,divisions(id,code,name))'
    );
    const cloudParks = await supabaseGet(
      `/rest/v1/parks?select=${parkSelect}&status=in.(activo,construccion,adquirido)`, token
    );
    const cloudById = new Map((cloudParks || []).map(p => [String(p.id), p]));

    const recordSelect = encodeURIComponent(
      'dataset_type,record_key,park_id,region_id,division_id,payload,source_filename,source_updated_at,loaded_by,updated_at'
    );
    const records = await supabaseGetAll(
      `/rest/v1/operational_records?select=${recordSelect}&order=dataset_type.asc,record_key.asc`, token
    );

    // Fail closed: un usuario con parques visibles no recibe una aplicación vacía
    // si la fuente protegida no fue migrada correctamente.
    const sigopRows = records.filter(r => r.dataset_type === 'sigop_park');
    if ((cloudParks || []).length && !sigopRows.length) {
      return res.status(503).json({error:'La fuente operativa protegida aún no está inicializada para tu alcance.'});
    }

    const parks = sigopRows
      .map(row => {
        const cloud = cloudById.get(String(row.park_id));
        if (!cloud) return null; // RLS/catalogo es autoridad; no revive un parque inexistente.
        const base = row.payload && typeof row.payload === 'object' ? row.payload : {};
        return {
          ...base,
          cloud_id: cloud.id,
          code: cloud.code || base.code || '',
          name: cloud.name || base.name || base.park || '',
          commercial_name: cloud.commercial_name || base.commercial_name || base.park || cloud.name || '',
          park: cloud.commercial_name || cloud.name || base.park || '',
          region: cloud.regions?.code || base.region || '',
          region_name: cloud.regions?.name || base.region_name || '',
          division: cloud.regions?.divisions?.name || cloud.regions?.divisions?.code || base.division || '',
          administrator: cloud.administrator_name || base.administrator || 'Por asignar',
          files: [],
          file_count: 0
        };
      })
      .filter(Boolean);

    const hydRows = records.filter(r => r.dataset_type === 'hydrica').map(r => r.payload);
    const hydByPark = new Map(records.filter(r => r.dataset_type === 'hydrica' && r.park_id).map(r => [String(r.park_id), r.payload]));
    for (const park of parks) {
      const hyd = hydByPark.get(String(park.cloud_id));
      if (hyd?.hydrica) park.hydrica = hyd.hydrica;
    }

    const computed = buildComputed(parks);
    const alerts = records.filter(r => r.dataset_type === 'sigop_alert').map(r => r.payload);
    const annualRows = records.filter(r => r.dataset_type === 'annual').map(r => r.payload);

    const top5Records = records.filter(r => r.dataset_type === 'top5_record').map(r => r.payload);
    const top5Admins = records.filter(r => r.dataset_type === 'top5_admin').map(r => r.payload);
    const top5Regions = records.filter(r => r.dataset_type === 'top5_region').map(r => r.payload);
    const explicitMonths = records.filter(r => r.dataset_type === 'top5_month').map(r => r.payload);
    const top5Months = deriveTop5Months(top5Admins, explicitMonths);

    const officialRegions = {};
    for (const row of records.filter(r => r.dataset_type === 'top5_official_region')) {
      const p = row.payload || {};
      if (!p.month || !p.region) continue;
      officialRegions[p.month] ||= {};
      officialRegions[p.month][p.region] = p.value;
    }
    const officialMonths = {};
    for (const row of records.filter(r => r.dataset_type === 'top5_official_month')) {
      const p = row.payload || {};
      if (p.month) officialMonths[p.month] = p.value;
    }
    const executiveClose = records.find(r => r.dataset_type === 'top5_executive_close')?.payload || {};

    const latestDocumentRows = await supabaseGet(
      '/rest/v1/documents?select=id,updated_at,uploaded_by&order=updated_at.desc&limit=1', token
    ).catch(() => []);
    const latestDocument = latestDocumentRows?.[0] || null;

    const actorIds = [...new Set([
      ...records.map(r => r.loaded_by),
      latestDocument?.uploaded_by
    ].filter(Boolean))].slice(0,100);
    let actorRows = [];
    if (actorIds.length) {
      const ids = actorIds.map(id => encodeURIComponent(id)).join(',');
      actorRows = await supabaseGet(`/rest/v1/profiles?id=in.(${ids})&select=id,full_name`, token).catch(() => []);
    }
    const actorMap = new Map((actorRows || []).map(row => [String(row.id), row.full_name || '']));
    const responsibleFor = types => {
      const allowed = new Set(Array.isArray(types) ? types : [types]);
      const row = records
        .filter(r => allowed.has(r.dataset_type) && r.loaded_by)
        .sort((a,b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
      return row?.loaded_by ? (actorMap.get(String(row.loaded_by)) || `Usuario ${String(row.loaded_by).slice(0,8)}…`) : 'No registrado';
    };

    const sigopUpdated = maxDate(records,['sigop_park','sigop_alert']);
    const top5Updated = maxDate(records,['top5_record','top5_admin','top5_region','top5_month']);
    const hydricaUpdated = maxDate(records,['hydrica']);
    const annualUpdated = maxDate(records,['annual']);

    const rejectedCounts = {};
    for (const row of records.filter(r => /_unmatched$/.test(r.dataset_type))) {
      rejectedCounts[row.dataset_type] = (rejectedCounts[row.dataset_type] || 0) + 1;
    }

    return res.status(200).json({
      sigop: {
        generated: sigopUpdated,
        version: '7.4.0-supabase-only',
        metrics: computed.metrics,
        parks,
        documents: computed.documents,
        regions: computed.regions,
        alerts,
        all_files: computed.files,
        hydrica_updated: hydricaUpdated,
        hydrica_source: sourceFile(records,'hydrica') || 'Supabase operational_records'
      },
      top5: {
        months: top5Months,
        records: top5Records,
        admins: top5Admins,
        regions: top5Regions,
        executiveClose,
        officialMonths,
        officialRegions
      },
      hydrica: {
        source: sourceFile(records,'hydrica') || 'Supabase operational_records',
        sheet: 'Matriz Hídrica',
        records: hydRows.length,
        rows: hydRows
      },
      annual: {
        year: 2026,
        source: sourceFile(records,'annual') || 'Supabase operational_records',
        generated_from: sourceFile(records,'annual') || 'Carga protegida',
        rows: annualRows
      },
      meta: {
        version: '7.4.0',
        environment: process.env.VERCEL_ENV || 'unknown',
        generated_at: new Date().toISOString(),
        role: String(profile.role || 'consulta').toLowerCase(),
        scoped: !['arquitecto','divisional','direccion','director','ceo','consulta'].includes(String(profile.role || '').toLowerCase()),
        visible_parks: parks.length,
        rejected_records: rejectedCounts,
        source_model: 'supabase-operational-records',
        traceability: {
          sigop: {
            source: 'Supabase public.operational_records · sigop_park',
            updated_at: sigopUpdated,
            source_file: sourceFile(records,'sigop_park'),
            process: 'JWT → RLS → park_id/region_id/division_id → cálculo de indicadores',
            responsible: responsibleFor('sigop_park')
          },
          documents: {
            source: 'Supabase public.documents + Storage privado',
            updated_at: latestDocument?.updated_at || null,
            source_file: 'Carga documental autenticada',
            process: 'RLS + Storage privado + flujo servidor',
            responsible: latestDocument?.uploaded_by ? (actorMap.get(String(latestDocument.uploaded_by)) || `Usuario ${String(latestDocument.uploaded_by).slice(0,8)}…`) : 'No registrado'
          },
          top5: {
            source: 'Supabase public.operational_records · top5_*',
            updated_at: top5Updated,
            source_file: sourceFile(records,['top5_record','top5_admin']),
            process: 'Fuente protegida → registros por parque/región → RLS → consolidación visible',
            responsible: responsibleFor(['top5_record','top5_admin'])
          },
          hydrica: {
            source: 'Supabase public.operational_records · hydrica',
            updated_at: hydricaUpdated,
            source_file: sourceFile(records,'hydrica'),
            process: 'Matriz hídrica → homologación con park_id → RLS → KPI visible',
            responsible: responsibleFor('hydrica')
          },
          annual: {
            source: 'Supabase public.operational_records · annual',
            updated_at: annualUpdated,
            source_file: sourceFile(records,'annual'),
            process: 'Carga anual → homologación con park_id → RLS',
            responsible: responsibleFor('annual')
          },
          alerts: {
            source: 'Supabase public.operational_records · sigop_alert + motor interno',
            updated_at: maxDate(records,'sigop_alert'),
            source_file: sourceFile(records,'sigop_alert'),
            process: 'Reglas de alerta sobre información autorizada',
            responsible: responsibleFor('sigop_alert')
          },
          session: {
            source: 'Supabase Auth + RLS',
            updated_at: new Date().toISOString(),
            source_file: '/api/bootstrap',
            process: 'JWT validado antes de cualquier consulta operativa',
            responsible: profile.full_name || profile.email || user.email || 'Usuario autenticado'
          }
        }
      }
    });
  } catch (error) {
    console.error('PARKS ONE bootstrap:', error);
    return res.status(500).json({error:'No fue posible preparar la información autorizada.'});
  }
}
