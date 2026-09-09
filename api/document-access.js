// PARKS ONE V7.4.1 · acceso documental auditado en servidor.
// Valida JWT + RLS, registra el acceso con document_id y entrega URL firmada de 15 min.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xmiushrjmlatrogfrsxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_fMFhhpXsDy4R723oWPBcbw_uTMIHivS';
const DOCUMENT_BUCKET = 'parks-documentos';
const SIGNED_URL_SECONDS = 900;

function jsonHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_) { return { raw: text }; }
}

async function supabaseGet(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: jsonHeaders(token)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${data?.message || data?.error || data?.raw || 'consulta rechazada'}`);
  return data;
}

async function supabaseInsert(path, token, row) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: jsonHeaders(token, { Prefer: 'return=minimal' }),
    body: JSON.stringify(row)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`Auditoría ${response.status}: ${data?.message || data?.error || data?.raw || 'registro rechazado'}`);
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function normalizeSignedUrl(value) {
  const signed = String(value || '');
  if (!signed) return '';
  if (/^https?:\/\//i.test(signed)) return signed;
  if (signed.startsWith('/storage/v1/')) return `${SUPABASE_URL}${signed}`;
  if (signed.startsWith('/object/')) return `${SUPABASE_URL}/storage/v1${signed}`;
  return `${SUPABASE_URL}/storage/v1/${signed.replace(/^\/+/, '')}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Sesión requerida' });
    const token = auth.slice(7).trim();

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    const user = await userResponse.json();

    const requestedPath = String(req.body?.storage_path || '').trim().replace(/^\/+/, '');
    const requestedAction = String(req.body?.action || 'view').toLowerCase();
    const action = requestedAction === 'download' ? 'DOCUMENT_DOWNLOADED' : 'DOCUMENT_VIEWED';
    if (!requestedPath) return res.status(400).json({ error: 'Ruta documental requerida' });

    // Esta consulta usa el JWT DEL USUARIO. documents_select aplica
    // private.can_access_park(park_id); si la ruta fue manipulada, no hay fila.
    const docSelect = encodeURIComponent(
      'id,park_id,title,original_filename,storage_bucket,storage_path,workflow_status'
    );
    const docs = await supabaseGet(
      `/rest/v1/documents?storage_path=eq.${encodeURIComponent(requestedPath)}&is_current=eq.true&select=${docSelect}&limit=1`,
      token
    );
    const document = docs?.[0];
    if (!document) return res.status(403).json({ error: 'Documento no autorizado o inexistente' });
    if (document.storage_bucket !== DOCUMENT_BUCKET || document.storage_path !== requestedPath) {
      return res.status(403).json({ error: 'Referencia documental no autorizada' });
    }

    const profileRows = await supabaseGet(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,role,is_active,full_name&limit=1`, token
    );
    const profile = profileRows?.[0];
    if (!profile?.is_active) return res.status(403).json({ error: 'Usuario inactivo' });

    const parkSelect = encodeURIComponent(
      'id,name,commercial_name,region_id,regions(id,code,division_id,divisions(id,code))'
    );
    const parkRows = await supabaseGet(
      `/rest/v1/parks?id=eq.${encodeURIComponent(document.park_id)}&select=${parkSelect}&limit=1`, token
    );
    const park = parkRows?.[0] || {};
    const region = park.regions || {};
    const division = region.divisions || {};

    const encodedPath = encodeStoragePath(document.storage_path);
    const signResponse = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(DOCUMENT_BUCKET)}/${encodedPath}`,
      {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS })
      }
    );
    const signData = await readJson(signResponse);
    if (!signResponse.ok) {
      return res.status(signResponse.status === 404 ? 404 : 403).json({
        error: signData?.message || signData?.error || 'No fue posible firmar el documento'
      });
    }

    let signedUrl = normalizeSignedUrl(signData.signedURL || signData.signedUrl || signData.signed_url);
    if (!signedUrl) return res.status(500).json({ error: 'Supabase no devolvió una URL firmada' });
    if (action === 'DOCUMENT_DOWNLOADED') {
      const separator = signedUrl.includes('?') ? '&' : '?';
      signedUrl += `${separator}download=${encodeURIComponent(document.original_filename || 'documento')}`;
    }

    // Fail closed: si la auditoría no puede escribirse, el enlace NO se entrega.
    await supabaseInsert('/rest/v1/audit_events', token, {
      actor_id: user.id,
      actor_name: profile.full_name || profile.email || user.email || 'Usuario',
      actor_email: profile.email || user.email || '',
      actor_role: profile.role || 'consulta',
      division_id: division.id || null,
      division_code: division.code || '',
      region_id: region.id || null,
      region_code: region.code || '',
      park_id: document.park_id || null,
      park_name: park.commercial_name || park.name || '',
      document_id: document.id,
      document_name: document.title || '',
      file_name: document.original_filename || '',
      category: 'document',
      action,
      result: 'success',
      message: action === 'DOCUMENT_DOWNLOADED' ? 'Descarga documental autorizada.' : 'Consulta documental autorizada.',
      before_data: null,
      after_data: null,
      metadata: {
        server_enforced: true,
        storage_path: document.storage_path,
        expires_in_seconds: SIGNED_URL_SECONDS,
        access_channel: 'api/document-access'
      }
    });

    return res.status(200).json({
      url: signedUrl,
      expires_in: SIGNED_URL_SECONDS,
      document_id: document.id
    });
  } catch (error) {
    console.error('PARKS ONE document-access:', error);
    return res.status(500).json({ error: 'No fue posible autorizar el acceso documental' });
  }
}
