(function (global) {
  'use strict';

  const Core = global.ParksIntelligenceCore;
  const Aliases = global.ParksIntelligenceAliases;

  function compact(value) {
    const roman = {
      '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v',
      '6': 'vi', '7': 'vii', '8': 'viii', '9': 'ix', '10': 'x'
    };

    return Core.normalize(value)
      // Tolera PARK pegado y errores comunes del sufijo: Tultipark, Tultiprak, Tultiprk.
      .replace(/\b([a-z0-9]{3,})(?:park|prak|prk)\b/g, '$1 ')
      .replace(/\b(parque|park|prak|prk|industrial|industriales)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(token => roman[token] || token)
      .join(' ');
  }

  function words(value) {
    return compact(value).split(' ').filter(Boolean);
  }

  function phraseIncludes(text, phrase) {
    const t = ` ${String(text || '').trim()} `;
    const p = ` ${String(phrase || '').trim()} `;
    return Boolean(phrase && t.includes(p));
  }

  function tokenMatches(token, word) {
    if (token === word) return true;
    // I, II, III, IV, V... y demás tokens cortos deben coincidir exactamente.
    // El fuzzy anterior hacía que “I” coincidiera con cualquier palabra que tuviera i,
    // provocando que TULTI PARK III pudiera resolverse como TULTI PARK I.
    if (token.length < 4 || word.length < 4) return false;
    return Core.fuzzyIncludes(token, word);
  }

  function similarity(question, candidate) {
    const q = compact(question);
    const c = compact(candidate);
    if (!q || !c) return 0;
    if (q === c) return 100;
    // Evita falsos positivos con nombres que al compactarse quedan en 1-3 caracteres.
    if (c.length < 4) return 0;
    if (phraseIncludes(q, c)) return 98;
    if (q.length >= 4 && phraseIncludes(c, q)) return 93;

    const qWords = words(q);
    const cWords = words(c);
    const overlap = cWords.filter(word =>
      qWords.some(token => tokenMatches(token, word))
    ).length;

    if (!overlap) return 0;
    return Math.round((overlap / Math.max(1, cWords.length)) * 84);
  }

  function bestEntity(question, candidates, labelGetter) {
    let best = null;
    for (const candidate of candidates) {
      const label = labelGetter(candidate);
      const score = similarity(question, label);
      if (!best || score > best.score) best = { value: candidate, label, score };
    }
    return best && best.score >= 72 ? best : null;
  }

  function resolveDocument(question) {
    let best = null;
    Object.entries(Aliases.documents).forEach(([id, item]) => {
      item.aliases.forEach(alias => {
        const score = similarity(question, alias);
        if (!best || score > best.score) {
          best = { id, label: item.label, alias, score };
        }
      });
    });
    return best && best.score >= 72 ? best : null;
  }

  function resolveConcept(question) {
    let best = null;
    Object.entries(Aliases.concepts).forEach(([id, item]) => {
      item.aliases.forEach(alias => {
        const score = similarity(question, alias);
        if (!best || score > best.score) {
          best = { id, label: item.label, alias, score };
        }
      });
    });
    return best && best.score >= 72 ? best : null;
  }

  function resolvePark(question) {
    const parks = Core.visibleParks();
    const best = bestEntity(question, parks, park => park.park || '');
    return best ? {
      id: Core.normalize(best.value.park).replace(/\s+/g, '_'),
      label: best.value.park,
      score: best.score,
      data: best.value
    } : null;
  }

  function administrators() {
    const names = new Map();

    Core.visibleParks().forEach(park => {
      const name = String(park.administrator || '').trim();
      if (name) names.set(Core.normalize(name), { name, source: 'parks' });
    });

    (Core.top5Data().admins || []).forEach(row => {
      const name = String(row.administrator || '').trim();
      if (name) names.set(Core.normalize(name), { name, source: 'top5' });
    });

    return [...names.values()];
  }

  function resolveAdministrator(question) {
    const best = bestEntity(question, administrators(), item => item.name);
    return best ? {
      id: Core.normalize(best.value.name).replace(/\s+/g, '_'),
      label: best.value.name,
      score: best.score,
      data: best.value
    } : null;
  }

  function isExecutive(question) {
    return Aliases.executive.some(alias => similarity(question, alias) >= 75);
  }

  function resolve(question, parsed = {}) {
    const park = resolvePark(question);
    const administrator = resolveAdministrator(question);
    const document = resolveDocument(question);
    const concept = resolveConcept(question);

    return {
      park,
      administrator,
      document,
      concept,
      executive: isExecutive(question),
      region: parsed.region || '',
      month: parsed.month || ''
    };
  }

  global.ParksIntelligenceResolver = Object.freeze({
    resolve,
    resolvePark,
    resolveAdministrator,
    resolveDocument,
    resolveConcept,
    similarity
  });
})(window);
