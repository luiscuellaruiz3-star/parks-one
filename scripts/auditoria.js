(function () {
  'use strict';

  const state = {
    client: null,
    events: [],
    initialized: false
  };

  function client() {
    if (state.client) return state.client;

    const cfg = window.PARKS_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase?.createClient) {
      throw new Error('Supabase no está disponible para la auditoría.');
    }

    state.client = window.supabase.createClient(
      cfg.supabaseUrl,
      cfg.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    return state.client;
  }

  function profile() {
    return typeof window.ParksCloud?.profile === 'function'
      ? window.ParksCloud.profile() || {}
      : {};
  }

  function accessScope() {
    return typeof window.ParksCloud?.accessScope === 'function'
      ? window.ParksCloud.accessScope() || {}
      : {};
  }

  function currentRole() {
    return window.ParksPermissions?.realRole?.() ||
      profile().role ||
      'consulta';
  }

  function browserInfo() {
    return {
      user_agent: navigator.userAgent || '',
      language: navigator.language || '',
      platform: navigator.platform || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      page: location.pathname,
      origin: location.origin
    };
  }

  async function log(action, details = {}) {
    try {
      const sb = client();
      const { data: sessionData } = await sb.auth.getSession();
      const session = sessionData?.session;
      if (!session?.user?.id) return null;

      const p = profile();
      const s = accessScope();

      const row = {
        actor_id: session.user.id,
        actor_name: p.full_name || session.user.email || 'Usuario',
        actor_email: p.email || session.user.email || '',
        actor_role: currentRole(),
        division_id: details.division_id || s.division_id || null,
        division_code: details.division_code || s.division_code || '',
        region_id: details.region_id || s.region_id || null,
        region_code: details.region_code || s.region_code || '',
        park_id: details.park_id || null,
        park_name: details.park_name || '',
        document_id: details.document_id || null,
        document_name: details.document_name || '',
        file_name: details.file_name || '',
        category: details.category || 'system',
        action,
        result: details.result || 'success',
        message: details.message || '',
        before_data: details.before_data || null,
        after_data: details.after_data || null,
        metadata: {
          ...(details.metadata || {}),
          ...browserInfo()
        }
      };

      const { data, error } = await sb
        .from('audit_events')
        .insert(row)
        .select('id')
        .single();

      if (error) {
        console.warn('No fue posible registrar auditoría:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Motor de auditoría no disponible:', error);
      return null;
    }
  }

  function fmtDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('es-MX');
  }

  function actionLabel(action) {
    const labels = {
      LOGIN: 'Inicio de sesión',
      LOGOUT: 'Cierre de sesión',
      DOCUMENT_VIEWED: 'Documento abierto',
      DOCUMENT_DOWNLOADED: 'Documento descargado',
      DOCUMENT_UPLOADED: 'Documento cargado',
      DOCUMENT_APPROVED: 'Documento aprobado',
      DOCUMENT_RETURNED: 'Documento devuelto',
      DOCUMENT_REPLACED: 'Documento reemplazado',
      DOCUMENT_TRASHED: 'Documento enviado a papelera',
      DOCUMENT_RESTORED: 'Documento restaurado',
      USER_CREATED: 'Usuario creado',
      USER_UPDATED: 'Usuario actualizado',
      USER_APPROVED: 'Usuario aprobado',
      USER_SUSPENDED: 'Usuario suspendido',
      USER_REACTIVATED: 'Usuario reactivado',
      ROLE_CHANGED: 'Rol modificado',
      IMPORT_STARTED: 'Importación iniciada',
      IMPORT_COMPLETED: 'Importación completada',
      ACTION_BLOCKED: 'Acción bloqueada',
      ERROR: 'Error'
    };
    return labels[action] || action || 'Movimiento';
  }

  function resultBadge(result) {
    const clean = String(result || '').toLowerCase();
    const cls = clean === 'success' ? 'bgreen' :
      clean === 'blocked' || clean === 'error' ? 'bred' : 'bamber';
    const label = clean === 'success' ? 'Correcto' :
      clean === 'blocked' ? 'Bloqueado' :
      clean === 'error' ? 'Error' : result || 'Pendiente';
    return `<span class="badge ${cls}">${label}</span>`;
  }

  async function load() {
    const sb = client();

    const from = document.getElementById('auditFrom')?.value || '';
    const to = document.getElementById('auditTo')?.value || '';
    const action = document.getElementById('auditAction')?.value || '';
    const query = (document.getElementById('auditSearch')?.value || '').trim();

    let request = sb
      .from('audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (from) request = request.gte('created_at', `${from}T00:00:00`);
    if (to) request = request.lte('created_at', `${to}T23:59:59`);
    if (action) request = request.eq('action', action);
    if (query) {
      request = request.or(
        `actor_name.ilike.%${query}%,actor_email.ilike.%${query}%,park_name.ilike.%${query}%,document_name.ilike.%${query}%,file_name.ilike.%${query}%`
      );
    }

    const { data, error } = await request;
    if (error) throw error;

    state.events = data || [];
    render();
  }

  function render() {
    const kpis = document.getElementById('auditKpis');
    const body = document.getElementById('auditBody');
    if (!kpis || !body) return;

    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = state.events.filter(event =>
      String(event.created_at || '').slice(0, 10) === today
    );

    const uniqueUsers = new Set(todayEvents.map(event => event.actor_id).filter(Boolean)).size;
    const downloads = todayEvents.filter(event => event.action === 'DOCUMENT_DOWNLOADED').length;
    const changes = todayEvents.filter(event =>
      !['LOGIN', 'LOGOUT', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'].includes(event.action)
    ).length;

    const cards = [
      ['Movimientos de hoy', todayEvents.length, 'Eventos registrados', 'info'],
      ['Usuarios participantes', uniqueUsers, 'Actividad del día', 'good'],
      ['Descargas', downloads, 'Documentos descargados', 'warn'],
      ['Cambios operativos', changes, 'Acciones que modifican procesos', 'danger']
    ];

    kpis.innerHTML = cards.map(item => `
      <div class="card kpi ${item[3]}">
        <small>${item[0]}</small>
        <strong>${item[1]}</strong>
        <div class="sub">${item[2]}</div>
      </div>
    `).join('');

    body.innerHTML = state.events.map(event => `
      <tr>
        <td>${fmtDate(event.created_at)}</td>
        <td>
          <b>${escapeHtml(event.actor_name || 'Usuario')}</b><br>
          <small>${escapeHtml(event.actor_email || '')}</small>
        </td>
        <td>${escapeHtml(event.actor_role || '')}</td>
        <td>
          <b>${escapeHtml(actionLabel(event.action))}</b><br>
          <small>${escapeHtml(event.category || '')}</small>
        </td>
        <td>
          ${escapeHtml(event.park_name || '')}
          ${event.document_name ? `<br><small>${escapeHtml(event.document_name)}</small>` : ''}
          ${event.file_name ? `<br><small>${escapeHtml(event.file_name)}</small>` : ''}
        </td>
        <td>${resultBadge(event.result)}</td>
        <td>
          <button class="btn ghost" type="button" data-audit-detail="${event.id}">
            Ver detalle
          </button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7">No existen movimientos para los filtros seleccionados.</td></tr>';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function showDetail(id) {
    const event = state.events.find(item => item.id === id);
    if (!event) return;

    const section = (title, data) => {
      if (!data || (typeof data === 'object' && !Object.keys(data).length)) return '';
      return `
        <div class="card section" style="margin-top:12px">
          <h3>${title}</h3>
          <pre style="white-space:pre-wrap;word-break:break-word;background:#f4f8f6;padding:12px;border-radius:10px">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
      `;
    };

    window.openModal?.(
      `Evento ${event.id}`,
      `
        <div class="grid2">
          <div class="card section">
            <h3>${escapeHtml(actionLabel(event.action))}</h3>
            <p><b>Fecha:</b> ${escapeHtml(fmtDate(event.created_at))}</p>
            <p><b>Usuario:</b> ${escapeHtml(event.actor_name || '')}</p>
            <p><b>Correo:</b> ${escapeHtml(event.actor_email || '')}</p>
            <p><b>Rol:</b> ${escapeHtml(event.actor_role || '')}</p>
            <p><b>Resultado:</b> ${escapeHtml(event.result || '')}</p>
          </div>
          <div class="card section">
            <h3>Elemento afectado</h3>
            <p><b>División:</b> ${escapeHtml(event.division_code || '')}</p>
            <p><b>Región:</b> ${escapeHtml(event.region_code || '')}</p>
            <p><b>Parque:</b> ${escapeHtml(event.park_name || '')}</p>
            <p><b>Documento:</b> ${escapeHtml(event.document_name || '')}</p>
            <p><b>Archivo:</b> ${escapeHtml(event.file_name || '')}</p>
          </div>
        </div>
        ${event.message ? `<div class="alert"><b>Detalle</b><small>${escapeHtml(event.message)}</small></div>` : ''}
        ${section('Antes', event.before_data)}
        ${section('Después', event.after_data)}
        ${section('Información técnica', event.metadata)}
      `
    );
  }

  function exportCsv() {
    const columns = [
      'Fecha', 'Usuario', 'Correo', 'Rol', 'Categoría', 'Acción',
      'División', 'Región', 'Parque', 'Documento', 'Archivo',
      'Resultado', 'Mensaje'
    ];

    const rows = state.events.map(event => [
      fmtDate(event.created_at), event.actor_name, event.actor_email,
      event.actor_role, event.category, actionLabel(event.action),
      event.division_code, event.region_code, event.park_name,
      event.document_name, event.file_name, event.result, event.message
    ]);

    const csv = [columns, ...rows]
      .map(row => row.map(value =>
        `"${String(value ?? '').replace(/"/g, '""')}"`
      ).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csv], {
      type: 'text/csv;charset=utf-8'
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `PARKS_ONE_AUDITORIA_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    const module = document.getElementById('auditoria');
    if (!module) return;

    ['auditFrom', 'auditTo', 'auditAction'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        load().catch(console.error);
      });
    });

    document.getElementById('auditSearch')?.addEventListener('input', () => {
      clearTimeout(window.__parksAuditSearchTimer);
      window.__parksAuditSearchTimer = setTimeout(() => {
        load().catch(console.error);
      }, 350);
    });

    document.getElementById('auditExport')?.addEventListener('click', exportCsv);

    document.addEventListener('click', event => {
      const id = event.target.closest('[data-audit-detail]')?.dataset.auditDetail;
      if (id) showDetail(id);
    });

    await load();
  }

  window.ParksAudit = {
    log,
    load,
    init,
    exportCsv
  };

  if (document.readyState === 'loading') {
    window.addEventListener('load', () => init().catch(console.error));
  } else {
    init().catch(console.error);
  }
})();
