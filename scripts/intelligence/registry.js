(function (global) {
  'use strict';
  const skills = new Map();

  function register(skill) {
    if (!skill?.id || typeof skill.execute !== 'function') {
      throw new Error('Skill inválida: requiere id y execute().');
    }
    skills.set(skill.id, skill);
  }

  function get(id) { return skills.get(id) || null; }
  function all() { return [...skills.values()]; }

  global.ParksIntelligenceRegistry = Object.freeze({ register, get, all });
})(window);
