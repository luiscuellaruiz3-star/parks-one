(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'documents',
    execute(parsed) {
      const parks = C.parksForQuery(parsed);
      const documentName = parsed.document;
      const q = parsed.normalized;
      const physical = /\b(archivo|archivos|pdf|descarga|descargar|abre|abrir|biblioteca)\b/.test(q);
      const pending = /\b(pendiente|pendientes|falta|faltan|faltante|faltantes)\b/.test(q);
      const statusRows = [];
      parks.forEach(park => {
        Object.entries(park.statuses || {}).forEach(([name, rawStatus]) => {
          if (!C.documentMatchesName(name, documentName)) return;
          const status = C.statusLabel(rawStatus);
          if (pending && !['pending','validating'].includes(status.group)) return;
          statusRows.push({park,name,rawStatus,status});
        });
      });
      const files = C.filesForQuery(parsed).filter(file =>
        C.documentMatchesName(file.document_type || file.folder || file.filename || '', documentName)
      );
      if (documentName && !physical) {
        const summary = statusRows.reduce((a,r)=>{a[r.status.group]=(a[r.status.group]||0)+1;return a;},
          {integrated:0,pending:0,validating:0,na:0});
        const regionText = parsed.region ? ` en ${parsed.region}` : '';
        const title = pending ? `${documentName} pendientes${regionText}` : `${documentName}${regionText}`;
        if (!statusRows.length) return C.result(title,
          `No encontré parques con un estatus de ${documentName}${regionText} dentro de la información Top 23 visible.`,
          {note:'No significa necesariamente que no existan archivos; no hubo coincidencia en el estatus consolidado.',
           actions:[{label:'Abrir Top 23',page:'top23'},{label:'Abrir Biblioteca',page:'documentos'}]});
        return C.result(title,
          `Encontré ${C.number(statusRows.length)} parques con información de ${documentName}${regionText}.`,
          {html:`<div class="intel-result-grid">
            <div class="intel-result-card"><small>Integrados</small><strong>${C.number(summary.integrated)}</strong></div>
            <div class="intel-result-card"><small>Pendientes</small><strong>${C.number(summary.pending)}</strong></div>
            <div class="intel-result-card"><small>Por validar</small><strong>${C.number(summary.validating)}</strong></div>
            <div class="intel-result-card"><small>N/A</small><strong>${C.number(summary.na)}</strong></div>
            <div class="intel-result-card"><small>Archivos físicos</small><strong>${C.number(files.length)}</strong></div>
          </div>${C.listHtml(statusRows,r=>({
            title:r.park.park,subtitle:`${r.park.region||''} · ${r.park.administrator||'Por asignar'}`,value:r.status.label
          }))}`,
          actions:[{label:'Abrir Top 23',page:'top23'},{label:'Abrir Biblioteca',page:'documentos'}],
          context:{domain:'documents',document:documentName,region:parsed.region}});
      }
      return C.result(documentName ? `Archivos de ${documentName}` : 'Biblioteca documental',
        `Encontré ${C.number(files.length)} archivos físicos que coinciden con la consulta.`,
        {html:C.listHtml(files,f=>({
          title:f.filename||f.document_type||'Documento',
          subtitle:`${f.__park?.park||f.park||''} · ${f.document_type||f.folder||''}`,
          value:f.year?String(f.year):''
        })),actions:[{label:'Abrir Biblioteca',page:'documentos'}]});
    }
  });
})(window);
