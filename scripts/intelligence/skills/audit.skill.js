(function (global) {
  const C=global.ParksIntelligenceCore;
  global.ParksIntelligenceRegistry.register({
    id:'audit',
    async execute(parsed){
      if(C.getRole()!=='arquitecto') return C.restriction(
        'La consulta detallada de bitácora está reservada para el Arquitecto.');
      const cfg=global.PARKS_CONFIG||{};
      if(!global.supabase?.createClient) return C.result('Bitácora','Supabase no está disponible.');
      const sb=global.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
      let request=sb.from('audit_events').select('*').order('created_at',{ascending:false}).limit(50);
      if(parsed.normalized.includes('hoy')) request=request.gte('created_at',`${new Date().toISOString().slice(0,10)}T00:00:00`);
      const {data,error}=await request;
      if(error) return C.result('Bitácora','No fue posible consultar la bitácora.',{note:error.message});
      const rows=data||[];
      return C.result('Actividad registrada',`Encontré ${C.number(rows.length)} movimientos recientes.`,
        {html:C.listHtml(rows,r=>({
          title:`${r.actor_name||'Usuario'} · ${r.action||'Acción'}`,
          subtitle:`${new Date(r.created_at).toLocaleString('es-MX')} · ${r.park_name||r.document_name||r.message||''}`,
          value:r.result||''
        })),actions:[{label:'Abrir Bitácora',page:'auditoria'}]});
    }
  });
})(window);
