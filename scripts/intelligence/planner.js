(function (global) {
  'use strict';

  const DOMAIN_TO_SKILL = {
    users: 'users',
    top5: 'top5',
    top23: 'top23',
    documents: 'documents',
    parks: 'parks',
    workflow: 'workflow',
    audit: 'audit',
    water: 'water',
    alerts: 'alerts',
    executive: 'executive',
    general: 'general'
  };

  function semanticSkill(parsed) {
    const entities = parsed.entities || {};

    if (entities.executive) return 'executive';
    if (entities.document) return 'documents';
    if (entities.concept) return 'water';

    // Si existe un parque activo y la pregunta no pide explícitamente
    // otro dominio, la Skill de parques puede construir el snapshot.
    if (entities.park && ['general', 'parks'].includes(parsed.domain)) {
      return 'parks';
    }

    if (entities.administrator && parsed.domain === 'general') {
      return 'users';
    }

    return '';
  }

  function plan(parsed) {
    const skillId = semanticSkill(parsed) ||
      DOMAIN_TO_SKILL[parsed.domain] ||
      'general';

    return {
      skillId,
      parsed,
      semantic: Boolean(semanticSkill(parsed)),
      sources: sourceHints(skillId)
    };
  }

  function sourceHints(skillId) {
    return ({
      top5: ['Top 5'],
      top23: ['Top 23'],
      documents: ['Top 23', 'Biblioteca documental'],
      parks: ['Padrón de parques', 'Top 23', 'Top 5', 'Agua', 'Alertas'],
      alerts: ['Centro de alertas'],
      water: ['Matriz hidráulica'],
      users: ['Usuarios', 'Padrón de parques', 'Top 5'],
      workflow: ['Flujos y aprobaciones'],
      audit: ['Bitácora'],
      executive: ['Top 5', 'Top 23', 'Alertas', 'Agua'],
      general: ['PARKS ONE']
    })[skillId] || ['PARKS ONE'];
  }

  global.ParksIntelligencePlanner = Object.freeze({ plan });
})(window);
