(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id: 'general',
    execute() {
      const parks = C.visibleParks();
      const files = C.visibleFiles();
      const alerts = C.visibleAlerts();
      return C.result('Resumen de tu alcance',
        `Tu perfil puede consultar ${C.number(parks.length)} parques, ${C.number(files.length)} archivos físicos y ${C.number(alerts.length)} alertas.`,
        { html: `<div class="intel-result-grid">
          <div class="intel-result-card"><small>Parques</small><strong>${C.number(parks.length)}</strong></div>
          <div class="intel-result-card"><small>Archivos</small><strong>${C.number(files.length)}</strong></div>
          <div class="intel-result-card"><small>Alertas</small><strong>${C.number(alerts.length)}</strong></div>
        </div>` });
    }
  });
})(window);
