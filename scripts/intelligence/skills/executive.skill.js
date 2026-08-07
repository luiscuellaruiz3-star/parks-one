(function (global) {
  'use strict';

  const C = global.ParksIntelligenceCore;

  global.ParksIntelligenceRegistry.register({
    id: 'executive',

    execute(parsed) {
      const parks = C.parksForQuery(parsed);
      const alerts = C.visibleAlerts();
      const top5Rows = C.visibleTop5(parsed.month, parsed.region);

      const criticalParks = parks
        .filter(park => C.normalize(park.risk).includes('critico'))
        .sort((a, b) => (a.compliance || 0) - (b.compliance || 0));

      const pending = parks.reduce(
        (sum, park) => sum + (Number(park.pending) || 0), 0
      );

      const top5Totals = top5Rows.reduce((acc, row) => {
        acc.records += Number(row.records) || 0;
        acc.expected += Number(row.expected) || 0;
        return acc;
      }, { records: 0, expected: 0 });

      const top5 = top5Totals.expected > 0
        ? top5Totals.records / top5Totals.expected
        : 0;

      const top23 = parks.reduce(
        (sum, park) => sum + (Number(park.compliance) || 0), 0
      ) / Math.max(1, parks.length);

      const priorities = [];
      if (criticalParks.length) {
        priorities.push(
          `${criticalParks.length} parques están clasificados con riesgo crítico.`
        );
      }
      if (pending) {
        priorities.push(
          `El alcance visible concentra ${C.number(pending)} pendientes documentales.`
        );
      }
      if (alerts.length) {
        priorities.push(
          `Hay ${C.number(alerts.length)} alertas activas visibles.`
        );
      }
      if (top5Rows.length && top5 < 0.9) {
        priorities.push(
          `El Top 5 visible está por debajo de 90% (${C.percent(top5, 1)}).`
        );
      }

      const recommendation = priorities.length
        ? 'Prioriza primero los parques críticos con mayor rezago documental y después revisa alertas activas.'
        : 'No detecté una prioridad crítica con las fuentes visibles en este momento.';

      return C.result(
        'Resumen ejecutivo',
        priorities.length
          ? `Detecté ${priorities.length} frentes que requieren atención dentro de tu alcance.`
          : 'El alcance visible no presenta una prioridad crítica evidente con los datos actualmente cargados.',
        {
          html: `
            <div class="intel-result-grid">
              <div class="intel-result-card"><small>Top 5</small><strong>${top5Rows.length ? C.percent(top5, 1) : 'Sin dato'}</strong></div>
              <div class="intel-result-card"><small>Top 23 promedio</small><strong>${C.percent(top23, 1)}</strong></div>
              <div class="intel-result-card"><small>Pendientes</small><strong>${C.number(pending)}</strong></div>
              <div class="intel-result-card"><small>Alertas</small><strong>${C.number(alerts.length)}</strong></div>
              <div class="intel-result-card"><small>Parques críticos</small><strong>${C.number(criticalParks.length)}</strong></div>
            </div>
            ${priorities.length
              ? C.listHtml(priorities.map(text => ({ text })), item => ({
                  title: item.text,
                  subtitle: 'Prioridad detectada',
                  value: ''
                }), 8)
              : ''}
            <div class="intel-note"><b>Recomendación:</b> ${C.escapeHtml(recommendation)}</div>
          `,
          actions: [
            { label: 'Abrir Alertas', page: 'alertas' },
            { label: 'Abrir Top 23', page: 'top23' },
            { label: 'Abrir Top 5', page: 'top5' }
          ],
          diagnosticData: {
            source: 'TOP5_DATA + SIGOP_DATA.parks + SIGOP_DATA.alerts',
            records: parks.length,
            formula: 'Resumen ejecutivo multifuente',
            calculation: `Parques ${parks.length} · Alertas ${alerts.length} · Pendientes ${pending}`,
            result: `${priorities.length} prioridades`
          }
        }
      );
    }
  });
})(window);
