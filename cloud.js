(function () {
  const cfg = window.PARKS_CONFIG || {};
  const configured = Boolean(
    cfg.supabaseUrl &&
    !String(cfg.supabaseUrl).startsWith('__') &&
    cfg.supabaseAnonKey &&
    !String(cfg.supabaseAnonKey).startsWith('__')
  );

  let sb = null;
  let session = null;
  let profile = { role: 'consulta', full_name: '', email: '' };
  const signedUrlCache = new Map();

  const roleMap = {
    direccion: 'executive',
    arquitecto: 'architect',
    regional: 'regional',
    administrador: 'administrator',
    consulta: 'executive'
  };

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }

  function normalizePath(path) {
    return String(path || '')
      .replace(/^\.\//, '')
      .replace(/^documents_repo\//, '')
      .replace(/^documents\//, '');
  }

  function showConfigurationNotice() {
    if (document.getElementById('parksConfigNotice')) return;
    const notice = document.createElement('div');
    notice.id = 'parksConfigNotice';
    notice.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#063f34;display:grid;place-items:center;padding:24px;font-family:Segoe UI,Arial,sans-serif';
    notice.innerHTML = `
      <div style="width:min(620px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 25px 80px #0005">
        <img src="assets/parks_logo.png" alt="Parks" style="max-width:180px;background:#fff">
        <h2 style="color:#064c3d;margin:20px 0 8px">Falta la Publishable key</h2>
        <p style="line-height:1.55;color:#49645d">La URL de Supabase ya está configurada. Abre <b>config.js</b> y sustituye <code>__PEGA_AQUI_LA_PUBLISHABLE_KEY__</code> por la llave que inicia con <code>sb_publishable_</code>.</p>
        <p style="line-height:1.55;color:#49645d"><b>No uses la Secret key.</b></p>
      </div>`;
    document.body.appendChild(notice);
  }

  async function init() {
    if (!configured) {
      document.documentElement.dataset.cloud = 'configuration-required';
      showConfigurationNotice();
      return { configured: false, authenticated: false };
    }

    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await sb.auth.getSession();
    if (error) console.error('No fue posible recuperar la sesión:', error);
    session = data?.session || null;

    if (!session) {
      showLogin();
      return { configured: true, authenticated: false };
    }

    await loadProfile();
    await mergeCloudData();
    applyIdentity();
    document.documentElement.dataset.cloud = 'online';
    return { configured: true, authenticated: true };
  }

  async function loadProfile() {
    const { data, error } = await sb
      .from('profiles')
      .select('id,full_name,email,role,is_active')
      .eq('id', session.user.id)
      .single();

    if (error) throw new Error('No se pudo cargar el perfil: ' + error.message);
    if (!data?.is_active) throw new Error('El usuario está inactivo.');
    profile = data;

    const uiRole = roleMap[profile.role] || 'executive';
    window.PARKS_AUTH_ROLE = uiRole;
    try { localStorage.setItem('parksOneRole', uiRole); } catch (_) {}
  }

  function applyIdentity() {
    const name = profile.full_name || session?.user?.email || 'Usuario';
    const nameNode = document.querySelector('.profile b');
    if (nameNode) nameNode.textContent = name;
    const roleNode = document.getElementById('roleText');
    if (roleNode) roleNode.textContent = profile.role || 'consulta';

    const profileBox = document.querySelector('.profile');
    if (profileBox && !document.getElementById('parksSignOut')) {
      const button = document.createElement('button');
      button.id = 'parksSignOut';
      button.type = 'button';
      button.textContent = 'Salir';
      button.className = 'btn secondary';
      button.style.padding = '8px 10px';
      button.addEventListener('click', signOut);
      profileBox.appendChild(button);
    }
  }

  function showLogin() {
    if (document.getElementById('cloudLogin')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cloudLogin';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#033b30,#087a5a);display:grid;place-items:center;padding:20px;font-family:Segoe UI,Arial,sans-serif';
    overlay.innerHTML = `
      <form id="cloudLoginForm" style="width:min(430px,100%);background:white;border-radius:20px;padding:30px;box-shadow:0 25px 80px #0005">
        <img src="assets/parks_logo.png" alt="Parks" style="max-width:180px">
        <h2 style="color:#064c3d;margin:22px 0 6px">Acceso a PARKS ONE</h2>
        <p style="color:#61756f;margin:0 0 20px">Plataforma Integral de Operaciones</p>
        <label style="display:block;font-weight:700;color:#234b41">Correo
          <input id="cloudEmail" type="email" autocomplete="username" required style="width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
        </label>
        <label style="display:block;font-weight:700;color:#234b41">Contraseña
          <input id="cloudPass" type="password" autocomplete="current-password" required style="width:100%;padding:12px;margin:7px 0 16px;border:1px solid #ccd8d3;border-radius:9px">
        </label>
        <button id="cloudLoginButton" type="submit" style="width:100%;padding:13px;border:0;border-radius:9px;background:#07845f;color:white;font-weight:800;cursor:pointer">Ingresar</button>
        <div id="cloudLoginError" style="color:#a22;margin-top:12px;min-height:20px"></div>
      </form>`;
    document.body.appendChild(overlay);

    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = overlay.querySelector('#cloudLoginButton');
      const errorNode = overlay.querySelector('#cloudLoginError');
      button.disabled = true;
      button.textContent = 'Ingresando…';
      errorNode.textContent = '';

      const { data, error } = await sb.auth.signInWithPassword({
        email: overlay.querySelector('#cloudEmail').value.trim(),
        password: overlay.querySelector('#cloudPass').value
      });

      if (error) {
        errorNode.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Ingresar';
        return;
      }

      try {
        session = data.session;
        await loadProfile();
        await mergeCloudData();
        location.reload();
      } catch (loadError) {
        errorNode.textContent = loadError.message;
        await sb.auth.signOut();
        button.disabled = false;
        button.textContent = 'Ingresar';
      }
    });
  }

  async function accessibleParkIds() {
    if (!session) return [];
    if (['direccion', 'arquitecto', 'consulta'].includes(profile.role)) return null;

    if (profile.role === 'regional') {
      const { data, error } = await sb
        .from('user_regions')
        .select('regions(parks(id))')
        .eq('user_id', session.user.id);
      if (error) throw error;
      return (data || []).flatMap(row => row.regions?.parks || []).map(p => p.id);
    }

    const { data, error } = await sb
      .from('user_parks')
      .select('park_id')
      .eq('user_id', session.user.id);
    if (error) throw error;
    return (data || []).map(row => row.park_id);
  }

  function compactParkName(value) {
    return normalizeName(value)
      .replace(/\b(REGION|R)\s*\d+\b/g, ' ')
      .replace(/\bPARQUE INDUSTRIAL\b/g, ' ')
      .replace(/\bINDUSTRIAL\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parkNameCandidates(cloudPark) {
    const candidates = [
      cloudPark?.name,
      cloudPark?.commercial_name,
      cloudPark?.code,
      String(cloudPark?.code || '').replace(/^R\d+[-_ ]*/i, '')
    ].filter(Boolean);
    return [...new Set(candidates.map(compactParkName).filter(Boolean))];
  }

  function parkSimilarity(a, b) {
    const left = compactParkName(a);
    const right = compactParkName(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.replace(/\s+/g, '') === right.replace(/\s+/g, '')) return 0.98;
    const la = new Set(left.split(' '));
    const rb = new Set(right.split(' '));
    const intersection = [...la].filter(token => rb.has(token)).length;
    const union = new Set([...la, ...rb]).size || 1;
    const jaccard = intersection / union;
    const contains = left.includes(right) || right.includes(left) ? 0.88 : 0;
    return Math.max(jaccard, contains);
  }

  function findStaticPark(cloudPark, staticParks, claimed) {
    const candidates = parkNameCandidates(cloudPark);

    for (const candidate of candidates) {
      const exact = staticParks.find(p => !claimed.has(p) && compactParkName(p.park) === candidate);
      if (exact) return exact;
    }

    let best = null;
    let bestScore = 0;
    for (const staticPark of staticParks) {
      if (claimed.has(staticPark)) continue;
      const score = Math.max(...candidates.map(candidate => parkSimilarity(candidate, staticPark.park)));
      if (score > bestScore) {
        best = staticPark;
        bestScore = score;
      }
    }
    return bestScore >= 0.72 ? best : null;
  }

  function createCloudParkModel(cloudPark) {
    return {
      park: cloudPark.commercial_name || cloudPark.name || 'Parque sin nombre',
      division: '',
      region: cloudPark.regions?.code || cloudPark.regions?.name || 'POR VALIDAR',
      administrator: cloudPark.administrator_name || 'Por validar',
      integrated: 0,
      pending: 0,
      na: 0,
      validating: 0,
      compliance: 0,
      risk: 'MEDIO',
      file_count: 0,
      files: [],
      statuses: {},
      audit: 'Por validar',
      cloud_only: true
    };
  }

  async function mergeCloudData() {
    if (!session || !window.SIGOP_DATA) return;

    const allowedIds = await accessibleParkIds();
    let parkQuery = sb
      .from('parks')
      .select('id,code,name,commercial_name,administrator_name,region_id,regions(code,name)')
      .eq('status', 'activo');

    if (Array.isArray(allowedIds)) {
      if (!allowedIds.length) {
        window.SIGOP_DATA.parks = [];
        window.SIGOP_DATA.files = [];
        return;
      }
      parkQuery = parkQuery.in('id', allowedIds);
    }

    const { data: cloudParks, error: parksError } = await parkQuery;
    if (parksError) throw parksError;

    const staticParks = [...(window.SIGOP_DATA.parks || [])];
    const claimedStaticParks = new Set();
    const parkIdToModel = new Map();
    const mergedParks = [];

    for (const cloudPark of cloudParks || []) {
      let model = findStaticPark(cloudPark, staticParks, claimedStaticParks);
      if (model) claimedStaticParks.add(model);
      else model = createCloudParkModel(cloudPark);

      model.cloud_id = cloudPark.id;
      model.cloud_code = cloudPark.code || null;
      model.park = model.park || cloudPark.commercial_name || cloudPark.name;
      model.region = cloudPark.regions?.code || cloudPark.regions?.name || model.region;
      model.administrator = cloudPark.administrator_name || model.administrator || 'Por validar';
      model.files = [];
      model.file_count = 0;

      parkIdToModel.set(cloudPark.id, model);
      mergedParks.push(model);
    }

    window.SIGOP_DATA.parks = mergedParks;

    let docQuery = sb
      .from('documents')
      .select('id,park_id,title,status,workflow_status,issue_date,expiration_date,storage_bucket,storage_path,original_filename,mime_type,file_size,requirement_id,requirements(requirement_number,code,name),updated_at')
      .eq('is_current', true);
    if (Array.isArray(allowedIds)) docQuery = docQuery.in('park_id', allowedIds);

    const { data: docs, error: docsError } = await docQuery;
    if (docsError) throw docsError;

    for (const document of docs || []) {
      const park = parkIdToModel.get(document.park_id);
      if (!park) continue;
      park.files = park.files || [];
      if (park.files.some(file => file.cloud_id === document.id)) continue;

      const originalFilename = document.original_filename || document.title || 'documento';
      park.files.push({
        cloud_id: document.id,
        filename: originalFilename,
        document_type: document.requirements?.name || document.title || 'Documento',
        folder: document.requirements?.code || 'DOCUMENTOS',
        document_number: document.requirements?.requirement_number || null,
        requirement_id: document.requirement_id || null,
        year: document.issue_date ? Number(String(document.issue_date).slice(0, 4)) : null,
        extension: (originalFilename.split('.').pop() || '').toLowerCase(),
        local_url: document.storage_path,
        path: document.storage_path,
        storage_path: document.storage_path,
        storage_bucket: document.storage_bucket || cfg.bucket,
        park: park.park,
        region: park.region,
        status: document.status,
        workflow_status: document.workflow_status,
        expiry: document.expiration_date,
        file_size: document.file_size,
        mime_type: document.mime_type,
        updated_at: document.updated_at
      });
    }

    for (const park of window.SIGOP_DATA.parks || []) {
      park.file_count = (park.files || []).length;

      // Para parques creados únicamente desde Supabase, construye un Top 23 mínimo
      // usando los documentos realmente existentes.
      if (park.cloud_only) {
        const grouped = new Map();
        for (const file of park.files || []) {
          const number = Number(file.document_number || 0);
          const label = `${number || ''}${number ? '. ' : ''}${file.document_type || 'Documento'}`;
          grouped.set(label, '✅');
        }
        park.statuses = Object.fromEntries(grouped);
        park.integrated = grouped.size;
        park.pending = 0;
        park.na = 0;
        park.validating = 0;
        park.compliance = grouped.size ? 1 : 0;
      }
    }

    window.SIGOP_DATA.files = (window.SIGOP_DATA.parks || []).flatMap(p => p.files || []);
    window.SIGOP_DATA.all_files = window.SIGOP_DATA.files;

    console.info(
      `PARKS ONE Cloud V6: ${window.SIGOP_DATA.parks.length} parques y ${window.SIGOP_DATA.files.length} documentos vinculados.`
    );
  }

  async function resolveUrl(path, download = false) {
    if (!path) return '';
    if (/^data:|^blob:|^https?:/i.test(path)) return path;
    if (!configured) throw new Error('Supabase no está configurado.');
    if (!session) {
      const { data } = await sb.auth.getSession();
      session = data?.session || null;
      if (!session) {
        showLogin();
        throw new Error('Sesión requerida.');
      }
    }

    const storagePath = normalizePath(path);
    const cacheKey = `${download ? 'download' : 'preview'}:${storagePath}`;
    if (signedUrlCache.has(cacheKey)) return signedUrlCache.get(cacheKey);

    const { data, error } = await sb.storage
      .from(cfg.bucket)
      .createSignedUrl(storagePath, 900, { download: download ? storagePath.split('/').pop() : false });
    if (error) throw error;

    signedUrlCache.set(cacheKey, data.signedUrl);
    setTimeout(() => signedUrlCache.delete(cacheKey), 12 * 60 * 1000);
    return data.signedUrl;
  }

  async function upload(file, meta) {
    if (!configured || !session) throw new Error('Se requiere una sesión activa.');
    if (!meta?.parkId) throw new Error('La carga requiere el UUID del parque.');

    const safe = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_');

    const requirementCode = safe(meta.requirementCode || 'OTROS');
    const storagePath = [meta.parkId, requirementCode, `${Date.now()}_${safe(file.name)}`].join('/');

    const { error: uploadError } = await sb.storage
      .from(cfg.bucket)
      .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (uploadError) throw uploadError;

    const row = {
      park_id: meta.parkId,
      requirement_id: meta.requirementId || null,
      title: meta.title || meta.requirementName || file.name,
      issue_date: meta.issueDate || null,
      expiration_date: meta.expirationDate || null,
      status: 'por_validar',
      workflow_status: 'en_revision',
      storage_bucket: cfg.bucket,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      notes: meta.notes || null,
      source: 'PARKS ONE',
      uploaded_by: session.user.id
    };

    const { data, error } = await sb.from('documents').insert(row).select().single();
    if (error) {
      await sb.storage.from(cfg.bucket).remove([storagePath]);
      throw error;
    }
    return data;
  }


  async function importCatalogs() {
    if (!session) throw new Error('Se requiere una sesión activa.');
    const [regionsRes, parksRes, reqRes] = await Promise.all([
      sb.from('regions').select('id,code,name').eq('is_active', true).order('sort_order'),
      sb.from('parks').select('id,name,region_id,regions(code,name)').eq('status','activo'),
      sb.from('requirements').select('id,requirement_number,code,name').eq('is_active', true).order('sort_order')
    ]);
    if (regionsRes.error) throw regionsRes.error;
    if (parksRes.error) throw parksRes.error;
    if (reqRes.error) throw reqRes.error;
    return { regions: regionsRes.data || [], parks: parksRes.data || [], requirements: reqRes.data || [] };
  }

  async function ensurePark({ name, regionId, regionCode }) {
    if (!session) throw new Error('Se requiere una sesión activa.');
    const cleanName = String(name || '').trim();
    const { data: found, error: findError } = await sb.from('parks')
      .select('id,name,region_id').eq('region_id', regionId).ilike('name', cleanName).maybeSingle();
    if (findError) throw findError;
    if (found) return found;
    const code = `${String(regionCode || 'P').replace(/[^A-Za-z0-9]/g,'')}-${cleanName}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').slice(0,80);
    const { data, error } = await sb.from('parks').insert({ region_id: regionId, name: cleanName, commercial_name: cleanName, code, status: 'activo' }).select('id,name,region_id').single();
    if (error) throw error;
    return data;
  }

  async function documentExists(parkId, filename, requirementId) {
    let query = sb.from('documents').select('id').eq('park_id', parkId).eq('original_filename', filename).eq('is_current', true).limit(1);
    if (requirementId) query = query.eq('requirement_id', requirementId);
    const { data, error } = await query;
    if (error) throw error;
    return Boolean(data && data.length);
  }

  async function signOut() {
    if (sb) await sb.auth.signOut();
    location.reload();
  }

  window.ParksCloud = {
    configured,
    init,
    resolveUrl,
    upload,
    profile: () => profile,
    session: () => session,
    signOut,
    normalizePath,
    importCatalogs,
    ensurePark,
    documentExists
  };
})();