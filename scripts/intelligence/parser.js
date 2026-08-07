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
        matrix[row][col] = Math.min(
          matrix[row - 1][col] + 1,
          matrix[row][col - 1] + 1,
          matrix[row - 1][col - 1] +
            (b[row - 1] === a[col - 1] ? 0 : 1)
        );
      }
    }

    return matrix[b.length][a.length];
  }

  function fuzzyIncludes(text, candidate) {
    const cleanText = normalize(text);
    const cleanCandidate = normalize(candidate);

    if (cleanText.includes(cleanCandidate)) return true;

    return cleanText.split(' ').some(token => {
      if (token.length < 4 || cleanCandidate.length < 4) return false;
      const maxDistance = Math.max(token.length, cleanCandidate.length) >= 8 ? 2 : 1;
      return distance(token, cleanCandidate) <= maxDistance;
    });
  }

  function detectDomain(question) {
    const q = normalize(question);

    // Prioridades explícitas para evitar empates como
    // “¿Qué parques tienen PTAR?”, que antes se clasificaba como parques.
    if (/\b(ptar|pozo|agua|hidraulica|descarga|descargas|suministro)\b/.test(q)) {
      return 'water';
    }

    if (/\b(alerta|alertas|vencimiento|vencen|critico|criticos)\b/.test(q)) {
      return 'alerts';
    }

    if (/\b(predial|prediales|proteccion civil|uso de suelo|licencia|archivo|archivos|documento|documentos)\b/.test(q)) {
      return 'documents';
    }

    if (
      /\btop\s*5\b/.test(q) ||
      /\btop5\b/.test(q) ||
      (
        /\b(rendimiento|cumplimiento|matutino|vespertino)\b/.test(q) &&
        /\b(administrador|administradores|admin|admins|region|regional)\b/.test(q)
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

    if (/\b(cuantos|cuantas|total|cantidad|conteo|numero de)\b/.test(q)) return 'count';
    if (/\b(compara|comparar|contra|versus|vs|mejoro|bajo|subio)\b/.test(q)) return 'compare';
    if (/\b(peor|mejor|mayor|menor|ranking|rendimiento|desempeno)\b/.test(q)) return 'rank';
    if (/\b(lista|listado|muestrame|mostrar|ensename|dame|cuales|quienes)\b/.test(q)) return 'list';
    if (/\b(resumen|resume|panorama|estado general)\b/.test(q)) return 'summary';
    if (/\b(busca|buscar|encuentra|localiza)\b/.test(q)) return 'search';
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

    const words = {
      uno: 'R1', dos: 'R2', tres: 'R3', cuatro: 'R4', cinco: 'R5',
      seis: 'R6', siete: 'R7', ocho: 'R8', nueve: 'R9', diez: 'R10'
    };

    for (const [word, region] of Object.entries(words)) {
      if (new RegExp(`\\bregion\\s+${word}\\b`).test(q)) return region;
    }

    return '';
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

    return {
      raw: question,
      normalized: normalize(question),
      domain: detectDomain(question),
      intent: detectIntent(question),
      role: detectRole(question),
      document: detectDocument(question),
      month: detectMonth(question, periods),
      region: detectRegion(question),
      risk: detectRisk(question)
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
    parse
  });
})(window);
