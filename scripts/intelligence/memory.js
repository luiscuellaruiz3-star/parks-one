(function (global) {
  'use strict';

  const state = { history: [], context: null };

  function mergeContext(parsed) {
    const previous = state.context || {};
    const entities = parsed.entities || {};
    const previousEntities = previous.entities || {};

    const merged = {
      ...parsed,
      region: parsed.region || previous.region || '',
      month: parsed.month || previous.month || '',
      document: parsed.document || previous.document || '',
      risk: parsed.risk || previous.risk || '',
      entities: {
        ...previousEntities,
        ...entities,
        park: entities.park || previousEntities.park || null,
        administrator: entities.administrator || previousEntities.administrator || null,
        document: entities.document || previousEntities.document || null,
        concept: entities.concept || previousEntities.concept || null
      }
    };

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
