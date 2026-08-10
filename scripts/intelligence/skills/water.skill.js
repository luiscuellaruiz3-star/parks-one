(function (global) {
  const C = global.ParksIntelligenceCore;

  function ptarStatus(raw, context) {
    const value = C.normalize(raw || '');
    const notes = C.normalize(context || '');
    if (!value || value === 'no' || value.includes('sin ptar') || value.includes('no cuenta')) return 'NO';
    if (value.includes('por confirmar') || value.includes('confirmar') || value.includes('por validar')) return 'POR_CONFIRMAR';
    if (value.includes('no activa') || value.includes('inactiva') || value.includes('fuera de operacion') || value.includes('fuera operacion') || value.includes('no funciona') ||
        notes.includes('ptar no activa') || notes.includes('ptar inactiva') || notes.includes('ptar fuera de operacion') || notes.includes('ptar fuera operacion') || notes.includes('ptar no funciona')) return 'INACTIVA';
    if (value === 'si' || value.includes('operacion') || value.includes('activa') || value.includes('activo') || value.includes('existente')) return 'CONFIRMADA';
    return 'POR_CONFIRMAR';
  }

  global.ParksIntelligenceRegistry.register({
    id:'water',
    execute(parsed) {
      const allRows=C.visibleParks().map(park=>({park,data:park.hydrica||{}}));
      const q=parsed.normalized;
      const entities=parsed.entities||{};
      const conceptId=String(entities.concept?.id||'').toLowerCase();
      const conceptLabel=C.normalize(entities.concept?.label||'');
      const asksPtAr=C.fuzzyIncludes(q,'ptar') || conceptId==='ptar' || conceptLabel.includes('ptar');
      const wantsPending=/\b(por confirmar|confirmar|por validar|pendientes?)\b/.test(q);
      const wantsInactive=/\b(inactiv[ao]s?|fuera de operacion|no funciona|sin operar)\b/.test(q);
      const wantsConfirmed=/\b(confirmad[ao]s?|activ[ao]s?|operando|en operacion)\b/.test(q);

      let rows=allRows;
      if(entities.park?.label){
        const target=C.normalize(entities.park.label);
        rows=rows.filter(item=>C.normalize(item.park.park)===target);
      }else if(parsed.region){
        const target=C.normalize(parsed.region);
        rows=rows.filter(item=>C.normalize(item.park.region)===target);
      }

      let filtered=rows;
      let title='Agua, PTAR y descargas';
      let text='';
      let diagnosticData={source:'Matriz hidráulica',records:0};

      if (asksPtAr) {
        const classified=rows.map(item=>({
          ...item,
          ptarValue:item.data.ptar||item.park.ptar||'',
          ptarStatus:ptarStatus(item.data.ptar||item.park.ptar||'', [item.data.pendientes,item.data.observaciones,item.data.diferencias].filter(Boolean).join(' · '))
        }));
        const confirmed=classified.filter(item=>item.ptarStatus==='CONFIRMADA');
        const pending=classified.filter(item=>item.ptarStatus==='POR_CONFIRMAR');
        const inactive=classified.filter(item=>item.ptarStatus==='INACTIVA');
        if(wantsPending){
          filtered=pending;
          title='PTAR por confirmar';
          text=`Encontré ${C.number(pending.length)} parques con PTAR pendiente de confirmación dentro de tu alcance.`;
        }else if(wantsInactive){
          filtered=inactive;
          title='PTAR inactivas o fuera de operación';
          text=`Encontré ${C.number(inactive.length)} parques con PTAR inactiva o fuera de operación dentro de tu alcance.`;
        }else{
          filtered=confirmed;
          title=entities.park?.label ? `Información de PTAR · ${entities.park.label}` : 'Parques con PTAR confirmada';
          if(entities.park?.label){
            const item=classified[0];
            const status=item?.ptarStatus||'POR_CONFIRMAR';
            const label=status==='CONFIRMADA'?'confirmada':status==='POR_CONFIRMAR'?'por confirmar':status==='INACTIVA'?'inactiva / fuera de operación':'no registrada';
            filtered=classified;
            text=`${entities.park.label}: PTAR ${label}.`;
          }else{
            text=`Encontré ${C.number(confirmed.length)} parques con PTAR confirmada dentro de tu alcance.` +
              (pending.length ? ` Hay ${C.number(pending.length)} por confirmar.` : '') +
              (inactive.length ? ` ${C.number(inactive.length)} aparecen inactivas o fuera de operación.` : '');
          }
        }
        diagnosticData={
          source:'Matriz hidráulica',records:filtered.length,
          expected:rows.length,
          formula:'Clasificación PTAR: confirmada / por confirmar / inactiva / no registrada',
          calculation:`Confirmadas ${confirmed.length} · Por confirmar ${pending.length} · Inactivas ${inactive.length}`,
          result:`${filtered.length} resultado(s) mostrados`
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
        if(entities.park?.label){
          title=`Información hídrica · ${entities.park.label}`;
          text=`Información hidráulica registrada para ${entities.park.label}.`;
        }else{
          text=`Encontré ${C.number(filtered.length)} parques dentro de tu alcance para la consulta hidráulica.`;
        }
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
