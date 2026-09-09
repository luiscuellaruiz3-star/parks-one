(function(global){
  'use strict';

  const TOP5_TYPES=[
    'top5_record','top5_admin','top5_region','top5_month',
    'top5_official_region','top5_official_month','top5_executive_close'
  ];
  const HYDRICA_TYPES=['hydrica','hydrica_unmatched'];

  function norm(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  }

  function aliases(values){
    const out=new Set();
    for(const value of values||[]){
      const n=norm(value); if(!n)continue;
      out.add(n);
      out.add(n.replace(/\b(PARQUE INDUSTRIAL|INDUSTRIAL PARK|PARQUE|PARK)\b/g,' ').replace(/\s+/g,' ').trim());
    }
    return [...out].filter(Boolean);
  }

  function safeKey(value){
    return norm(value).replace(/\s+/g,'-').slice(0,180)||'SIN-CLAVE';
  }

  function role(){
    return String(global.ParksCloud?.profile?.()?.role||'').toLowerCase();
  }

  function assertArchitect(){
    if(role()!=='arquitecto')throw new Error('Solo el Arquitecto del Sistema puede sincronizar fuentes operativas nacionales.');
  }

  async function batchUpsert(client,rows,size=150){
    for(let i=0;i<rows.length;i+=size){
      const {error}=await client.from('operational_records').upsert(rows.slice(i,i+size),{onConflict:'dataset_type,record_key'});
      if(error)throw error;
    }
  }

  async function replaceTypes(client,types,rows){
    const {error:deleteError}=await client.from('operational_records').delete().in('dataset_type',types);
    if(deleteError)throw deleteError;
    if(rows.length)await batchUpsert(client,rows);
  }

  async function catalogContext(client){
    const [{data:parks,error:parkError},{data:regions,error:regionError}]=await Promise.all([
      client.from('parks').select('id,code,name,commercial_name,region_id,regions(id,code,name,division_id)').in('status',['activo','construccion','adquirido']),
      client.from('regions').select('id,code,name,division_id')
    ]);
    if(parkError)throw parkError;
    if(regionError)throw regionError;

    const parkByAlias=new Map();
    for(const p of parks||[]){
      for(const a of aliases([p.code,p.name,p.commercial_name]))if(!parkByAlias.has(a))parkByAlias.set(a,p);
    }

    // Alias puntual validado durante la migración V7.4.0A:
    // la matriz hídrica usa COACALCO II y el catálogo histórico COACLCO II.
    const coacalco=parkByAlias.get(norm('COACLCO II'))||parkByAlias.get(norm('COACALCO II'));
    if(coacalco)parkByAlias.set(norm('COACALCO II'),coacalco);

    const regionByAlias=new Map();
    for(const r of regions||[]){
      for(const a of aliases([r.code,r.name]))if(!regionByAlias.has(a))regionByAlias.set(a,r);
    }

    const sigopCloudByAlias=new Map();
    for(const item of global.SIGOP_DATA?.parks||[]){
      if(!item?.cloud_id)continue;
      for(const a of aliases([item.park,item.code,item.commercial_name])){
        if(!sigopCloudByAlias.has(a))sigopCloudByAlias.set(a,item.cloud_id);
      }
    }

    const findPark=(name,cloudId)=>{
      if(cloudId){
        const exact=(parks||[]).find(p=>String(p.id)===String(cloudId));
        if(exact)return exact;
      }
      for(const a of aliases([name])){
        const direct=parkByAlias.get(a);
        if(direct)return direct;
        const id=sigopCloudByAlias.get(a);
        if(id){
          const reconciled=(parks||[]).find(p=>String(p.id)===String(id));
          if(reconciled)return reconciled;
        }
      }
      return null;
    };

    const findRegion=value=>{
      for(const a of aliases([value])){
        const r=regionByAlias.get(a);
        if(r)return r;
      }
      return null;
    };

    return {parks:parks||[],regions:regions||[],findPark,findRegion};
  }

  function sourceMeta(key){
    const trace=global.PARKS_BOOTSTRAP_META?.traceability||{};
    return {
      source_filename:trace[key]?.source_file||null,
      source_updated_at:trace[key]?.updated_at||new Date().toISOString()
    };
  }

  async function syncTop5(){
    assertArchitect();
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase no está inicializado.');
    const {findPark,findRegion}=await catalogContext(client);
    const me=global.ParksCloud?.session?.()?.user?.id||null;
    const top=global.TOP5_DATA||{};
    const rows=[];

    for(const [i,item] of (top.records||[]).entries()){
      const p=findPark(item.park); const r=p?null:findRegion(item.region);
      rows.push({
        dataset_type:'top5_record',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.date)}:${i}`,
        park_id:p?.id||null,region_id:p?.region_id||r?.id||null,
        division_id:p?.regions?.division_id||r?.division_id||null,
        payload:item,loaded_by:me,...sourceMeta('top5')
      });
    }

    for(const [i,item] of (top.admins||[]).entries()){
      const r=findRegion(item.region);
      const p=(item.parks||[]).map(name=>findPark(name)).find(Boolean)||null;
      rows.push({
        dataset_type:'top5_admin',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.region)}:${safeKey(item.administrator)}:${i}`,
        region_id:r?.id||p?.region_id||null,division_id:r?.division_id||p?.regions?.division_id||null,
        payload:item,loaded_by:me,...sourceMeta('top5')
      });
    }

    for(const [i,item] of (top.regions||[]).entries()){
      const r=findRegion(item.region);
      rows.push({
        dataset_type:'top5_region',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.region)}:${i}`,
        region_id:r?.id||null,division_id:r?.division_id||null,
        payload:item,loaded_by:me,...sourceMeta('top5')
      });
    }

    for(const [i,item] of (top.months||[]).entries()){
      rows.push({dataset_type:'top5_month',record_key:`${item.year||2026}:${safeKey(item.month)}:${i}`,payload:item,loaded_by:me,...sourceMeta('top5')});
    }

    for(const [month,values] of Object.entries(top.officialRegions||{})){
      for(const [region,value] of Object.entries(values||{})){
        const r=findRegion(region);
        rows.push({
          dataset_type:'top5_official_region',record_key:`${safeKey(month)}:${safeKey(region)}`,
          region_id:r?.id||null,division_id:r?.division_id||null,
          payload:{month,region,value},loaded_by:me,...sourceMeta('top5')
        });
      }
    }

    for(const [month,value] of Object.entries(top.officialMonths||{})){
      rows.push({dataset_type:'top5_official_month',record_key:safeKey(month),payload:{month,value},loaded_by:me,...sourceMeta('top5')});
    }

    if(top.executiveClose&&Object.keys(top.executiveClose).length){
      rows.push({dataset_type:'top5_executive_close',record_key:'current',payload:top.executiveClose,loaded_by:me,...sourceMeta('top5')});
    }

    await replaceTypes(client,TOP5_TYPES,rows);
    console.info(`PARKS ONE V7.4.0B · Top 5 sincronizado: ${rows.length} registros operativos.`);
    return rows.length;
  }

  async function syncHydrica(){
    assertArchitect();
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase no está inicializado.');
    const {findPark}=await catalogContext(client);
    const me=global.ParksCloud?.session?.()?.user?.id||null;
    const rows=[];
    let unmatched=0;

    for(const [i,item] of (global.PARKS_HYDRICA_MASTER_SEED?.rows||[]).entries()){
      const p=findPark(item.park);
      if(!p)unmatched++;
      rows.push({
        dataset_type:p?'hydrica':'hydrica_unmatched',
        record_key:p?.id||`${safeKey(item.park)}-${i}`,
        park_id:p?.id||null,region_id:p?.region_id||p?.regions?.id||null,
        division_id:p?.regions?.division_id||null,
        payload:item,loaded_by:me,...sourceMeta('hydrica')
      });
    }

    await replaceTypes(client,HYDRICA_TYPES,rows);
    console.info(`PARKS ONE V7.4.0B · Hídrica sincronizada: ${rows.length-unmatched} conciliados, ${unmatched} sin conciliar.`);
    return {total:rows.length,matched:rows.length-unmatched,unmatched};
  }

  global.ParksOperationalSync=Object.freeze({syncTop5,syncHydrica});
})(window);
