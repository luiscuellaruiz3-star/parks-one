(function (global) {
  const C = global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'water',
    execute(parsed) {
      const rows=C.visibleParks().map(park=>({park,data:park.hydrica||{}}));
      const q=parsed.normalized;
      let filtered=rows;
      if (C.fuzzyIncludes(q,'ptar')) {
        filtered=rows.filter(item=>{
          const value=C.normalize(item.data.ptar||item.park.ptar||'');
          if (!value || value==='no' || value.includes('sin ptar') || value.includes('no cuenta')) return false;
          return value==='si'||value.includes('operacion')||value.includes('activa')||
            value.includes('activo')||value.includes('por confirmar')||
            value.includes('confirmar')||value.includes('existente');
        });
      } else if (C.fuzzyIncludes(q,'pozo')) {
        filtered=rows.filter(item=>C.normalize(item.data.pozo||'').startsWith('si'));
      } else if (C.fuzzyIncludes(q,'descarga')) {
        filtered=rows.filter(item=>String(item.data.tipo_descarga||item.park.discharge||'').trim());
      }
      return C.result('Agua, PTAR y descargas',
        `Encontré ${C.number(filtered.length)} parques que coinciden con la consulta hidráulica.`,
        {html:C.listHtml(filtered,item=>({
          title:item.park.park,
          subtitle:`${item.park.region||''} · ${item.data.suministro||item.park.supply||'Suministro por validar'}`,
          value:item.data.ptar||item.park.ptar||'Por validar'
        })),actions:[{label:'Abrir módulo de Agua',page:'agua'}]});
    }
  });
})(window);
