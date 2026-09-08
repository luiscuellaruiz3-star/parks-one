(function () {
  'use strict';

  const Engine = window.ParksIntelligenceEngine;
  const Core = window.ParksIntelligenceCore;
  if (!Engine || !Core) throw new Error('Parks ONE: el motor de inteligencia no terminó de cargar.');

  const $ = selector => document.querySelector(selector);
  const MAX_INPUT_HEIGHT = 168;

  function resizeQuestionInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    const next = Math.min(Math.max(input.scrollHeight, 24), MAX_INPUT_HEIGHT);
    input.style.height = `${next}px`;
    input.style.overflowY = input.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  }

  function setComposerExpanded(expanded, options = {}) {
    const composer = $('#intelComposer');
    const extras = $('#intelComposerExtras');
    const toggle = $('#intelComposerToggle');
    if (!composer || !extras || !toggle) return;

    const open = Boolean(expanded);
    extras.hidden = !open;
    composer.classList.toggle('is-expanded', open);
    composer.classList.toggle('intel-bottom-compact', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Ocultar sugerencias y ayuda ▾' : 'Mostrar sugerencias y ayuda ▴';

    if (options.focus) $('#intelQuestion')?.focus();
  }

  function scrollAnswerToStart(host, answer) {
    if (!host || !answer) return;
    requestAnimationFrame(() => {
      const hostRect = host.getBoundingClientRect();
      const answerRect = answer.getBoundingClientRect();
      const target = host.scrollTop + (answerRect.top - hostRect.top) - 6;
      host.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    });
  }

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

    const actions = (response.actions || []).map(action => {
      const encoded = encodeURIComponent(JSON.stringify(action.filters || {}));
      return `<button class="btn ghost" data-intel-page="${Core.escapeHtml(action.page)}" data-intel-filters="${Core.escapeHtml(encoded)}">${Core.escapeHtml(action.label)}</button>`;
    }).join('');

    const evidence = (response.evidence || []).length
      ? `<div class="intel-note"><b>Fuentes:</b> ${(response.evidence || []).map(Core.escapeHtml).join(' · ')}</div>`
      : '';

    const scopeInfo = Engine.scope?.() || {};
    const humanRegion = value => {
      const raw = String(value || '').trim();
      const match = raw.match(/^R\s*(\d+)$/i);
      return match ? `Región ${match[1]}` : raw;
    };
    const authorizedScope = (() => {
      if (scopeInfo.level === 'national') return 'Nacional';
      if (scopeInfo.level === 'division') {
        const division = String(scopeInfo.division || '').trim();
        if (!division) return 'División asignada';
        const numeric = division.match(/(?:division|división)?\s*(\d+)/i);
        return numeric ? `División ${numeric[1]}` : division;
      }
      if (scopeInfo.level === 'region') {
        const region = humanRegion(scopeInfo.region || '');
        return region || 'Región asignada';
      }
      return String(scopeInfo.label || 'Información autorizada').replace(/^Consulta\s*/i, '').trim();
    })();

    const diagnostic = response.diagnostic || {};
    const semanticPark = diagnostic.semantic?.park && diagnostic.semantic.park !== 'No detectado'
      ? diagnostic.semantic.park
      : '';
    const diagnosticRegion = diagnostic.filters?.region && diagnostic.filters.region !== 'Sin filtro'
      ? diagnostic.filters.region
      : '';
    const queryFilter = semanticPark
      ? `Parque ${semanticPark}`
      : diagnosticRegion
        ? humanRegion(diagnosticRegion)
        : (scopeInfo.level === 'national' ? 'Nacional' : `Dentro de ${authorizedScope}`);

    const scope = `<div class="intel-scope-notice"><b>🔒 Alcance autorizado:</b> ${Core.escapeHtml(authorizedScope)}</div>
      <div class="intel-scope-notice"><b>🎯 Filtro de consulta:</b> ${Core.escapeHtml(queryFilter)}</div>
      ${response.scopeRestricted ? `<div class="intel-scope-notice restricted"><b>⚠️ Restricción aplicada:</b> ${Core.escapeHtml(response.scopeText || 'Los resultados fueron limitados automáticamente al alcance autorizado.')}</div>` : ''}`;

    const answerId = `intel-answer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    host.insertAdjacentHTML('beforeend', `<article id="${answerId}" class="intel-chat-answer"><div class="intel-message-content">
      <h3>${Core.escapeHtml(response.title)}</h3>
      <p>${Core.escapeHtml(response.text)}</p>
      ${response.html || ''}
      ${actions ? `<div class="intel-actions">${actions}</div>` : ''}
      ${response.note ? `<div class="intel-note">${Core.escapeHtml(response.note)}</div>` : ''}
      ${scope}
      ${evidence}
      ${diagnosticHtml(response.diagnostic)}
    </div></article>`);

    setComposerExpanded(false);
    scrollAnswerToStart(host, document.getElementById(answerId));
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
    if ($('#intelScopeText')) $('#intelScopeText').textContent = Engine.scope().label;
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
      resizeQuestionInput(input);
      input.focus();
    }
    setComposerExpanded(false);
  }

  function applyNavigationFilters(page, filters = {}) {
    try { sessionStorage.setItem('parksOneIntelligenceNavigation', JSON.stringify({ page, filters, at: Date.now() })); } catch (_) {}

    const setValue = (id, value) => {
      if (!value) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setTimeout(() => {
      if (page === 'documentos') {
        setValue('docRegion', filters.region);
        setValue('docSearch', filters.park || filters.document || filters.search);
        if (typeof window.renderDocs === 'function') window.renderDocs();
      } else if (page === 'parques') {
        setValue('regionFilter', filters.region);
        setValue('riskFilter', filters.risk);
        setValue('parkSearch', filters.park || filters.administrator || filters.search);
        if (typeof window.renderParks === 'function') window.renderParks();
      } else if (page === 'top5') {
        setValue('top5Month', filters.month);
        setValue('top5Region', filters.region);
        setValue('top5Admin', filters.administrator || filters.park);
        if (typeof window.renderTop5 === 'function') window.renderTop5();
      } else if (page === 'alertas') {
        setValue('alertSearch', filters.park || filters.document || filters.search);
        if (typeof window.renderAlerts === 'function') window.renderAlerts();
      } else if (page === 'agua') {
        setValue('waterRegion', filters.region);
        setValue('waterSearch', filters.park || filters.administrator || filters.search);
        if (typeof window.renderWater === 'function') window.renderWater();
      }
    }, 60);
  }

  function bind() {
    $('#intelForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = $('#intelQuestion');
      const question = input?.value || '';
      if (input) {
        input.value = '';
        resizeQuestionInput(input);
      }
      setComposerExpanded(false);
      ask(question);
    });

    $('#intelQuestion')?.addEventListener('input', event => {
      resizeQuestionInput(event.currentTarget);
    });

    $('#intelQuestion')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('#intelForm')?.requestSubmit();
      }
    });

    $('#intelClear')?.addEventListener('click', clear);
    $('#intelComposerToggle')?.addEventListener('click', () => {
      const expanded = $('#intelComposerToggle')?.getAttribute('aria-expanded') === 'true';
      setComposerExpanded(!expanded, { focus: false });
    });

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
        if (input) {
          input.value = question;
          resizeQuestionInput(input);
        }
        setComposerExpanded(false);
        ask(question);
        return;
      }

      const action = event.target.closest('[data-intel-page]');
      if (action) {
        let filters = {};
        try { filters = JSON.parse(decodeURIComponent(action.dataset.intelFilters || '%7B%7D')); } catch (_) {}
        document.querySelector(`.nav button[data-page="${action.dataset.intelPage}"]`)?.click();
        applyNavigationFilters(action.dataset.intelPage, filters);
      }
    });
  }

  function init() {
    if ($('#intelScopeText')) $('#intelScopeText').textContent = Engine.scope().label;
    renderSuggestions();
    bind();
    setComposerExpanded(false);
    resizeQuestionInput($('#intelQuestion'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ParksIntelligenceUI = Object.freeze({ ask, clear });
})();
