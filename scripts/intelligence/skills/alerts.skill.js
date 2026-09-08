(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'alerts',
    execute(parsed) {
      let alerts=C.visibleAlerts();
      if (parsed.entities?.park?.label) {
        const target=C.normalize(parsed.entities.park.label);
        alerts=alerts.filter(a=>C.normalize(a.park)===target);
      }
      if (parsed.region) alerts=alerts.filter(a=>C.normalize(a.region)===C.normalize(parsed.region));
      if (parsed.risk) {
        const map={'CRÍTICO':'critical','ALTO':'high','MEDIO':'medium','BAJO':'low'};
        alerts=alerts.filter(a=>C.normalize(a.severity)===C.normalize(map[parsed.risk]||parsed.risk));
      }
      return C.result('Centro de alertas',
        `Encontré ${C.number(alerts.length)} alertas dentro de tu alcance.`,
        {html:C.listHtml(alerts,a=>({
          title:`${a.park||'Parque'} · ${a.document||'Alerta'}`,
          subtitle:a.message||'',value:a.severity||''
        })),actions:[{label:'Abrir Alertas',page:'alertas'}],
        diagnosticData:{source:'Centro de alertas',records:alerts.length,formula:'Alertas visibles + filtros de consulta',result:`${alerts.length} alertas`}});
    }
  });
})(window);
