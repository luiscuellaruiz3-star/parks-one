(function (global) {
  const C = global.ParksIntelligenceCore;

  function meaningfulTokens(q){
    const stop=new Set(['que','cual','cuales','como','dame','muestra','muestrame','todos','todas','sobre','del','de','la','el','los','las','un','una','en','y','por','para','informacion']);
    return C.normalize(q).split(' ').filter(x=>x.length>2&&!stop.has(x));
  }

  global.ParksIntelligenceRegistry.register({
    id: 'general',
    execute(parsed) {
      const parks = C.visibleParks();
      const files = C.visibleFiles();
      const alerts = C.visibleAlerts();
      const tokens=meaningfulTokens(parsed.raw||parsed.normalized||'');
      if(tokens.length){
        const score=text=>tokens.reduce((n,t)=>n+(C.normalize(text).includes(t)?1:0),0);
        const parkHits=parks.map(p=>({p,s:score([p.park,p.region,p.division,p.administrator,JSON.stringify(p.statuses||{}),JSON.stringify(p.hydrica||{})].join(' '))})).filter(x=>x.s).sort((a,b)=>b.s-a.s);
        const fileHits=files.map(f=>({f,s:score([f.filename,f.document_type,f.folder,f.__park?.park,f.region,f.year].join(' '))})).filter(x=>x.s).sort((a,b)=>b.s-a.s);
        const alertHits=alerts.map(a=>({a,s:score([a.park,a.document,a.message,a.severity].join(' '))})).filter(x=>x.s).sort((a,b)=>b.s-a.s);
        if(parkHits.length||fileHits.length||alertHits.length){
          const rows=[
            ...parkHits.slice(0,8).map(x=>({title:x.p.park,subtitle:`Parque · ${x.p.region||''} · ${x.p.administrator||'Por asignar'}`,value:'Parque'})),
            ...fileHits.slice(0,8).map(x=>({title:x.f.filename||x.f.document_type,subtitle:`Archivo · ${x.f.__park?.park||x.f.park||''}`,value:'Archivo'})),
            ...alertHits.slice(0,5).map(x=>({title:`${x.a.park||'Parque'} · ${x.a.document||'Alerta'}`,subtitle:x.a.message||'',value:'Alerta'}))
          ];
          return C.result('Coincidencias en PARKS ONE',`Encontré ${C.number(parkHits.length+fileHits.length+alertHits.length)} coincidencias dentro de la información autorizada para tu perfil.`,{
            html:C.listHtml(rows,r=>r,15),
            actions:[{label:'Abrir Parques',page:'parques',filters:{search:tokens.join(' ')}},{label:'Abrir Biblioteca',page:'documentos',filters:{search:tokens.join(' ')}}],
            diagnosticData:{source:'Parques + Biblioteca + Alertas + Top 23 + Matriz hídrica',records:parkHits.length+fileHits.length+alertHits.length,formula:'Búsqueda transversal por términos',result:'Coincidencias autorizadas'}
          });
        }
      }
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
