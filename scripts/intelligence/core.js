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

  function scopeInfo() {
    const role = getRole();
    const division = currentDivision();
    if (['arquitecto', 'divisional', 'direccion', 'director', 'ceo'].includes(role)) {
      return { level: 'national', label: 'Consulta nacional', division: '' };
    }
    if (['administrador', 'regional'].includes(role)) {
      return {
        level: 'division',
        label: division
          ? `Consulta limitada a tu división: ${division.toUpperCase()}`
          : 'Tu perfil requiere una división asignada',
        division
      };
    }
    return { level: 'read', label: 'Consulta de información autorizada', division };
  }

  function visibleParks() {
    const parks = Array.isArray(dataSource().parks) ? dataSource().parks.filter(Boolean) : [];
    const scope = scopeInfo();
    if (scope.level !== 'division') return parks;
    if (!scope.division) return [];
    return parks.filter(park =>
      normalize(park.division || park.division_name) === scope.division
    );
  }

  function visibleFiles() {
    return visibleParks().flatMap(park =>
      (park.files || []).map(file => ({ ...file, __park: park }))
    );
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
    if (parsed?.region) {
      files = files.filter(file =>
        normalize(file.region || file.__park?.region) === normalize(parsed.region)
      );
    }
    return files;
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
    return (source.alerts || []).filter(alert =>
      scopeInfo().level !== 'division' || parkNames.has(normalize(alert.park))
    );
  }

  function top5Data() {
    // TOP5_DATA es la fuente real cargada desde data.js.
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
      if (scope.level === 'division') {
        if (!division) return false;
        const rowDivision = normalize(row.division || row.division_name);
        if (rowDivision && rowDivision !== division) return false;
        if (!rowDivision) {
          const allowedParks = new Set(visibleParks().map(p => normalize(p.park)));
          const rowParks = Array.isArray(row.parks)
            ? row.parks
            : String(row.parks || '').split(',').map(item => item.trim()).filter(Boolean);
          return rowParks.some(p => allowedParks.has(normalize(p)));
        }
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
    getRole, getRealRole, getScope, scopeInfo, dataSource,
    visibleParks, visibleFiles, parksForQuery, filesForQuery,
    statusLabel, documentMatchesName, visibleAlerts,
    top5Data, visibleTop5, availableTop5Periods,
    number, percent, listHtml, result, restriction
  });
})(window);
