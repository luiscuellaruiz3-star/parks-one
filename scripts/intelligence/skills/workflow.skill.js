(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'workflow',
    execute(parsed) {
      let rows=[];
      try{rows=JSON.parse(localStorage.getItem('parksOneRequests')||'[]')}catch(_){}
      const scope=C.scopeInfo();
      if(scope.level==='division') rows=rows.filter(r=>C.normalize(r.division)===scope.division);
      if(parsed.normalized.includes('pendiente')||parsed.normalized.includes('revision')) rows=rows.filter(r=>r.status==='En revisión');
      else if(parsed.normalized.includes('aprobado')) rows=rows.filter(r=>r.status==='Aprobado');
      else if(parsed.normalized.includes('devuelto')) rows=rows.filter(r=>r.status==='Devuelto');
      return C.result('Flujos y aprobaciones',
        `Encontré ${C.number(rows.length)} movimientos que coinciden con tu consulta.`,
        {html:C.listHtml(rows,r=>({
          title:`${r.park||'Parque'} · ${r.document||'Documento'}`,
          subtitle:`${r.uploadedBy||'Usuario'} · ${r.uploadedAt||''}`,value:r.status||''
        })),actions:[{label:'Abrir Flujos',page:'flujo'}]});
    }
  });
})(window);
