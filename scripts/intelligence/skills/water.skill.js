(function (global) {
  const C = global.ParksIntelligenceCore;

  function ptarStatus(raw) {
    const value = C.normalize(raw || '');
    if (!value || value === 'no' || value.includes('sin ptar') || value.includes('no cuenta')) return 'NO';
    if (value.includes('por confirmar') || value.includes('confirmar') || value.includes('por validar')) return 'POR_CONFIRMAR';
    if (value.includes('no activa') || value.includes('inactiva') || value.includes('fuera de operacion') || value.includes('fuera operacion')) return 'INACTIVA';
    if (value === 'si' || value.includes('operacion') || value.includes('activa') || value.includes('activo') || value.includes('existente')) return 'CONFIRMADA';
    return 'POR_CONFIRMAR';
  }

  global.ParksIntelligenceRegistry.register({
    id:'water',
    execute(parsed) {
      const rows=C.visibleParks().map(park=>({park,data:park.hydrica||{}}));
      const q=parsed.normalized;
      let filtered=rows;
      let title='Agua, PTAR y descargas';
      let text='';
      let diagnosticData={source:'Matriz hidráulica',records:0};

      if (C.fuzzyIncludes(q,'ptar')) {
        const classified=rows.map(item=>({
          ...item,
          ptarValue:item.data.ptar||item.park.ptar||'',
          ptarStatus:ptarStatus(item.data.ptar||item.park.ptar||'')
        }));
        const confirmed=classified.filter(item=>item.ptarStatus==='CONFIRMADA');
        const pending=classified.filter(item=>item.ptarStatus==='POR_CONFIRMAR');
        const inactive=classified.filter(item=>item.ptarStatus==='INACTIVA');
        filtered=confirmed;
        title='Parques con PTAR confirmada';
        text=`Encontré ${C.number(confirmed.length)} parques con PTAR confirmada dentro de tu alcance.` +
          (pending.length ? ` Hay ${C.number(pending.length)} por confirmar.` : '') +
          (inactive.length ? ` ${C.number(inactive.length)} aparecen inactivas o fuera de operación.` : '');
        diagnosticData={
          source:'Matriz hidráulica',records:confirmed.length,
          expected:rows.length,
          formula:'PTAR confirmada; no incluye Por confirmar ni inactivas',
          calculation:`Confirmadas ${confirmed.length} · Por confirmar ${pending.length} · Inactivas ${inactive.length}`,
          result:`${confirmed.length} PTAR confirmadas`
        };
      } else if (C.fuzzyIncludes(q,'pozo')) {
        filtered=rows.filter(item=>C.normalize(item.data.pozo||'').startsWith('si'));
        title='Parques con pozo';
        text=`Encontré ${C.number(filtered.length)} parques con pozo registrado dentro de tu alcance.`;
        diagnosticData.records=filtered.length;
      } else if (C.fuzzyIncludes(q,'descarga')) {
        filtered=rows.filter(item=>String(item.data.tipo_descarga||item.park.discharge||'').trim());
        title='Parques con información de descarga';
        text=`Encontré ${C.number(filtered.length)} parques con información de descarga dentro de tu alcance.`;
        diagnosticData.records=filtered.length;
      } else {
        text=`Encontré ${C.number(filtered.length)} parques dentro de tu alcance para la consulta hidráulica.`;
        diagnosticData.records=filtered.length;
      }

      return C.result(title, text,
        {html:C.listHtml(filtered,item=>({
          title:item.park.park,
          subtitle:`${item.park.region||''} · ${item.data.suministro||item.park.supply||'Suministro por validar'}`,
          value:item.data.ptar||item.park.ptar||item.data.tipo_descarga||item.data.pozo||'Por validar'
        })),actions:[{label:'Abrir módulo de Agua',page:'agua'}],diagnosticData});
    }
  });
})(window);
