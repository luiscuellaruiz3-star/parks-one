(function (global) {
  'use strict';

  const state = { history: [], context: null };

  function mergeContext(parsed) {
    const previous = state.context || {};
    const entities = parsed.entities || {};
    const previousEntities = previous.entities || {};

    // Un dominio explícito nuevo no debe arrastrar filtros semánticos incompatibles
    // de la consulta anterior. Ej.: Predial -> "¿Qué parques tienen PTAR?".
    const explicitDomain = parsed.domain && parsed.domain !== 'general';
    const domainChanged = explicitDomain && previous.domain && parsed.domain !== previous.domain;
    const keepDocument = !domainChanged && ['documents', 'parks', 'general'].includes(parsed.domain || 'general');
    const keepConcept = !domainChanged && ['water', 'parks', 'general'].includes(parsed.domain || 'general');
    const keepRisk = !domainChanged && ['alerts', 'parks', 'general'].includes(parsed.domain || 'general');

    const merged = {
      ...parsed,
      region: parsed.region || previous.region || '',
      month: parsed.month || previous.month || '',
      document: parsed.document || (keepDocument ? previous.document : '') || '',
      risk: parsed.risk || (keepRisk ? previous.risk : '') || '',
      entities: {
        ...previousEntities,
        ...entities,
        park: entities.park || previousEntities.park || null,
        administrator: entities.administrator || previousEntities.administrator || null,
        document: entities.document || (keepDocument ? previousEntities.document : null) || null,
        concept: entities.concept || (keepConcept ? previousEntities.concept : null) || null
      }
    };

    // Una intención hidráulica explícita siempre invalida documentos heredados.
    if (parsed.domain === 'water' || entities.concept) {
      merged.document = parsed.document || '';
      merged.entities.document = entities.document || null;
    }

    // Una intención documental explícita invalida conceptos hidráulicos heredados.
    if (parsed.domain === 'documents' || entities.document) {
      merged.entities.concept = entities.concept || null;
    }

    // Cambiar a una entidad explícita nueva limpia relaciones incompatibles.
    if (entities.park) {
      merged.entities.administrator = entities.administrator || null;
    }

    state.context = {
      region: merged.region,
      month: merged.month,
      document: merged.document,
      risk: merged.risk,
      domain: merged.domain,
      entities: merged.entities
    };

    return merged;
  }

  function remember(question, parsed, response) {
    state.history.push({
      question, parsed, response,
      at: new Date().toISOString()
    });
    if (state.history.length > 50) state.history.shift();
  }

  function clear() {
    state.history = [];
    state.context = null;
  }

  function snapshot() {
    return {
      history: [...state.history],
      context: state.context
        ? JSON.parse(JSON.stringify(state.context))
        : null
    };
  }

  global.ParksIntelligenceMemory = Object.freeze({
    mergeContext, remember, clear, snapshot
  });
})(window);
