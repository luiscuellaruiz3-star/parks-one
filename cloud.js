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

  async function mergeCloudData() {
    if (!session || !window.SIGOP_DATA) return;

    const allowedIds = await accessibleParkIds();
    let parkQuery = sb.from('parks').select('id,name,commercial_name,administrator_name,region_id,regions(code,name)').eq('status', 'activo');
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

    const staticByName = new Map((window.SIGOP_DATA.parks || []).map(p => [String(p.park).toUpperCase(), p]));
    const parkIdToStatic = new Map();

    for (const cloudPark of cloudParks || []) {
      const key = String(cloudPark.name || cloudPark.commercial_name || '').toUpperCase();
      const existing = staticByName.get(key);
      if (existing) {
        existing.cloud_id = cloudPark.id;
        existing.region = cloudPark.regions?.code || existing.region;
        existing.administrator = cloudPark.administrator_name || existing.administrator;
        parkIdToStatic.set(cloudPark.id, existing);
      }
    }

    if (Array.isArray(allowedIds)) {
      window.SIGOP_DATA.parks = (window.SIGOP_DATA.parks || []).filter(p => p.cloud_id && allowedIds.includes(p.cloud_id));
    }

    let docQuery = sb
      .from('documents')
      .select('id,park_id,title,status,workflow_status,issue_date,expiration_date,storage_path,original_filename,mime_type,file_size,requirement_id,requirements(code,name),updated_at')
      .eq('is_current', true);
    if (Array.isArray(allowedIds)) docQuery = docQuery.in('park_id', allowedIds);

    const { data: docs, error: docsError } = await docQuery;
    if (docsError) throw docsError;

    for (const document of docs || []) {
      const park = parkIdToStatic.get(document.park_id);
      if (!park) continue;
      park.files = park.files || [];
      if (park.files.some(file => file.cloud_id === document.id)) continue;
      park.files.push({
        cloud_id: document.id,
        filename: document.original_filename,
        document_type: document.requirements?.name || document.title,
        folder: document.requirements?.code || 'DOCUMENTOS',
        year: document.issue_date ? Number(String(document.issue_date).slice(0, 4)) : null,
        extension: (document.original_filename.split('.').pop() || '').toLowerCase(),
        local_url: document.storage_path,
        path: document.storage_path,
        park: park.park,
        region: park.region,
        status: document.status,
        workflow_status: document.workflow_status,
        expiry: document.expiration_date
      });
    }

    window.SIGOP_DATA.files = (window.SIGOP_DATA.parks || []).flatMap(p => p.files || []);
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
