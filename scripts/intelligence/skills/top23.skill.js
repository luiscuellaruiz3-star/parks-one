(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'top23',
    execute() {
      const totals = C.visibleParks().reduce((a,p)=>{
        a.integrated+=p.integrated||0;a.pending+=p.pending||0;a.na+=p.na||0;a.validating+=p.validating||0;return a;
      },{integrated:0,pending:0,na:0,validating:0});
      const evaluated=totals.integrated+totals.pending+totals.validating;
      const compliance=totals.integrated/Math.max(1,evaluated);
      return C.result('Cumplimiento Top 23',
        `El cumplimiento documental del alcance visible es ${C.percent(compliance,2)}.`,
        {html:`<div class="intel-result-grid">
          <div class="intel-result-card"><small>Integrados</small><strong>${C.number(totals.integrated)}</strong></div>
          <div class="intel-result-card"><small>Pendientes</small><strong>${C.number(totals.pending)}</strong></div>
          <div class="intel-result-card"><small>Por validar</small><strong>${C.number(totals.validating)}</strong></div>
        </div>`,actions:[{label:'Abrir Top 23',page:'top23'}]});
    }
  });
})(window);
