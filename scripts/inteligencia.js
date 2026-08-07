(function () {
  'use strict';

  const Engine = window.ParksIntelligenceEngine;
  const Core = window.ParksIntelligenceCore;
  if (!Engine || !Core) throw new Error('Parks ONE: el motor de inteligencia no terminó de cargar.');

  const $ = selector => document.querySelector(selector);

  function ensureHost() {
    const host = $('#intelResultPanel');
    host?.querySelector('.intel-welcome')?.remove();
    return host;
  }

  function appendQuestion(question) {
    const host = ensureHost();
    if (!host) return;
    host.insertAdjacentHTML('beforeend', `<div class="intel-chat-turn"><div class="intel-chat-user"><small>Tú</small>${Core.escapeHtml(question)}</div></div>`);
    host.scrollTop = host.scrollHeight;
  }

  function thinking() {
    const host = ensureHost();
    const id = `thinking-${Date.now()}`;
    host?.insertAdjacentHTML('beforeend', `<div id="${id}" class="intel-chat-thinking"><span class="intel-thinking">Analizando<i></i><i></i><i></i></span></div>`);
    if (host) host.scrollTop = host.scrollHeight;
    return id;
  }

  function diagnosticHtml(diagnostic) {
    if (!diagnostic) return '';
    const id = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const filters = diagnostic.filters || {};
    const permissions = diagnostic.permissions || {};
    const context = diagnostic.context || {};

    return `
      <div class="intel-diagnostic-wrap">
        <button type="button" class="intel-diagnostic-toggle" data-intel-diagnostic="${id}">🔍 Ver diagnóstico</button>
        <section id="${id}" class="intel-diagnostic" hidden>
          <div class="intel-diagnostic-grid">
            <div><small>Intención</small><b>${Core.escapeHtml(diagnostic.intent)}</b></div>
            <div><small>Dominio</small><b>${Core.escapeHtml(diagnostic.domain)}</b></div>
            <div><small>Skill</small><b>${Core.escapeHtml(diagnostic.skill)}</b></div>
            <div><small>Fuente</small><b>${Core.escapeHtml(diagnostic.source)}</b></div>
            <div><small>Región</small><b>${Core.escapeHtml(filters.region)}</b></div>
            <div><small>Periodo</small><b>${Core.escapeHtml(filters.month)}</b></div>
            <div><small>Documento</small><b>${Core.escapeHtml(filters.document)}</b></div>
            <div><small>Rol</small><b>${Core.escapeHtml(permissions.role)}</b></div>
            <div><small>Alcance</small><b>${Core.escapeHtml(permissions.scope)}</b></div>
            <div><small>Registros</small><b>${Core.escapeHtml(diagnostic.records)}</b></div>
            <div><small>Meta</small><b>${Core.escapeHtml(diagnostic.expected)}</b></div>
            <div><small>Fórmula</small><b>${Core.escapeHtml(diagnostic.formula)}</b></div>
            <div><small>Cálculo</small><b>${Core.escapeHtml(diagnostic.calculation || 'No aplica')}</b></div>
            <div><small>Resultado</small><b>${Core.escapeHtml(diagnostic.result)}</b></div>
            <div><small>Tiempo</small><b>${Core.escapeHtml(diagnostic.elapsedMs)} ms</b></div>
            <div><small>Confianza</small><b>${Core.escapeHtml(diagnostic.confidence)}%</b></div>
            <div><small>Contexto heredado</small><b>${context.inherited ? 'Sí' : 'No'}</b></div>
          </div>
        </section>
      </div>`;
  }

  function show(response, id) {
    document.getElementById(id)?.remove();
    const host = ensureHost();
    if (!host) return;

    const actions = (response.actions || []).map(action =>
      `<button class="btn ghost" data-intel-page="${Core.escapeHtml(action.page)}">${Core.escapeHtml(action.label)}</button>`
    ).join('');

    const evidence = (response.evidence || []).length
      ? `<div class="intel-note"><b>Fuentes:</b> ${(response.evidence || []).map(Core.escapeHtml).join(' · ')}</div>`
      : '';

    host.insertAdjacentHTML('beforeend', `<article class="intel-chat-answer"><div class="intel-message-content">
      <h3>${Core.escapeHtml(response.title)}</h3>
      <p>${Core.escapeHtml(response.text)}</p>
      ${response.html || ''}
      ${actions ? `<div class="intel-actions">${actions}</div>` : ''}
      ${response.note ? `<div class="intel-note">${Core.escapeHtml(response.note)}</div>` : ''}
      ${evidence}
      ${diagnosticHtml(response.diagnostic)}
    </div></article>`);

    host.scrollTop = host.scrollHeight;
  }

  function errorView(error, id) {
    show({
      title: 'No pude completar la consulta',
      text: 'Se presentó un error al consultar la información disponible.',
      note: error?.message || String(error),
      evidence: []
    }, id);
  }

  async function ask(question) {
    const clean = String(question || '').trim();
    if (!clean) return;
    appendQuestion(clean);
    const id = thinking();
    try {
      const { response } = await Engine.ask(clean);
      show(response, id);
    } catch (error) {
      errorView(error, id);
    }
  }

  function renderSuggestions() {
    const host = $('#intelSuggestions');
    if (!host) return;
    host.innerHTML = Engine.suggestions().map(question =>
      `<button type="button" class="intel-suggestion" data-intel-question="${Core.escapeHtml(question)}">${Core.escapeHtml(question)}</button>`
    ).join('');
  }

  function clear() {
    Engine.clear();
    const host = $('#intelResultPanel');
    if (host) host.innerHTML = `<div class="intel-welcome"><span class="intel-welcome-icon">✦</span><h2>¿Qué deseas conocer?</h2><p>Consulta Top 5, Top 23, parques, documentos, alertas, usuarios y agua/PTAR con la información disponible en PARKS ONE.</p></div>`;
    const input = $('#intelQuestion');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.focus();
    }
  }

  function bind() {
    $('#intelForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = $('#intelQuestion');
      const question = input?.value || '';
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      ask(question);
    });

    $('#intelQuestion')?.addEventListener('input', event => {
      const input = event.currentTarget;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    });

    $('#intelQuestion')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('#intelForm')?.requestSubmit();
      }
    });

    $('#intelClear')?.addEventListener('click', clear);

    document.addEventListener('click', event => {
      const diagnosticButton = event.target.closest('[data-intel-diagnostic]');
      if (diagnosticButton) {
        const panel = document.getElementById(diagnosticButton.dataset.intelDiagnostic);
        if (panel) {
          panel.hidden = !panel.hidden;
          diagnosticButton.textContent = panel.hidden ? '🔍 Ver diagnóstico' : 'Ocultar diagnóstico';
        }
        return;
      }

      const suggestion = event.target.closest('[data-intel-question]');
      if (suggestion) {
        const question = suggestion.dataset.intelQuestion;
        const input = $('#intelQuestion');
        if (input) input.value = question;
        ask(question);
        return;
      }

      const action = event.target.closest('[data-intel-page]');
      if (action) {
        document.querySelector(`.nav button[data-page="${action.dataset.intelPage}"]`)?.click();
      }
    });
  }

  function init() {
    if ($('#intelScopeText')) $('#intelScopeText').textContent = Engine.scope().label;
    renderSuggestions();
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ParksIntelligenceUI = Object.freeze({ ask, clear });
})();
