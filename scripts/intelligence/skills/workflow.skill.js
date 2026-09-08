(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'workflow',
    execute(parsed) {
      let rows=[];
      try{
        rows = typeof global.ParksCloud?.workflowRequests === 'function'
          ? (global.ParksCloud.workflowRequests() || [])
          : (global.PARKS_WORKFLOW_REQUESTS || []);
      }catch(_){ rows=[]; }
      const allowedParks=new Set(C.visibleParks().map(p=>C.normalize(p.park)));
      const scope=C.scopeInfo();
      if(!['national','read'].includes(scope.level)) rows=rows.filter(r=>allowedParks.has(C.normalize(r.park)));
      if(parsed.entities?.park?.label) rows=rows.filter(r=>C.normalize(r.park)===C.normalize(parsed.entities.park.label));
      if(parsed.region) rows=rows.filter(r=>C.normalize(r.region||r.parkRegion||r.regionCode)===C.normalize(parsed.region));
      if(parsed.normalized.includes('pendiente')||parsed.normalized.includes('revision')) rows=rows.filter(r=>r.status==='En revisión');
      else if(parsed.normalized.includes('aprobado')) rows=rows.filter(r=>r.status==='Aprobado');
      else if(parsed.normalized.includes('devuelto')||parsed.normalized.includes('rechazado')) rows=rows.filter(r=>r.status==='Devuelto');
      return C.result('Flujos y aprobaciones',
        `Encontré ${C.number(rows.length)} movimientos persistentes que coinciden con tu consulta.`,
        {html:C.listHtml(rows,r=>({
          title:`${r.park||'Parque'} · ${r.document||'Documento'}`,
          subtitle:`${r.uploadedBy||'Usuario'} · ${r.uploadedAt||''}`,value:r.status||''
        })),actions:[{label:'Abrir Flujos',page:'flujo'}],diagnosticData:{source:'Supabase · documents.workflow_status',records:rows.length,formula:'Movimientos persistentes visibles según alcance autorizado',result:`${rows.length} movimientos`}});
    }
  });
})(window);
