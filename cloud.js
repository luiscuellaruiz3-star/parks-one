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
  let scope = {};
  const signedUrlCache = new Map();

  const roleMap = {
    direccion: 'executive',
    director: 'executive',
    ceo: 'executive',
    divisional: 'divisional',
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
    let clean = String(path || '').trim();
    try { clean = decodeURIComponent(clean); } catch (_) {}
    clean = clean
      .replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|public|authenticated)\//i, '')
      .replace(/^\/+/, '')
      .replace(/^\.\//, '')
      .replace(/^documents_repo\//i, '')
      .replace(/^documents\//i, '');
    const bucket = String(cfg.bucket || '').replace(/^\/+|\/+$/g, '');
    if (bucket && clean.toLowerCase().startsWith((bucket + '/').toLowerCase())) {
      clean = clean.slice(bucket.length + 1);
    }
    return clean;
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
    await loadAccessScope();
    await mergeCloudData();
    applyIdentity();
    document.documentElement.dataset.cloud = 'online';

    window.ParksAudit?.log?.('LOGIN', {
      category: 'security',
      message: 'Inicio de sesión correcto.'
    });

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

    // Rol verdadero proveniente de Supabase: nunca puede ser sustituido
    // por el selector visual.
    window.PARKS_REAL_ROLE = profile.role;
    window.PARKS_AUTH_ROLE = uiRole;

    const realIsArchitect =
      ['arquitecto', 'architect'].includes(
        String(profile.role || '').trim().toLowerCase()
      );

    try {
      if (!realIsArchitect) {
        localStorage.removeItem('parksOneRole');
        localStorage.removeItem('parksOneSimulatedRole');
        window.PARKS_SIMULATED_ROLE = '';
      }
    } catch (_) {}
  }


  async function loadAccessScope() {
    scope = {};
    if (!session) return scope;

    try {
      const { data, error } = await sb
        .from('user_scopes')
        .select(
          'scope_type,division_id,region_id,park_id,' +
          'divisions(id,code,name),regions(id,code,name),parks(id,code,name)'
        )
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('No fue posible cargar el alcance organizacional:', error);
        return scope;
      }

      scope = {
        scope_type: data?.scope_type || '',
        division_id: data?.division_id || data?.divisions?.id || null,
        division_code: data?.divisions?.code || '',
        division_name: data?.divisions?.name || '',
        region_id: data?.region_id || data?.regions?.id || null,
        region_code: data?.regions?.code || '',
        region_name: data?.regions?.name || '',
        park_id: data?.park_id || data?.parks?.id || null,
        park_code: data?.parks?.code || '',
        park_name: data?.parks?.name || ''
      };
    } catch (error) {
      console.warn('Alcance organizacional no disponible:', error);
    }

    return scope;
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

  function showLogin(initialView = 'login') {
    if (document.getElementById('cloudLogin')) return;

    const overlay = document.createElement('div');
    overlay.id = 'cloudLogin';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'background:linear-gradient(135deg,#033b30,#087a5a)',
      'display:grid',
      'place-items:center',
      'padding:20px',
      'font-family:Segoe UI,Arial,sans-serif',
      'overflow:auto'
    ].join(';');

    overlay.innerHTML = `
      <div style="width:min(470px,100%);background:white;border-radius:20px;padding:30px;box-shadow:0 25px 80px #0005">
        <img src="assets/parks_logo.png" alt="Parks" style="max-width:180px">
        <h2 id="cloudAuthTitle" style="color:#064c3d;margin:22px 0 6px">Acceso a PARKS ONE</h2>
        <p id="cloudAuthSubtitle" style="color:#61756f;margin:0 0 20px">Plataforma Integral de Operaciones</p>

        <form id="cloudLoginForm">
          <label style="display:block;font-weight:700;color:#234b41">Correo
            <input id="cloudEmail" type="email" autocomplete="username" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <label style="display:block;font-weight:700;color:#234b41">Contraseña
            <div style="position:relative">
              <input id="cloudPass" type="password" autocomplete="current-password" required
                style="box-sizing:border-box;width:100%;padding:12px 48px 12px 12px;margin:7px 0 16px;border:1px solid #ccd8d3;border-radius:9px">
              <button id="cloudTogglePass" type="button" aria-label="Mostrar contraseña"
                style="position:absolute;right:8px;top:15px;border:0;background:transparent;cursor:pointer;font-size:18px">👁</button>
            </div>
          </label>

          <label style="display:flex;align-items:center;gap:8px;color:#49645d;margin:-4px 0 16px">
            <input id="cloudRemember" type="checkbox" checked>
            Mantener la sesión iniciada
          </label>

          <button id="cloudLoginButton" type="submit"
            style="width:100%;padding:13px;border:0;border-radius:9px;background:#07845f;color:white;font-weight:800;cursor:pointer">
            Ingresar
          </button>

          <div style="display:flex;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
            <button id="cloudShowRegister" type="button"
              style="border:0;background:transparent;color:#087a5a;font-weight:800;cursor:pointer;padding:0">
              Solicitar acceso
            </button>
            <button id="cloudShowReset" type="button"
              style="border:0;background:transparent;color:#087a5a;font-weight:800;cursor:pointer;padding:0">
              Olvidé mi contraseña
            </button>
          </div>
        </form>

        <form id="cloudRegisterForm" hidden>
          <label style="display:block;font-weight:700;color:#234b41">Nombre completo
            <input id="cloudRegisterName" type="text" autocomplete="name" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <label style="display:block;font-weight:700;color:#234b41">Correo
            <input id="cloudRegisterEmail" type="email" autocomplete="email" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <label style="display:block;font-weight:700;color:#234b41">Contraseña
            <input id="cloudRegisterPass" type="password" autocomplete="new-password" minlength="8" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <label style="display:block;font-weight:700;color:#234b41">Confirmar contraseña
            <input id="cloudRegisterConfirm" type="password" autocomplete="new-password" minlength="8" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 16px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <button id="cloudRegisterButton" type="submit"
            style="width:100%;padding:13px;border:0;border-radius:9px;background:#07845f;color:white;font-weight:800;cursor:pointer">
            Enviar solicitud
          </button>

          <button class="cloudBackToLogin" type="button"
            style="width:100%;margin-top:12px;padding:10px;border:1px solid #ccd8d3;border-radius:9px;background:white;color:#234b41;font-weight:700;cursor:pointer">
            Volver a ingresar
          </button>
        </form>

        <form id="cloudResetForm" hidden>
          <label style="display:block;font-weight:700;color:#234b41">Correo registrado
            <input id="cloudResetEmail" type="email" autocomplete="email" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 16px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <button id="cloudResetButton" type="submit"
            style="width:100%;padding:13px;border:0;border-radius:9px;background:#07845f;color:white;font-weight:800;cursor:pointer">
            Enviar correo de restablecimiento
          </button>

          <button class="cloudBackToLogin" type="button"
            style="width:100%;margin-top:12px;padding:10px;border:1px solid #ccd8d3;border-radius:9px;background:white;color:#234b41;font-weight:700;cursor:pointer">
            Volver a ingresar
          </button>
        </form>

        <form id="cloudUpdatePasswordForm" hidden>
          <label style="display:block;font-weight:700;color:#234b41">Nueva contraseña
            <input id="cloudNewPassword" type="password" autocomplete="new-password" minlength="8" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 15px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <label style="display:block;font-weight:700;color:#234b41">Confirmar contraseña
            <input id="cloudNewPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required
              style="box-sizing:border-box;width:100%;padding:12px;margin:7px 0 16px;border:1px solid #ccd8d3;border-radius:9px">
          </label>

          <button id="cloudUpdatePasswordButton" type="submit"
            style="width:100%;padding:13px;border:0;border-radius:9px;background:#07845f;color:white;font-weight:800;cursor:pointer">
            Guardar nueva contraseña
          </button>
        </form>

        <div id="cloudLoginError" style="color:#a22;margin-top:14px;min-height:20px"></div>
        <div id="cloudLoginSuccess" style="color:#06724f;margin-top:8px;min-height:20px"></div>
      </div>`;

    document.body.appendChild(overlay);

    const loginForm = overlay.querySelector('#cloudLoginForm');
    const registerForm = overlay.querySelector('#cloudRegisterForm');
    const resetForm = overlay.querySelector('#cloudResetForm');
    const updatePasswordForm = overlay.querySelector('#cloudUpdatePasswordForm');
    const title = overlay.querySelector('#cloudAuthTitle');
    const subtitle = overlay.querySelector('#cloudAuthSubtitle');
    const errorNode = overlay.querySelector('#cloudLoginError');
    const successNode = overlay.querySelector('#cloudLoginSuccess');

    function clearMessages() {
      errorNode.textContent = '';
      successNode.textContent = '';
    }

    function setView(view) {
      clearMessages();
      loginForm.hidden = view !== 'login';
      registerForm.hidden = view !== 'register';
      resetForm.hidden = view !== 'reset';
      updatePasswordForm.hidden = view !== 'update-password';

      const copy = {
        login: ['Acceso a PARKS ONE', 'Plataforma Integral de Operaciones'],
        register: ['Solicitar acceso', 'Tu cuenta quedará pendiente hasta ser aprobada por el Arquitecto del Sistema.'],
        reset: ['Restablecer contraseña', 'Recibirás un enlace en el correo registrado.'],
        'update-password': ['Crear nueva contraseña', 'Define una contraseña nueva para tu cuenta.']
      };

      title.textContent = copy[view][0];
      subtitle.textContent = copy[view][1];
    }

    const recoveryMode =
      String(location.hash || '').includes('type=recovery') ||
      String(location.search || '').includes('type=recovery');

    setView(recoveryMode ? 'update-password' : initialView);

    overlay.querySelector('#cloudShowRegister').addEventListener('click', () => setView('register'));
    overlay.querySelector('#cloudShowReset').addEventListener('click', () => setView('reset'));
    overlay.querySelectorAll('.cloudBackToLogin').forEach(button => {
      button.addEventListener('click', () => setView('login'));
    });

    overlay.querySelector('#cloudTogglePass').addEventListener('click', () => {
      const input = overlay.querySelector('#cloudPass');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearMessages();

      const button = overlay.querySelector('#cloudLoginButton');
      button.disabled = true;
      button.textContent = 'Ingresando…';

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
        await loadAccessScope();

        if (!profile?.is_active) {
          throw new Error('Tu solicitud todavía está pendiente de aprobación.');
        }

        await mergeCloudData();
        location.reload();
      } catch (loadError) {
        errorNode.textContent = loadError.message;
        await sb.auth.signOut();
        button.disabled = false;
        button.textContent = 'Ingresar';
      }
    });

    registerForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearMessages();

      const name = overlay.querySelector('#cloudRegisterName').value.trim();
      const email = overlay.querySelector('#cloudRegisterEmail').value.trim();
      const password = overlay.querySelector('#cloudRegisterPass').value;
      const confirmation = overlay.querySelector('#cloudRegisterConfirm').value;
      const button = overlay.querySelector('#cloudRegisterButton');

      if (password !== confirmation) {
        errorNode.textContent = 'Las contraseñas no coinciden.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Enviando solicitud…';

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            requested_role: 'consulta',
            access_status: 'pendiente'
          }
        }
      });

      if (error) {
        errorNode.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Enviar solicitud';
        return;
      }

      /*
       * En la instalación normal, un trigger de Supabase crea el perfil.
       * Si la sesión queda abierta por configuración de Auth, se intenta
       * dejar explícitamente el perfil como pendiente y luego se cierra.
       */
      if (data?.user?.id && data?.session) {
        try {
          await sb.from('profiles').upsert({
            id: data.user.id,
            full_name: name,
            email,
            role: 'consulta',
            is_active: false
          }, { onConflict: 'id' });
        } catch (_) {}

        await sb.auth.signOut();
        session = null;
      }

      registerForm.reset();
      successNode.textContent =
        'Solicitud enviada. Tu cuenta permanecerá pendiente hasta que el Arquitecto del Sistema ' +
        'asigne tu rol y alcance. Al aprobarla, PARKS ONE habilitará también tu acceso de autenticación.';
      button.disabled = false;
      button.textContent = 'Enviar solicitud';
    });

    resetForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearMessages();

      const button = overlay.querySelector('#cloudResetButton');
      const email = overlay.querySelector('#cloudResetEmail').value.trim();

      button.disabled = true;
      button.textContent = 'Enviando…';

      const { error } = await sb.auth.resetPasswordForEmail(email);

      if (error) {
        errorNode.textContent = error.message;
      } else {
        successNode.textContent =
          'Correo enviado. Revisa también la carpeta de spam o correo no deseado.';
        resetForm.reset();
      }

      button.disabled = false;
      button.textContent = 'Enviar correo de restablecimiento';
    });

    updatePasswordForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearMessages();

      const password = overlay.querySelector('#cloudNewPassword').value;
      const confirmation = overlay.querySelector('#cloudNewPasswordConfirm').value;
      const button = overlay.querySelector('#cloudUpdatePasswordButton');

      if (password !== confirmation) {
        errorNode.textContent = 'Las contraseñas no coinciden.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Guardando…';

      const { error } = await sb.auth.updateUser({ password });

      if (error) {
        errorNode.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Guardar nueva contraseña';
        return;
      }

      successNode.textContent = 'Contraseña actualizada. Ya puedes ingresar.';
      await sb.auth.signOut();
      session = null;
      history.replaceState({}, document.title, location.pathname);
      setTimeout(() => setView('login'), 900);
      button.disabled = false;
      button.textContent = 'Guardar nueva contraseña';
    });
  }

  async function accessibleParkIds() {
    /*
     * PARKS ONE V8:
     * Todos los usuarios activos tienen lectura documental nacional.
     *
     * La región y la división permanecen como datos organizacionales y se
     * utilizarán para controlar acciones de aprobación, no para ocultar
     * parques ni documentos.
     */
    if (!session) return [];

    const permissions = window.ParksPermissions;
    if (permissions && !permissions.can('viewAll')) return [];

    return null;
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
        window.SIGOP_DATA.all_files = [];
        return;
      }
      parkQuery = parkQuery.in('id', allowedIds);
    }

    const { data: cloudParks, error: parksError } = await parkQuery;
    if (parksError) throw parksError;

    const staticParks = Array.isArray(window.SIGOP_DATA.parks)
      ? window.SIGOP_DATA.parks.map(park => ({ ...park }))
      : [];

    const exactStatic = new Map();
    for (const park of staticParks) {
      for (const candidate of [park.park, park.commercial_name, park.name, park.code]) {
        const normalized = normalizeName(candidate);
        if (normalized && !exactStatic.has(normalized)) exactStatic.set(normalized, park);
      }
    }

    const compact = value => normalizeName(value)
      .replace(/\b(PARQUE INDUSTRIAL|INDUSTRIAL PARK|PARQUE|PARK)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    function findStaticTemplate(cloudPark) {
      const candidates = [cloudPark.name, cloudPark.commercial_name, cloudPark.code]
        .map(normalizeName)
        .filter(Boolean);

      for (const candidate of candidates) {
        const direct = exactStatic.get(candidate);
        if (direct) return direct;
      }

      const compactCandidates = candidates.map(compact).filter(Boolean);
      for (const staticPark of staticParks) {
        const staticCandidates = [staticPark.park, staticPark.commercial_name, staticPark.name, staticPark.code]
          .map(compact)
          .filter(Boolean);
        if (compactCandidates.some(value => staticCandidates.includes(value))) return staticPark;
      }
      return null;
    }

    /*
     * Consolidación real de parques.
     *
     * La tabla parks contiene registros duplicados creados por importaciones
     * anteriores. Los documentos están ligados al UUID concreto que los recibió.
     * Esta lógica agrupa todos los UUID que representan el mismo parque y hace
     * que todos apunten a una sola ficha visual, sin perder ningún documento.
     */
    const authoritativeParks = [];
    const parkIdToUi = new Map();

    function identity(value) {
      return normalizeName(value)
        .replace(/\bREGION\s*(?:0?[1-9]|10|11)\b/g, ' ')
        .replace(/\bR\s*(?:0?[1-9]|10|11)\b/g, ' ')
        .replace(/\bDIVISION\s*(?:0?[1-9]|10|11)\b/g, ' ')
        .replace(/\bDOCUMENTOS?\b/g, ' ')
        .replace(/\bEXPEDIENTES?\b/g, ' ')
        .replace(/\bTOP\s*23\b/g, ' ')
        .replace(/\b(PARQUE INDUSTRIAL|INDUSTRIAL PARK|PARQUE|PARK)\b/g, ' ')
        .replace(/\bDE\b/g, ' ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function aliasesForCloud(cloudPark) {
      const values = [
        cloudPark.name,
        cloudPark.commercial_name,
        cloudPark.code
      ];

      const aliases = new Set();
      for (const value of values) {
        const normalized = normalizeName(value);
        const compacted = identity(value);
        if (normalized) aliases.add(normalized);
        if (compacted) aliases.add(compacted);

        // El importador puede guardar códigos como R1-AZCAPOPARK.
        const withoutPrefix = normalized
          .replace(/^(?:REGION\s*)?\d+\s+/, '')
          .replace(/^R\s*\d+\s+/, '')
          .trim();
        if (withoutPrefix) {
          aliases.add(withoutPrefix);
          const compactWithoutPrefix = identity(withoutPrefix);
          if (compactWithoutPrefix) aliases.add(compactWithoutPrefix);
        }
      }
      return aliases;
    }

    function aliasesForStatic(staticPark) {
      const aliases = new Set();
      for (const value of [
        staticPark?.park,
        staticPark?.commercial_name,
        staticPark?.name,
        staticPark?.code
      ]) {
        const normalized = normalizeName(value);
        const compacted = identity(value);
        if (normalized) aliases.add(normalized);
        if (compacted) aliases.add(compacted);
      }
      return aliases;
    }

    const cloudRows = (cloudParks || []).map((cloudPark, index) => ({
      cloudPark,
      index,
      aliases: aliasesForCloud(cloudPark),
      template: findStaticTemplate(cloudPark)
    }));

    // Union-Find para fusionar registros que comparten cualquier identidad.
    const parent = cloudRows.map((_, index) => index);
    const findRoot = index => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const unite = (left, right) => {
      const a = findRoot(left);
      const b = findRoot(right);
      if (a !== b) parent[b] = a;
    };

    const aliasOwner = new Map();
    const templateOwner = new Map();

    for (const row of cloudRows) {
      for (const alias of row.aliases) {
        if (!alias) continue;
        if (aliasOwner.has(alias)) unite(row.index, aliasOwner.get(alias));
        else aliasOwner.set(alias, row.index);
      }

      if (row.template) {
        const templateKey = identity(
          row.template.park ||
          row.template.commercial_name ||
          row.template.name ||
          row.template.code
        );
        if (templateKey) {
          if (templateOwner.has(templateKey)) {
            unite(row.index, templateOwner.get(templateKey));
          } else {
            templateOwner.set(templateKey, row.index);
          }
        }

        // También enlaza las identidades de la plantilla con el registro cloud.
        for (const alias of aliasesForStatic(row.template)) {
          if (!alias) continue;
          if (aliasOwner.has(alias)) unite(row.index, aliasOwner.get(alias));
          else aliasOwner.set(alias, row.index);
        }
      }
    }

    const groupedRows = new Map();
    for (const row of cloudRows) {
      const root = findRoot(row.index);
      if (!groupedRows.has(root)) groupedRows.set(root, []);
      groupedRows.get(root).push(row);
    }

    const diagnostics = [];

    for (const rows of groupedRows.values()) {
      const templateRow = rows.find(row => row.template);
      const template = templateRow?.template || null;

      // Prefiere como registro principal el que tiene nombre comercial más claro.
      const primaryRow =
        rows.find(row => row.cloudPark.commercial_name) ||
        rows.find(row => row.cloudPark.name) ||
        rows[0];
      const primary = primaryRow.cloudPark;

      const park = template ? { ...template } : {
        park: primary.commercial_name || primary.name,
        division: '',
        region: primary.regions?.code || '',
        administrator: primary.administrator_name || 'Por asignar',
        statuses: {},
        integrated: 0,
        pending: 0,
        na: 0,
        validating: 0,
        compliance: 0,
        risk: 'POR VALIDAR',
        audit: 'Por validar'
      };

      park.cloud_id = primary.id;
      park.cloud_ids = rows.map(row => row.cloudPark.id);
      park.code = primary.code || park.code || '';
      park.park =
        template?.park ||
        template?.commercial_name ||
        primary.commercial_name ||
        primary.name ||
        park.park;
      park.name =
        template?.name ||
        primary.name ||
        park.name ||
        park.park;
      park.commercial_name =
        template?.commercial_name ||
        primary.commercial_name ||
        park.commercial_name ||
        park.park;
      park.region =
        template?.region ||
        primary.regions?.code ||
        park.region ||
        '';
      park.region_name =
        primary.regions?.name ||
        park.region_name ||
        '';
      park.administrator =
        template?.administrator ||
        primary.administrator_name ||
        park.administrator ||
        'Por asignar';
      park.files = [];
      park.file_count = 0;

      authoritativeParks.push(park);

      // Cada UUID original apunta a la misma ficha consolidada.
      for (const row of rows) {
        parkIdToUi.set(row.cloudPark.id, park);
      }

      if (rows.length > 1) {
        diagnostics.push({
          park: park.park,
          ids: park.cloud_ids,
          names: rows.map(row =>
            row.cloudPark.commercial_name ||
            row.cloudPark.name ||
            row.cloudPark.code
          )
        });
      }
    }

    /*
     * Índice de rescate basado en el padrón original.
     *
     * El importador creó algunos documentos con park_id ligado a un registro
     * duplicado o incorrecto. Sin embargo, data.js conserva el parque y requisito
     * correctos de cada archivo. El nombre original del archivo es la llave más
     * estable para recuperar esa relación.
     */
    const authoritativeByIdentity = new Map();
    for (const park of authoritativeParks) {
      for (const value of [park.park, park.name, park.commercial_name, park.code]) {
        const key = identity(value);
        if (key) authoritativeByIdentity.set(key, park);
      }
    }

    function fileIdentity(value) {
      return normalizeName(value)
        .replace(/\.[A-Z0-9]{2,5}$/i, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const staticFileLookup = new Map();
    for (const staticPark of staticParks || []) {
      for (const file of staticPark.files || []) {
        const key = fileIdentity(file.filename);
        if (!key) continue;
        if (!staticFileLookup.has(key)) staticFileLookup.set(key, []);
        staticFileLookup.get(key).push({
          park: staticPark,
          file
        });
      }
    }

    function findStaticFile(document) {
      const filename = document.original_filename || document.title || '';
      const key = fileIdentity(filename);
      const candidates = staticFileLookup.get(key) || [];
      if (candidates.length === 1) return candidates[0];

      // En nombres repetidos, usa señales del título, requisito o ruta.
      const haystack = normalizeName([
        document.title,
        document.storage_path,
        document.requirements?.name,
        document.requirements?.code
      ].filter(Boolean).join(' '));

      return candidates.find(candidate => {
        const parkKey = identity(
          candidate.park.park ||
          candidate.park.commercial_name ||
          candidate.park.name
        );
        return parkKey && haystack.includes(parkKey);
      }) || candidates[0] || null;
    }

    function targetParkForDocument(document) {
      const rescued = findStaticFile(document);
      if (rescued) {
        const parkKey = identity(
          rescued.park.park ||
          rescued.park.commercial_name ||
          rescued.park.name ||
          rescued.park.code
        );
        const target = authoritativeByIdentity.get(parkKey);
        if (target) return { park: target, rescued };
      }

      return {
        park: parkIdToUi.get(document.park_id) || null,
        rescued: null
      };
    }

    let docQuery = sb
      .from('documents')
      .select('id,park_id,title,status,workflow_status,issue_date,expiration_date,storage_path,original_filename,mime_type,file_size,requirement_id,is_current,notes,requirements(requirement_number,code,name),updated_at');
    if (Array.isArray(allowedIds)) docQuery = docQuery.in('park_id', allowedIds);

    const { data: docs, error: docsError } = await docQuery;
    if (docsError) throw docsError;

    let rescuedByFilename = 0;
    let linkedByParkId = 0;
    let unlinkedDocuments = 0;

    for (const document of docs || []) {
      if (!document.storage_path) continue;

      const resolved = targetParkForDocument(document);
      const park = resolved.park;
      const rescued = resolved.rescued;

      if (!park) {
        unlinkedDocuments++;
        continue;
      }
      if (park.files.some(file => file.cloud_id === document.id)) continue;

      if (rescued) rescuedByFilename++;
      else linkedByParkId++;

      const originalFilename =
        document.original_filename ||
        rescued?.file?.filename ||
        document.title ||
        'documento';

      const staticFile = rescued?.file || null;
      const requirementNumber =
        staticFile?.document_number ??
        document.requirements?.requirement_number ??
        null;

      park.files.push({
        cloud_id: document.id,
        park_id: document.park_id,
        filename: originalFilename,
        document_type:
          staticFile?.document_type ||
          document.requirements?.name ||
          document.title ||
          'Documento',
        folder:
          staticFile?.folder ||
          document.requirements?.code ||
          'DOCUMENTOS',
        document_number: requirementNumber,
        requirement_id: document.requirement_id || null,
        year:
          staticFile?.year ??
          (document.issue_date ? Number(String(document.issue_date).slice(0, 4)) : null),
        extension:
          staticFile?.extension ||
          (originalFilename.split('.').pop() || '').toLowerCase(),
        local_url: document.storage_path,
        path: document.storage_path,
        storage_path: document.storage_path,
        park: park.park,
        region: park.region,
        status: document.status,
        workflow_status: document.workflow_status,
        document_scope: (
          String(document.notes || '').match(/PARKS_DOCUMENT_SCOPE=([^|]+)/i)?.[1] || ''
        ).trim().toUpperCase(),
        publication: (
          String(document.notes || '').match(/PARKS_PUBLICATION=([^|]+)/i)?.[1] || ''
        ).trim().toLowerCase(),
        permission_role: (
          String(document.notes || '').match(/PARKS_PERMISSION_ROLE=([^|]+)/i)?.[1] || ''
        ).trim().toLowerCase(),
        workflow_managed: /PARKS_PUBLICATION=/i.test(String(document.notes || '')),
        expiry: document.expiration_date,
        mime_type: document.mime_type,
        file_size: document.file_size,
        updated_at: document.updated_at,
        rescued_by_filename: Boolean(rescued)
      });
    }

    for (const park of authoritativeParks) {
      park.file_count = park.files.length;
    }

    const allFiles = authoritativeParks.flatMap(park => park.files);
    window.SIGOP_DATA.parks = authoritativeParks;
    window.SIGOP_DATA.files = allFiles;
    window.SIGOP_DATA.all_files = allFiles;

    if (window.SIGOP_DATA.metrics) {
      const metrics = window.SIGOP_DATA.metrics;
      metrics.parks = authoritativeParks.length;
      metrics.files = allFiles.length;
      metrics.physical_parks = authoritativeParks.filter(park => park.file_count > 0).length;
      metrics.administrators = new Set(authoritativeParks.map(park => park.administrator).filter(Boolean)).size;
    }

    window.PARKS_CLOUD_DIAGNOSTICS = {
      cloud_records: (cloudParks || []).length,
      consolidated_parks: authoritativeParks.length,
      documents: allFiles.length,
      duplicate_groups: diagnostics,
      rescued_by_filename: rescuedByFilename,
      linked_by_park_id: linkedByParkId,
      unlinked_documents: unlinkedDocuments
    };

    console.log(
      `PARKS ONE Cloud V7.3: ${(cloudParks || []).length} registros cloud → ` +
      `${authoritativeParks.length} parques consolidados, ` +
      `${allFiles.length} documentos vinculados.`
    );

    console.log(
      `Vinculación documental: ${rescuedByFilename} recuperados por nombre de archivo, ` +
      `${linkedByParkId} por park_id y ${unlinkedDocuments} sin relación.`
    );

    if (diagnostics.length) {
      console.table(diagnostics.map(item => ({
        parque: item.park,
        registros_fusionados: item.ids.length,
        nombres: item.names.join(' | ')
      })));
    }
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

    window.ParksAudit?.log?.(
      download ? 'DOCUMENT_DOWNLOADED' : 'DOCUMENT_VIEWED',
      {
        category: 'document',
        file_name: storagePath.split('/').pop() || '',
        result: 'success',
        metadata: { storage_path: storagePath }
      }
    );

    return data.signedUrl;
  }

  function permissionRole() {
    return String(profile?.role || 'consulta').trim().toLowerCase();
  }

  function can(action, context = {}) {
    if (!window.ParksPermissions) return true;
    return window.ParksPermissions.can(action, {
      ...context,
      role: permissionRole(),
      profile
    });
  }

  function uploadDecision(meta = {}) {
    if (!window.ParksPermissions) {
      return {
        allowed: true,
        publication: 'pending',
        approvalScope: 'none'
      };
    }

    return window.ParksPermissions.uploadDecision({
      role: permissionRole(),
      profile,
      documentRegion: meta.regionCode || meta.region || '',
      documentDivision: meta.divisionCode || meta.division || ''
    });
  }

  async function upload(file, meta) {
    if (!configured || !session) throw new Error('Se requiere una sesión activa.');
    if (!meta?.parkId) throw new Error('La carga requiere el UUID del parque.');

    if (!can('upload', { meta })) {
      throw new Error('Tu rol no tiene permiso para cargar documentos.');
    }

    const decision = uploadDecision(meta);
    if (!decision.allowed) {
      throw new Error(
        decision.reason || 'La carga no está permitida para este alcance.'
      );
    }

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
      // Regional, Divisional y Arquitecto publican directamente según
      // ParksPermissions.uploadDecision(). Administrador conserva revisión.
      status: decision.publication === 'direct' ? 'integrado' : 'por_validar',
      workflow_status: decision.publication === 'direct' ? 'aprobado' : 'en_revision',
      storage_bucket: cfg.bucket,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      notes: [
        meta.notes || '',
        `PARKS_PERMISSION_ROLE=${permissionRole()}`,
        `PARKS_PUBLICATION=${decision.publication}`,
        `PARKS_APPROVAL_SCOPE=${decision.approvalScope}`,
        `PARKS_DOCUMENT_SCOPE=${String(meta.documentScope || 'ADMINISTRADOR').toUpperCase()}`
      ].filter(Boolean).join(' | '),
      source: 'PARKS ONE',
      uploaded_by: session.user.id
    };

    const { data, error } = await sb.from('documents').insert(row).select().single();
    if (error) {
      await sb.storage.from(cfg.bucket).remove([storagePath]);
      throw error;
    }
    window.ParksAudit?.log?.('DOCUMENT_UPLOADED', {
      category: 'document',
      document_id: data?.id || null,
      document_name: row.title,
      file_name: row.original_filename,
      park_id: row.park_id,
      result: decision.publication === 'direct' ? 'success' : 'pending',
      message:
        decision.publication === 'direct'
          ? 'Documento cargado para publicación directa.'
          : 'Documento cargado y enviado a revisión.',
      after_data: data || row
    });

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
    await window.ParksAudit?.log?.('LOGOUT', {
      category: 'security',
      message: 'Cierre de sesión solicitado.'
    });

    if (sb) await sb.auth.signOut();
    location.reload();
  }

  window.ParksCloud = {
    configured,
    init,
    resolveUrl,
    upload,
    profile: () => profile,
    accessScope: () => scope,
    session: () => session,
    // Cliente Supabase ya inicializado. Lo usan los motores de datos
    // tabulares (Top 5, Agua/PTAR, histórico de datasets).
    client: () => sb,
    // Recarga parques + documentos desde Supabase sin cerrar sesión.
    refreshData: async () => {
      await mergeCloudData();
      return window.SIGOP_DATA;
    },
    signOut,
    normalizePath,
    importCatalogs,
    ensurePark,
    documentExists,
    can,
    uploadDecision,
    accessibleParkIds
  };
})();