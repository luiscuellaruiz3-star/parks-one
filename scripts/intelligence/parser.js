(function (global) {
  'use strict';

  const DOMAIN_TERMS = Object.freeze({
    top5: ['top5', 'top 5', 'rendimiento operativo', 'cumplimiento operativo', 'matutino', 'vespertino'],
    top23: ['top23', 'top 23', 'cumplimiento documental', 'requisitos', 'n a', 'por validar'],
    documents: ['documento', 'documentos', 'archivo', 'archivos', 'predial', 'proteccion civil', 'uso de suelo', 'licencia'],
    parks: ['parque', 'parques', 'riesgo', 'cumplimiento', 'expediente'],
    users: ['usuario', 'usuarios', 'administrador', 'administradores', 'regional', 'regionales', 'divisional', 'divisionales', 'arquitecto'],
    workflow: ['flujo', 'flujos', 'aprobacion', 'aprobaciones', 'carga pendiente', 'cargas pendientes', 'devuelto', 'revision'],
    audit: ['auditoria', 'bitacora', 'movimientos', 'actividad', 'quien hizo', 'quien cargo', 'descargas'],
    water: ['agua', 'ptar', 'pozo', 'descarga', 'descargas', 'suministro', 'hidraulica'],
    alerts: ['alerta', 'alertas', 'vencimiento', 'vencen', 'critico', 'criticos']
  });

  const DOCUMENT_SYNONYMS = Object.freeze({
    'Predial': ['predial', 'impuesto predial', 'pago predial'],
    'Protección Civil': ['proteccion civil', 'pc', 'dictamen pc', 'visto bueno pc'],
    'Uso de Suelo': ['uso de suelo', 'licencia de uso', 'uso suelo'],
    'Agua': ['pago de agua', 'agua'],
    'Descargas': ['descarga', 'descargas', 'permiso de descarga'],
    'Licencia de Funcionamiento': ['licencia de funcionamiento', 'funcionamiento']
  });

  const ROLE_SYNONYMS = Object.freeze({
    administrador: ['administrador', 'administradores', 'admin', 'admins'],
    regional: ['regional', 'regionales'],
    divisional: ['divisional', 'divisionales'],
    arquitecto: ['arquitecto', 'arquitectos'],
    direccion: ['direccion', 'director', 'directores', 'direccion de operaciones'],
    ceo: ['ceo']
  });

  const MONTHS = Object.freeze([
    ['enero', 'Enero'], ['febrero', 'Febrero'], ['marzo', 'Marzo'],
    ['abril', 'Abril'], ['mayo', 'Mayo'], ['junio', 'Junio'],
    ['julio', 'Julio'], ['agosto', 'Agosto'], ['septiembre', 'Septiembre'],
    ['octubre', 'Octubre'], ['noviembre', 'Noviembre'], ['diciembre', 'Diciembre']
  ]);

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s%.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function distance(a, b) {
    a = normalize(a);
    b = normalize(b);
    const matrix = Array.from({ length: b.length + 1 }, (_, row) => [row]);

    for (let col = 0; col <= a.length; col++) matrix[0][col] = col;

    for (let row = 1; row <= b.length; row++) {
      for (let col = 1; col <= a.length; col++) {
        let value = Math.min(
          matrix[row - 1][col] + 1,
          matrix[row][col - 1] + 1,
          matrix[row - 1][col - 1] +
            (b[row - 1] === a[col - 1] ? 0 : 1)
        );

        // Damerau-Levenshtein: trata una inversión adyacente como un solo error
        // (ej. "ptra" -> "ptar", "regoin" -> "region").
        if (
          row > 1 &&
          col > 1 &&
          b[row - 1] === a[col - 2] &&
          b[row - 2] === a[col - 1]
        ) {
          value = Math.min(value, matrix[row - 2][col - 2] + 1);
        }

        matrix[row][col] = value;
      }
    }

    return matrix[b.length][a.length];
  }

  function stemToken(value) {
    const token = normalize(value);
    if (token.length > 6 && token.endsWith('es')) return token.slice(0, -2);
    if (token.length > 5 && token.endsWith('s')) return token.slice(0, -1);
    return token;
  }

  function tokenClose(token, candidate) {
    const a = stemToken(token);
    const b = stemToken(candidate);
    if (!a || !b) return false;
    if (a === b) return true;

    // Términos de 1-3 caracteres (R1, PC, NA, etc.) sólo coinciden exactamente.
    if (a.length < 4 || b.length < 4) return false;

    const maxLen = Math.max(a.length, b.length);
    const maxDistance = maxLen >= 8 ? 2 : 1;
    return distance(a, b) <= maxDistance;
  }

  function fuzzyIncludes(text, candidate) {
    const cleanText = normalize(text);
    const cleanCandidate = normalize(candidate);
    if (!cleanText || !cleanCandidate) return false;

    // Coincidencia por frase completa con límites de palabra. Evita falsos positivos
    // como "n a" dentro de "quien administra".
    if (` ${cleanText} `.includes(` ${cleanCandidate} `)) return true;

    const textTokens = cleanText.split(' ').filter(Boolean);
    const candidateTokens = cleanCandidate.split(' ').filter(Boolean);
    if (!candidateTokens.length) return false;

    if (candidateTokens.length === 1) {
      return textTokens.some(token => tokenClose(token, candidateTokens[0]));
    }

    for (let start = 0; start <= textTokens.length - candidateTokens.length; start++) {
      const windowTokens = textTokens.slice(start, start + candidateTokens.length);
      if (candidateTokens.every((part, index) => tokenClose(windowTokens[index], part))) return true;
    }

    return false;
  }

  function detectDomain(question) {
    const q = normalize(question);

    // Prioridades explícitas y tolerantes a errores ortográficos para evitar empates
    // como “¿Qué parques tienen PTRA?”, que no debe clasificarse como parques.
    if (['ptar', 'pozo', 'agua', 'hidraulica', 'descarga', 'suministro'].some(term => fuzzyIncludes(q, term))) {
      return 'water';
    }

    if (['alerta', 'vencimiento', 'critico'].some(term => fuzzyIncludes(q, term))) {
      return 'alerts';
    }

    if ([
      'predial', 'proteccion civil', 'uso de suelo', 'licencia',
      'archivo', 'documento'
    ].some(term => fuzzyIncludes(q, term))) {
      return 'documents';
    }

    if (
      /\btop\s*5\b/.test(q) ||
      /\btop5\b/.test(q) ||
      (
        ['rendimiento', 'cumplimiento', 'matutino', 'vespertino'].some(term => fuzzyIncludes(q, term)) &&
        ['administrador', 'admin', 'region', 'regional'].some(term => fuzzyIncludes(q, term))
      )
    ) return 'top5';

    if (/\btop\s*23\b/.test(q) || /\btop23\b/.test(q)) return 'top23';

    let best = { domain: 'general', score: 0 };

    Object.entries(DOMAIN_TERMS).forEach(([domain, terms]) => {
      const score = terms.reduce(
        (total, term) => total + (fuzzyIncludes(question, term) ? 1 : 0),
        0
      );

      if (score > best.score) best = { domain, score };
    });

    return best.domain;
  }

  function detectIntent(question) {
    const q = normalize(question);
    const any = terms => terms.some(term => fuzzyIncludes(q, term));

    if (any(['cuantos', 'cuantas', 'total', 'cantidad', 'conteo', 'numero'])) return 'count';
    if (any(['compara', 'comparar', 'contra', 'versus', 'mejoro', 'bajo', 'subio']) || /\bvs\b/.test(q)) return 'compare';
    if (any(['peor', 'mejor', 'mayor', 'menor', 'ranking', 'rendimiento', 'desempeno'])) return 'rank';
    if (any(['lista', 'listado', 'muestrame', 'mostrar', 'ensename', 'dame', 'cuales', 'quienes'])) return 'list';
    if (any(['resumen', 'resume', 'panorama']) || fuzzyIncludes(q, 'estado general')) return 'summary';
    if (any(['busca', 'buscar', 'encuentra', 'localiza'])) return 'search';
    return 'answer';
  }

  function detectRole(question) {
    for (const [role, terms] of Object.entries(ROLE_SYNONYMS)) {
      if (terms.some(term => fuzzyIncludes(question, term))) return role;
    }
    return '';
  }

  function detectDocument(question) {
    for (const [name, terms] of Object.entries(DOCUMENT_SYNONYMS)) {
      if (terms.some(term => fuzzyIncludes(question, term))) return name;
    }
    return '';
  }

  function detectMonth(question, periods = []) {
    const availablePeriods = Array.isArray(periods) ? periods.filter(Boolean) : [];
    const normalizedQuestion = normalize(question);

    for (const [term, label] of MONTHS) {
      const exactMonth = new RegExp(`\\b${term}\\b`).test(normalizedQuestion);
      if (!exactMonth) continue;

      return availablePeriods.find(period =>
        normalize(period).includes(normalize(label))
      ) || label;
    }

    for (const [term, label] of MONTHS) {
      if (!fuzzyIncludes(question, term)) continue;

      return availablePeriods.find(period =>
        normalize(period).includes(normalize(label))
      ) || label;
    }

    // Los periodos llegan en orden cronológico (Mayo, Junio, Julio).
    // Si el usuario no especifica mes, usar siempre el corte más reciente.
    return availablePeriods.at(-1) || '';
  }

  function detectRegion(question) {
    const q = normalize(question);
    const numeric = q.match(/\b(?:region|r)\s*(10|[1-9])\b/);
    if (numeric) return `R${numeric[1]}`;

    // Tolera errores como “regoin 1” o “regin 3”.
    const tokens = q.split(' ').filter(Boolean);
    for (let index = 0; index < tokens.length - 1; index++) {
      const number = tokens[index + 1].match(/^(10|[1-9])$/);
      if (number && fuzzyIncludes(tokens[index], 'region')) return `R${number[1]}`;
    }

    const words = {
      uno: 'R1', dos: 'R2', tres: 'R3', cuatro: 'R4', cinco: 'R5',
      seis: 'R6', siete: 'R7', ocho: 'R8', nueve: 'R9', diez: 'R10'
    };

    for (const [word, region] of Object.entries(words)) {
      if (new RegExp(`\\bregion\\s+${word}\\b`).test(q)) return region;
      if (tokens.some((token, index) => fuzzyIncludes(token, 'region') && tokens[index + 1] === word)) return region;
    }

    return '';
  }

  function detectScopeRequest(question) {
    const q = normalize(question);
    if (
      fuzzyIncludes(q, 'nacional') ||
      fuzzyIncludes(q, 'todo el pais') ||
      fuzzyIncludes(q, 'todos los parques') ||
      fuzzyIncludes(q, 'todas las regiones')
    ) return 'national';
    if (fuzzyIncludes(q, 'mi division') || fuzzyIncludes(q, 'division asignada') || fuzzyIncludes(q, 'alcance divisional')) return 'division';
    if (fuzzyIncludes(q, 'mi region') || fuzzyIncludes(q, 'region asignada')) return 'region';
    return '';
  }

  function isFollowUp(question) {
    const q = normalize(question);
    if (!q) return false;
    if (/^(y|tambien|ademas|ahora)\b/.test(q)) return true;
    if (/\b(su|sus|ese|esa|esos|esas|el mismo|la misma|lo anterior|los pendientes|las pendientes)\b/.test(q) && q.split(' ').length <= 10) return true;

    // Preguntas elípticas como “¿cuáles están pendientes?” dependen del objeto
    // inmediatamente anterior. Se acepta también ortografía imperfecta.
    const startsAsQuestion = ['cual', 'cuales', 'que', 'quienes'].some(term => fuzzyIncludes(q.split(' ')[0], term));
    if (startsAsQuestion && q.split(' ').length <= 9 && (
      fuzzyIncludes(q, 'pendiente') ||
      fuzzyIncludes(q, 'faltante') ||
      fuzzyIncludes(q, 'por validar')
    )) return true;

    if (/^(cual|cuales)\s+(falta|faltan|quedo|quedan)\b/.test(q) && q.split(' ').length <= 7) return true;

    return /^(quien lo|quien la|tiene|cuantos faltan|cuantas faltan|y los|y las)\b/.test(q);
  }

  function detectRisk(question) {
    const q = normalize(question);
    if (fuzzyIncludes(q, 'critico')) return 'CRÍTICO';
    if (fuzzyIncludes(q, 'alto')) return 'ALTO';
    if (fuzzyIncludes(q, 'medio')) return 'MEDIO';
    if (fuzzyIncludes(q, 'bajo')) return 'BAJO';
    return '';
  }

  function parse(question, options = {}) {
    const periods = options.top5Periods || options.periods || [];
    const explicitMonth = MONTHS.some(([term]) => fuzzyIncludes(question, term));

    return {
      raw: question,
      normalized: normalize(question),
      domain: detectDomain(question),
      intent: detectIntent(question),
      role: detectRole(question),
      document: detectDocument(question),
      month: detectMonth(question, periods),
      region: detectRegion(question),
      risk: detectRisk(question),
      scopeRequest: detectScopeRequest(question),
      followUp: isFollowUp(question),
      explicitRegion: Boolean(detectRegion(question)),
      explicitDocument: Boolean(detectDocument(question)),
      explicitMonth
    };
  }

  global.ParksIntelligenceParser = Object.freeze({
    normalize,
    distance,
    fuzzyIncludes,
    detectDomain,
    detectIntent,
    detectRole,
    detectDocument,
    detectMonth,
    detectRegion,
    detectRisk,
    detectScopeRequest,
    isFollowUp,
    parse
  });
})(window);
