(function (global) {
  'use strict';

  const Core = global.ParksIntelligenceCore;
  const Aliases = global.ParksIntelligenceAliases;

  function compact(value) {
    return Core.normalize(value)
      .replace(/\b(parque|park|industrial|industriales)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(value) {
    return compact(value).split(' ').filter(Boolean);
  }

  function similarity(question, candidate) {
    const q = compact(question);
    const c = compact(candidate);
    if (!q || !c) return 0;
    if (q === c) return 100;
    if (q.includes(c)) return 96;
    if (c.includes(q) && q.length >= 4) return 91;

    const qWords = words(q);
    const cWords = words(c);
    const overlap = cWords.filter(word =>
      qWords.some(token => token === word || Core.fuzzyIncludes(token, word))
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
