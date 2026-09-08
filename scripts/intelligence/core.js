(function (global) {
  'use strict';

  const Parser = global.ParksIntelligenceParser;
  if (!Parser) throw new Error('Parks ONE: parser.js debe cargarse antes de core.js.');

  const { normalize, fuzzyIncludes } = Parser;

  const escapeHtml = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    })[char]);

  function getRole() {
    return global.ParksPermissions?.currentRole?.() ||
      String(global.ParksCloud?.profile?.()?.role || 'consulta').toLowerCase();
  }

  function getRealRole() {
    return global.ParksPermissions?.realRole?.() ||
      String(global.ParksCloud?.profile?.()?.role || 'consulta').toLowerCase();
  }

  function getScope() {
    return global.ParksCloud?.accessScope?.() || {};
  }

  function dataSource() {
    if (Array.isArray(global.C?.parks)) return global.C;
    if (Array.isArray(global.SIGOP_COMPUTED?.parks)) return global.SIGOP_COMPUTED;
    return global.SIGOP_DATA || { parks: [], alerts: [], all_files: [], top5: {} };
  }

  function currentDivision() {
    const scope = getScope();
    let division = scope.division_code || scope.division_name || '';
    if (!division && getRealRole() === 'arquitecto' &&
        ['administrador', 'regional'].includes(getRole())) {
      division = (dataSource().parks || []).map(p => p?.division).find(Boolean) || '';
    }
    return normalize(division);
  }

  function currentPark() {
    const scope = getScope();
    return normalize(scope.park_code || scope.park_name || scope.park_id || '');
  }

  function currentRegion() {
    const scope = getScope();
    let region = normalize(scope.region_code || scope.region_name || scope.region_id || '');
    if (!region && scope.park_id) {
      const target = normalize(scope.park_id);
      const matched = (dataSource().parks || []).find(p => [p.cloud_id,p.id,p.code,p.park].map(normalize).includes(target));
      region = normalize(matched?.region || matched?.region_name || '');
    }
    return region;
  }

  function uniqueBy(rows, keyFn) {
    const map = new Map();
    (rows || []).filter(Boolean).forEach((row, index) => {
      const key = String(keyFn(row, index) || '').trim() || `__${index}`;
      if (!map.has(key)) map.set(key, row);
    });
    return [...map.values()];
  }

  function scopeInfo() {
    const role = getRole();
    const division = currentDivision();
    const region = currentRegion();
    const park = currentPark();
    if (['arquitecto', 'divisional', 'direccion', 'director', 'ceo', 'consulta'].includes(role)) {
      return { level: 'national', label: 'Consulta nacional', division: '', region: '', park: '' };
    }
    if (role === 'regional') {
      return {
        level: 'division',
        label: division ? `Consulta limitada a tu división: ${division.toUpperCase()}` : 'Consulta limitada a tu división asignada',
        division, region: '', park: ''
      };
    }
    if (role === 'administrador') {
      return {
        level: 'region',
        label: region ? `Consulta limitada a tu región: ${region.toUpperCase()}` : 'Consulta limitada a tu región asignada',
        division, region, park
      };
    }
    return { level: 'read', label: 'Consulta de información autorizada', division, region, park };
  }

  function visibleParks() {
    const source = Array.isArray(dataSource().parks) ? dataSource().parks.filter(Boolean) : [];
    const parks = uniqueBy(source, park => normalize(park.cloud_id || park.id || park.code || park.park));
    const scope = scopeInfo();
    if (scope.level === 'national' || scope.level === 'read') return parks;
    if (scope.level === 'division') {
      if (!scope.division) return parks; // El bootstrap de Cloud ya entregó solo la división autorizada.
      return parks.filter(park => normalize(park.division || park.division_name) === scope.division);
    }
    if (scope.level === 'region') {
      if (!scope.region) return parks; // Compatibilidad con cuentas legacy: Cloud ya recortó por región.
      return parks.filter(park => normalize(park.region || park.region_name) === scope.region);
    }
    return [];
  }

  function visibleFiles() {
    const rows = visibleParks().flatMap(park =>
      (park.files || []).map(file => ({ ...file, __park: park }))
    );
    return uniqueBy(rows, file => normalize([
      file.storage_path || file.path || file.local_url || '',
      file.__park?.cloud_id || file.__park?.park || file.park || '',
      file.filename || file.file_name || file.name || '',
      file.document_type || file.folder || '',
      file.year || file.document_year || ''
    ].join('|')));
  }

  function parksForQuery(parsed) {
    let parks = visibleParks();

    const semanticPark = parsed?.entities?.park?.label || '';
    if (semanticPark) {
      parks = parks.filter(park =>
        normalize(park.park) === normalize(semanticPark)
      );
    }

    if (parsed?.region) {
      parks = parks.filter(park =>
        normalize(park.region) === normalize(parsed.region)
      );
    }

    const semanticAdministrator = parsed?.entities?.administrator?.label || '';
    if (semanticAdministrator) {
      parks = parks.filter(park =>
        normalize(park.administrator) === normalize(semanticAdministrator)
      );
    }

    return parks;
  }

  function filesForQuery(parsed) {
    let files = visibleFiles();
    const semanticPark = parsed?.entities?.park?.label || '';
    if (semanticPark) {
      files = files.filter(file => normalize(file.__park?.park || file.park) === normalize(semanticPark));
    }
    if (parsed?.region) {
      files = files.filter(file => normalize(file.region || file.__park?.region) === normalize(parsed.region));
    }
    return files;
  }

  function scopeNotice(parsed) {
    const scope = scopeInfo();
    const requestedNational = parsed?.scopeRequest === 'national';
    const restricted = requestedNational && scope.level !== 'national' && scope.level !== 'read';
    return {
      restricted,
      label: scope.label,
      text: restricted
        ? `Solicitaste información nacional, pero tu perfil solo puede consultar ${scope.level === 'division' ? 'su división' : scope.level === 'region' ? 'su región' : 'su alcance asignado'}. Los resultados fueron limitados automáticamente.`
        : `Alcance aplicado: ${scope.label.replace(/^Consulta\s*/i,'')}.`
    };
  }

  function statusLabel(status) {
    const raw = String(status ?? '').trim();
    const clean = normalize(raw);

    // La fuente Top 23 usa símbolos como valores de estatus.
    if (raw.includes('✅') || raw === '✓' || raw === '✔') {
      return { group: 'integrated', label: 'Integrado' };
    }
    if (raw.includes('❌') || raw === '✗' || raw === '✘') {
      return { group: 'pending', label: 'Pendiente' };
    }
    if (!clean) return { group: 'unknown', label: 'Sin información' };
    if (clean === 'na' || clean === 'n a' || clean.includes('no aplica')) {
      return { group: 'na', label: 'N/A' };
    }
    if (clean.includes('por validar') || clean.includes('validar')) {
      return { group: 'validating', label: 'Por validar' };
    }
    if (clean.includes('integrado') || clean.includes('vigente') ||
        clean.includes('completo') || clean === 'si' ||
        clean.includes('disponible')) {
      return { group: 'integrated', label: 'Integrado' };
    }
    return { group: 'pending', label: 'Pendiente' };
  }

  function documentMatchesName(rawName, requestedName) {
    if (!requestedName) return true;
    const raw = normalize(rawName).replace(/^\d+\s*[.)-]?\s*/, '');
    const requested = normalize(requestedName);
    return raw.includes(requested) || requested.includes(raw) ||
      fuzzyIncludes(raw, requested);
  }

  function visibleAlerts() {
    const parkNames = new Set(visibleParks().map(park => normalize(park.park)));
    const source = global.D || global.SIGOP_DATA || {};
    const level = scopeInfo().level;
    return (source.alerts || []).filter(alert =>
      ['national','read'].includes(level) || parkNames.has(normalize(alert.park))
    );
  }

  function top5Data() {
    // TOP5_DATA proviene del bootstrap protegido posterior a la autenticación.
    return global.TOP5_DATA ||
      global.D?.top5 ||
      global.SIGOP_DATA?.top5 ||
      { months: [], admins: [], regions: [], records: [] };
  }

  function monthMatches(rowMonth, requestedMonth) {
    if (!requestedMonth) return true;
    return normalize(rowMonth) === normalize(requestedMonth);
  }

  function regionMatches(rowRegion, requestedRegion) {
    if (!requestedRegion) return true;
    return normalize(rowRegion) === normalize(requestedRegion);
  }

  function visibleTop5(month, region) {
    const scope = scopeInfo();
    const division = scope.division;
    return (top5Data().admins || []).filter(row => {
      if (!monthMatches(row.month, month)) return false;
      if (!regionMatches(row.region, region)) return false;
      if (['division','region'].includes(scope.level)) {
        const allowedParks = new Set(visibleParks().map(p => normalize(p.park)));
        if (!allowedParks.size) return false;
        const rowParks = Array.isArray(row.parks)
          ? row.parks
          : String(row.parks || '').split(',').map(item => item.trim()).filter(Boolean);
        if (rowParks.some(p => allowedParks.has(normalize(p)))) return true;
        if (scope.level === 'division') {
          const rowDivision = normalize(row.division || row.division_name);
          return Boolean(rowDivision && rowDivision === division);
        }
        if (scope.level === 'region') {
          return normalize(row.region) === normalize(scope.region);
        }
        return false;
      }
      return true;
    });
  }

  function availableTop5Periods() {
    const source = top5Data();
    const fromMonths = (source.months || []).map(item => item?.month).filter(Boolean);
    const fromAdmins = (source.admins || []).map(item => item?.month).filter(Boolean);
    return [...new Set([...fromMonths, ...fromAdmins])];
  }

  function number(value) {
    return new Intl.NumberFormat('es-MX').format(Number(value) || 0);
  }

  function percent(value, digits = 1) {
    const numeric = Number(value) || 0;
    const normalized = numeric > 1 ? numeric : numeric * 100;
    return `${normalized.toFixed(digits)}%`;
  }

  function listHtml(rows, formatter, limit = 15) {
    const sliced = rows.slice(0, limit);
    return `
      <div class="intel-list">
        ${sliced.map((row, index) => {
          const item = formatter(row, index);
          return `
            <div class="intel-list-item">
              <span class="intel-list-number">${index + 1}</span>
              <div>
                <b>${escapeHtml(item.title)}</b>
                ${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ''}
              </div>
              ${item.value ? `<span class="intel-list-value">${escapeHtml(item.value)}</span>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${rows.length > limit
        ? `<div class="intel-note">Se muestran ${limit} de ${number(rows.length)} resultados.</div>`
        : ''}`;
  }

  function result(title, text, options = {}) {
    return {
      title, text,
      html: options.html || '',
      actions: options.actions || [],
      note: options.note || '',
      context: options.context || null,
      evidence: options.evidence || [],
      diagnosticData: options.diagnosticData || null
    };
  }

  function restriction(message) {
    return result('Consulta limitada por tu perfil', message, {
      note: 'El Centro de Inteligencia aplica el mismo alcance y jerarquía de PARKS ONE.'
    });
  }

  global.ParksIntelligenceCore = Object.freeze({
    normalize, fuzzyIncludes, escapeHtml,
    getRole, getRealRole, getScope, scopeInfo, dataSource, currentRegion, uniqueBy, scopeNotice,
    visibleParks, visibleFiles, parksForQuery, filesForQuery,
    statusLabel, documentMatchesName, visibleAlerts,
    top5Data, visibleTop5, availableTop5Periods,
    number, percent, listHtml, result, restriction
  });
})(window);
