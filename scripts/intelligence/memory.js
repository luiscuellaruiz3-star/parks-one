(function (global) {
  'use strict';

  const state = { history: [], context: null };

  function mergeContext(parsed) {
    const previous = state.context || {};
    const entities = parsed.entities || {};
    const previousEntities = previous.entities || {};
    const followUp = Boolean(parsed.followUp);

    // Una consulta independiente SIEMPRE parte limpia. Esto evita que R3, un parque,
    // un documento o un periodo de la pregunta anterior contaminen una consulta nueva.
    if (!followUp) {
      const clean = {
        ...parsed,
        region: parsed.region || '',
        document: parsed.document || '',
        risk: parsed.risk || '',
        entities: { ...entities }
      };
      state.context = {
        region: clean.region,
        month: clean.month || '',
        document: clean.document,
        risk: clean.risk,
        domain: clean.domain,
        entities: clean.entities
      };
      return clean;
    }

    // Solo preguntas claramente de seguimiento pueden heredar contexto.
    const merged = {
      ...parsed,
      domain: parsed.domain && parsed.domain !== 'general' ? parsed.domain : (previous.domain || parsed.domain),
      region: parsed.explicitRegion ? parsed.region : (previous.region || parsed.region || ''),
      month: parsed.explicitMonth ? parsed.month : (previous.month || parsed.month || ''),
      document: parsed.explicitDocument ? parsed.document : (parsed.document || previous.document || ''),
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

    // Pedir explícitamente nivel nacional limpia cualquier región heredada.
    if (parsed.scopeRequest === 'national') merged.region = '';

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
    state.history.push({ question, parsed, response, at: new Date().toISOString() });
    if (state.history.length > 50) state.history.shift();
  }

  function clear() { state.history = []; state.context = null; }
  function snapshot() {
    return { history: [...state.history], context: state.context ? JSON.parse(JSON.stringify(state.context)) : null };
  }

  global.ParksIntelligenceMemory = Object.freeze({ mergeContext, remember, clear, snapshot });
})(window);
