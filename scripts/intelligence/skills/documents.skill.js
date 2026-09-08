(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'documents',
    execute(parsed) {
      const parks = C.parksForQuery(parsed);
      const documentName = parsed.document || parsed.entities?.document?.label || '';
      const q = parsed.normalized;
      const physical = /\b(archivo|archivos|pdf|descargar|abre|abrir|biblioteca|evidencia)\b/.test(q);
      const fuzzy = global.ParksIntelligenceParser?.fuzzyIncludes;
      const pending = /\b(pendiente|pendientes|falta|faltan|faltante|faltantes)\b/.test(q) ||
        (typeof fuzzy === 'function' && ['pendiente', 'faltante', 'por validar'].some(term => fuzzy(q, term)));
      let statusRows = [];
      parks.forEach(park => {
        Object.entries(park.statuses || {}).forEach(([name, rawStatus]) => {
          if (!C.documentMatchesName(name, documentName)) return;
          const status = C.statusLabel(rawStatus);
          if (pending && !['pending','validating'].includes(status.group)) return;
          statusRows.push({park,name,rawStatus,status});
        });
      });
      // Una obligación por parque + tipo documental. Evita repetir parques por copias/versiones.
      statusRows = C.uniqueBy(statusRows, r => `${C.normalize(r.park.cloud_id || r.park.park)}|${C.normalize(r.name).replace(/^\d+\s*[.)-]?\s*/, '')}`);

      let files = C.filesForQuery(parsed).filter(file =>
        C.documentMatchesName(file.document_type || file.folder || file.filename || '', documentName)
      );
      files = C.uniqueBy(files, f => C.normalize([
        f.storage_path || f.path || '', f.__park?.cloud_id || f.__park?.park || f.park || '',
        f.filename || f.file_name || '', f.document_type || f.folder || '', f.year || ''
      ].join('|')));

      // Si la consulta pide pendientes, el KPI de archivos debe respetar exactamente
      // el mismo subconjunto de parques mostrado en la respuesta. Antes mostraba el
      // total nacional del tipo documental, lo que podía inducir a error.
      if (pending) {
        const resultParkKeys = new Set(statusRows.map(r => C.normalize(r.park.cloud_id || r.park.park)));
        files = files.filter(f => resultParkKeys.has(C.normalize(
          f.__park?.cloud_id || f.__park?.park || f.park || ''
        )));
      }

      const commonFilters = {
        region: parsed.region || '',
        park: parsed.entities?.park?.label || '',
        document: documentName,
        status: pending ? 'pending' : ''
      };

      if (documentName && !physical) {
        const summary = statusRows.reduce((a,r)=>{a[r.status.group]=(a[r.status.group]||0)+1;return a;},
          {integrated:0,pending:0,validating:0,na:0});
        const regionText = parsed.region ? ` en ${parsed.region}` : '';
        const title = pending ? `${documentName} pendientes${regionText}` : `${documentName}${regionText}`;
        if (!statusRows.length) return C.result(title,
          `No encontré parques con un estatus de ${documentName}${regionText} dentro de la información Top 23 visible para tu perfil.`,
          {note:'No significa necesariamente que no existan archivos; no hubo coincidencia en el estatus consolidado.',
           actions:[{label:'Abrir Top 23',page:'top23',filters:commonFilters},{label:'Abrir Biblioteca',page:'documentos',filters:commonFilters}]});
        return C.result(title,
          `Encontré ${C.number(statusRows.length)} parque${statusRows.length===1?'':'s'} con información de ${documentName}${regionText}.`,
          {html:`<div class="intel-result-grid">
            <div class="intel-result-card"><small>Integrados</small><strong>${C.number(summary.integrated)}</strong></div>
            <div class="intel-result-card"><small>Pendientes</small><strong>${C.number(summary.pending)}</strong></div>
            <div class="intel-result-card"><small>Por validar</small><strong>${C.number(summary.validating)}</strong></div>
            <div class="intel-result-card"><small>N/A</small><strong>${C.number(summary.na)}</strong></div>
            <div class="intel-result-card"><small>${pending ? 'Archivos físicos vinculados' : 'Archivos físicos'}</small><strong>${C.number(files.length)}</strong></div>
          </div>${C.listHtml(statusRows,r=>({
            title:r.park.park,subtitle:`${r.park.region||''} · ${r.park.administrator||'Por asignar'}`,value:r.status.label
          }))}`,
          actions:[{label:'Abrir Top 23',page:'top23',filters:commonFilters},{label:'Abrir Biblioteca',page:'documentos',filters:commonFilters}],
          context:{domain:'documents',document:documentName,region:parsed.region},
          diagnosticData:{source:'Top 23 + Biblioteca documental',records:statusRows.length,expected:parks.length,formula:'Parque + tipo documental sin duplicados',result:`${statusRows.length} parques · ${files.length} archivos`}});
      }
      return C.result(documentName ? `Archivos de ${documentName}` : 'Biblioteca documental',
        `Encontré ${C.number(files.length)} archivos físicos únicos que coinciden con la consulta.`,
        {html:C.listHtml(files,f=>({
          title:f.filename||f.document_type||'Documento',
          subtitle:`${f.__park?.park||f.park||''} · ${f.document_type||f.folder||''}`,
          value:f.year?String(f.year):''
        })),actions:[{label:'Abrir Biblioteca',page:'documentos',filters:commonFilters}],
        diagnosticData:{source:'Biblioteca documental',records:files.length,formula:'Archivo físico único por ruta/parque/nombre/tipo/año',result:`${files.length} archivos`}});
    }
  });
})(window);
