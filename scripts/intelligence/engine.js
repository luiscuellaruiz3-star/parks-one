(function (global) {
  'use strict';

  const Parser = global.ParksIntelligenceParser;
  const Core = global.ParksIntelligenceCore;
  const Memory = global.ParksIntelligenceMemory;
  const Planner = global.ParksIntelligencePlanner;
  const Registry = global.ParksIntelligenceRegistry;
  const Resolver = global.ParksIntelligenceResolver;

  function confidenceFor(parsed, response) {
    let score = 60;
    if (parsed.domain && parsed.domain !== 'general') score += 10;
    if (parsed.intent) score += 5;
    if (parsed.region) score += 4;
    if (parsed.month) score += 4;
    if (parsed.document) score += 4;
    if (parsed.entities?.park) score += 8;
    if (parsed.entities?.document) score += 6;
    if (parsed.entities?.concept) score += 5;
    if (response?.diagnosticData?.records > 0) score += 5;
    if (response?.diagnosticData?.source) score += 4;
    if (/no encontr[eé]|sin informaci[oó]n|no fue posible/i.test(response?.text || '')) score -= 18;
    return Math.max(20, Math.min(99, score));
  }

  function diagnosticFor({ question, parsed, plan, response, elapsedMs }) {
    const scope = Core.scopeInfo();
    const profile = global.ParksCloud?.profile?.() || {};
    const extra = response?.diagnosticData || {};
    const entities = parsed.entities || {};

    return {
      query: question,
      intent: parsed.intent || 'consultar',
      domain: parsed.domain || 'general',
      skill: `${plan.skillId}.skill.js`,
      source: extra.source || (plan.sources || []).join(' + ') || 'PARKS ONE',
      semantic: {
        park: entities.park?.label || 'No detectado',
        administrator: entities.administrator?.label || 'No detectado',
        document: entities.document?.label || 'No detectado',
        concept: entities.concept?.label || 'No detectado',
        executive: Boolean(entities.executive)
      },
      filters: {
        region: parsed.region || 'Sin filtro',
        month: parsed.month || 'Sin filtro',
        document: parsed.document || entities.document?.label || 'Sin filtro',
        risk: parsed.risk || 'Sin filtro'
      },
      context: {
        inherited: Boolean(parsed.__contextInherited),
        activeRegion: parsed.region || '',
        activeMonth: parsed.month || '',
        activeDocument: parsed.document || entities.document?.label || '',
        activePark: entities.park?.label || ''
      },
      permissions: {
        role: profile.role || Core.getRole(),
        scope: scope.label,
        level: scope.level,
        division: scope.division || 'Nacional'
      },
      records: Number(extra.records ?? 0),
      expected: Number(extra.expected ?? 0),
      formula: extra.formula || 'No aplica',
      calculation: extra.calculation || '',
      result: extra.result || response?.title || '',
      elapsedMs,
      confidence: confidenceFor(parsed, response),
      evidence: response?.evidence || plan.sources || []
    };
  }

  function inheritFlag(before, parsed0, parsed) {
    if (!before) return false;
    const beforeEntities = before.entities || {};
    const current = parsed.entities || {};
    const raw = parsed0.entities || {};

    return Boolean(
      (!parsed0.region && parsed.region) ||
      (!parsed0.month && parsed.month) ||
      (!parsed0.document && parsed.document) ||
      (!raw.park && current.park && beforeEntities.park) ||
      (!raw.administrator && current.administrator && beforeEntities.administrator)
    );
  }

  async function ask(question) {
    const clean = String(question || '').trim();
    if (!clean) throw new Error('Escribe una consulta.');

    const started = performance.now();
    const before = Memory.snapshot?.().context || null;

    const parsed0 = Parser.parse(clean, {
      top5Periods: Core.availableTop5Periods()
    });

    parsed0.entities = Resolver.resolve(clean, parsed0);

    // Canonicalizar lo que el parser ya detectó.
    if (parsed0.entities.document) {
      parsed0.document = parsed0.entities.document.label;
      if (parsed0.domain === 'general') parsed0.domain = 'documents';
    }

    if (parsed0.entities.concept && parsed0.domain === 'general') {
      parsed0.domain = 'water';
    }

    if (parsed0.entities.executive) {
      parsed0.domain = 'executive';
      parsed0.intent = 'summary';
    }

    const parsed = Memory.mergeContext(parsed0);
    parsed.__contextInherited = inheritFlag(before, parsed0, parsed);

    const plan = Planner.plan(parsed);
    const skill = Registry.get(plan.skillId);
    if (!skill) {
      throw new Error(`No existe una Skill registrada para ${plan.skillId}.`);
    }

    const response = await skill.execute(parsed, { plan });
    response.evidence = response.evidence?.length
      ? response.evidence
      : plan.sources;

    const elapsedMs = Math.max(1, Math.round(performance.now() - started));
    response.diagnostic = diagnosticFor({
      question: clean,
      parsed,
      plan,
      response,
      elapsedMs
    });

    Memory.remember(clean, parsed, response);
    return { question: clean, parsed, plan, response };
  }

  function clear() { Memory.clear(); }
  function scope() { return Core.scopeInfo(); }

  function suggestions() {
    return [
      'Háblame de Azcapopark',
      '¿Y su Predial?',
      '¿Quién lo administra?',
      '¿Qué parques tienen PTAR?',
      'Muéstrame Top 5 julio Región 1',
      '¿Qué me preocupa hoy?',
      'Muéstrame las alertas críticas'
    ];
  }

  global.ParksIntelligenceEngine = Object.freeze({
    ask, clear, scope, suggestions
  });
})(window);
