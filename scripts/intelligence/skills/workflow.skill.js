(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'workflow',
    execute(parsed) {
      let rows=[];
      try{rows=JSON.parse(localStorage.getItem('parksOneRequests')||'[]')}catch(_){}
      const allowedParks=new Set(C.visibleParks().map(p=>C.normalize(p.park)));
      const scope=C.scopeInfo();
      if(!['national','read'].includes(scope.level)) rows=rows.filter(r=>allowedParks.has(C.normalize(r.park)));
      if(parsed.entities?.park?.label) rows=rows.filter(r=>C.normalize(r.park)===C.normalize(parsed.entities.park.label));
      if(parsed.region) rows=rows.filter(r=>C.normalize(r.region||r.parkRegion||r.regionCode)===C.normalize(parsed.region));
      if(parsed.normalized.includes('pendiente')||parsed.normalized.includes('revision')) rows=rows.filter(r=>r.status==='En revisión');
      else if(parsed.normalized.includes('aprobado')) rows=rows.filter(r=>r.status==='Aprobado');
      else if(parsed.normalized.includes('devuelto')) rows=rows.filter(r=>r.status==='Devuelto');
      return C.result('Flujos y aprobaciones',
        `Encontré ${C.number(rows.length)} movimientos que coinciden con tu consulta.`,
        {html:C.listHtml(rows,r=>({
          title:`${r.park||'Parque'} · ${r.document||'Documento'}`,
          subtitle:`${r.uploadedBy||'Usuario'} · ${r.uploadedAt||''}`,value:r.status||''
        })),actions:[{label:'Abrir Flujos',page:'flujo'}],diagnosticData:{source:'Flujos y aprobaciones',records:rows.length,formula:'Movimientos visibles según parques autorizados',result:`${rows.length} movimientos`}});
    }
  });
})(window);
