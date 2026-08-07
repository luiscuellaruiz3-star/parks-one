(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'alerts',
    execute(parsed) {
      let alerts=C.visibleAlerts();
      if (parsed.risk) {
        const map={'CRÍTICO':'critical','ALTO':'high','MEDIO':'medium'};
        alerts=alerts.filter(a=>a.severity===map[parsed.risk]);
      }
      return C.result('Centro de alertas',
        `Encontré ${C.number(alerts.length)} alertas dentro de tu alcance.`,
        {html:C.listHtml(alerts,a=>({
          title:`${a.park||'Parque'} · ${a.document||'Alerta'}`,
          subtitle:a.message||'',value:a.severity||''
        })),actions:[{label:'Abrir Alertas',page:'alertas'}]});
    }
  });
})(window);
