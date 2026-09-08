(function (global) {
  'use strict';

  const TYPES = [
    'sigop_park','sigop_alert','sigop_unmatched',
    'hydrica','hydrica_unmatched','annual','annual_unmatched',
    'top5_record','top5_admin','top5_region','top5_month',
    'top5_official_region','top5_official_month','top5_executive_close'
  ];

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

  function stripLegacyFiles(park){
    const copy=JSON.parse(JSON.stringify(park||{}));
    delete copy.files;
    delete copy.all_files;
    delete copy.latest_years;
    delete copy.document_counts;
    delete copy.local_url;
    copy.file_count=0;
    return copy;
  }

  function currentRole(){
    return String(global.ParksCloud?.profile?.()?.role||'').toLowerCase();
  }

  async function batchUpsert(client,rows,size=150){
    for(let i=0;i<rows.length;i+=size){
      const chunk=rows.slice(i,i+size);
      const {error}=await client.from('operational_records').upsert(chunk,{onConflict:'dataset_type,record_key'});
      if(error)throw error;
    }
  }

  async function run(){
    if(currentRole()!=='arquitecto')throw new Error('La migración V7.4.0 sólo puede ejecutarla un Arquitecto real.');
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase no está inicializado.');
    if(!global.SIGOP_DATA?.parks?.length)throw new Error('No existe una línea base operativa cargada en la sesión actual.');

    const [{data:catalog,error:parkError},{data:regions,error:regionError}] = await Promise.all([
      client.from('parks').select('id,code,name,commercial_name,administrator_name,region_id,regions(id,code,name,division_id)').in('status',['activo','construccion','adquirido']),
      client.from('regions').select('id,code,name,division_id')
    ]);
    if(parkError)throw parkError;
    if(regionError)throw regionError;

    const parkByAlias=new Map();
    for(const p of catalog||[]){
      for(const a of aliases([p.code,p.name,p.commercial_name])) if(!parkByAlias.has(a)) parkByAlias.set(a,p);
    }
    const regionByAlias=new Map();
    for(const r of regions||[]){
      for(const a of aliases([r.code,r.name])) if(!regionByAlias.has(a)) regionByAlias.set(a,r);
    }

    const findPark=(name,cloudId)=>{
      if(cloudId){const exact=(catalog||[]).find(p=>p.id===cloudId); if(exact)return exact;}
      for(const a of aliases([name])){const p=parkByAlias.get(a); if(p)return p;}
      return null;
    };
    const findRegion=value=>{for(const a of aliases([value])){const r=regionByAlias.get(a); if(r)return r;} return null;};

    const trace=global.PARKS_BOOTSTRAP_META?.traceability||{};
    const sourceFor=(key)=>({
      source_filename: trace[key]?.source_file||null,
      source_updated_at: trace[key]?.updated_at||null
    });
    const me=global.ParksCloud?.session?.()?.user?.id||null;
    const rows=[];
    const unmatched={sigop:[],hydrica:[],annual:[],top5:[]};

    for(const item of global.SIGOP_DATA.parks||[]){
      const p=findPark(item.park,item.cloud_id);
      if(!p){
        unmatched.sigop.push(item.park||'SIN NOMBRE');
        rows.push({dataset_type:'sigop_unmatched',record_key:safeKey(item.park),payload:stripLegacyFiles(item),loaded_by:me,...sourceFor('sigop')});
        continue;
      }
      rows.push({
        dataset_type:'sigop_park',record_key:p.id,park_id:p.id,region_id:p.region_id||p.regions?.id||null,
        division_id:p.regions?.division_id||null,payload:stripLegacyFiles(item),loaded_by:me,...sourceFor('sigop')
      });
    }

    for(const [i,item] of (global.SIGOP_DATA.alerts||[]).entries()){
      const p=item.park?findPark(item.park):null;
      const r=!p&&item.region?findRegion(item.region):null;
      rows.push({
        dataset_type:'sigop_alert',record_key:String(item.key||`${safeKey(item.park||item.region||'NACIONAL')}-${i}`),
        park_id:p?.id||null,region_id:p?.region_id||r?.id||null,
        division_id:p?.regions?.division_id||r?.division_id||null,payload:item,loaded_by:me,...sourceFor('alerts')
      });
    }

    for(const [i,item] of (global.PARKS_HYDRICA_MASTER_SEED?.rows||[]).entries()){
      const p=findPark(item.park);
      if(!p){unmatched.hydrica.push(item.park||`fila-${i+1}`);}
      rows.push({
        dataset_type:p?'hydrica':'hydrica_unmatched',record_key:p?.id||`${safeKey(item.park)}-${i}`,
        park_id:p?.id||null,region_id:p?.region_id||p?.regions?.id||null,division_id:p?.regions?.division_id||null,
        payload:item,loaded_by:me,...sourceFor('hydrica')
      });
    }

    for(const [i,item] of (global.PARKS_ANNUAL_DOCS_2026?.rows||[]).entries()){
      const p=findPark(item.park);
      if(!p){unmatched.annual.push(item.park||`fila-${i+1}`);}
      rows.push({
        dataset_type:p?'annual':'annual_unmatched',record_key:`${global.PARKS_ANNUAL_DOCS_2026?.year||2026}:${p?.id||`${safeKey(item.park)}-${i}`}`,
        park_id:p?.id||null,region_id:p?.region_id||p?.regions?.id||null,division_id:p?.regions?.division_id||null,
        payload:item,loaded_by:me,...sourceFor('annual')
      });
    }

    const top=global.TOP5_DATA||{};
    for(const [i,item] of (top.records||[]).entries()){
      const p=findPark(item.park); const r=p?null:findRegion(item.region);
      if(!p&&!r)unmatched.top5.push(`${item.region||''} / ${item.park||''}`.trim());
      rows.push({
        dataset_type:'top5_record',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.date)}:${i}`,
        park_id:p?.id||null,region_id:p?.region_id||r?.id||null,division_id:p?.regions?.division_id||r?.division_id||null,
        payload:item,loaded_by:me,...sourceFor('top5')
      });
    }
    for(const [i,item] of (top.admins||[]).entries()){
      const r=findRegion(item.region);
      const p=(item.parks||[]).map(name=>findPark(name)).find(Boolean)||null;
      rows.push({dataset_type:'top5_admin',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.region)}:${safeKey(item.administrator)}:${i}`,
        park_id:null,region_id:r?.id||p?.region_id||null,division_id:r?.division_id||p?.regions?.division_id||null,payload:item,loaded_by:me,...sourceFor('top5')});
    }
    for(const [i,item] of (top.regions||[]).entries()){
      const r=findRegion(item.region);
      rows.push({dataset_type:'top5_region',record_key:`${item.year||2026}:${safeKey(item.month)}:${safeKey(item.region)}:${i}`,
        region_id:r?.id||null,division_id:r?.division_id||null,payload:item,loaded_by:me,...sourceFor('top5')});
    }
    for(const [i,item] of (top.months||[]).entries()){
      rows.push({dataset_type:'top5_month',record_key:`${item.year||2026}:${safeKey(item.month)}:${i}`,payload:item,loaded_by:me,...sourceFor('top5')});
    }
    for(const [month,values] of Object.entries(top.officialRegions||{})){
      for(const [region,value] of Object.entries(values||{})){
        const r=findRegion(region);
        rows.push({dataset_type:'top5_official_region',record_key:`${safeKey(month)}:${safeKey(region)}`,
          region_id:r?.id||null,division_id:r?.division_id||null,payload:{month,region,value},loaded_by:me,...sourceFor('top5')});
      }
    }
    for(const [month,value] of Object.entries(top.officialMonths||{})){
      rows.push({dataset_type:'top5_official_month',record_key:safeKey(month),payload:{month,value},loaded_by:me,...sourceFor('top5')});
    }
    if(top.executiveClose&&Object.keys(top.executiveClose).length){
      rows.push({dataset_type:'top5_executive_close',record_key:'current',payload:top.executiveClose,loaded_by:me,...sourceFor('top5')});
    }

    // Limpieza controlada de una migración previa del mismo tipo. No toca otros datos.
    const {error:deleteError}=await client.from('operational_records').delete().in('dataset_type',TYPES);
    if(deleteError)throw deleteError;
    await batchUpsert(client,rows);

    const counts=rows.reduce((acc,row)=>{acc[row.dataset_type]=(acc[row.dataset_type]||0)+1;return acc;},{});
    const result={ok:true,total:rows.length,counts,unmatched};
    console.table(Object.entries(counts).map(([tipo,cantidad])=>({tipo,cantidad})));
    console.log('PARKS ONE V7.4.0 · migración completada',result);
    return result;
  }

  async function verify(){
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase no está inicializado.');
    const {data,error}=await client.from('operational_records').select('dataset_type,id',{count:'exact'});
    if(error)throw error;
    const counts=(data||[]).reduce((a,r)=>{a[r.dataset_type]=(a[r.dataset_type]||0)+1;return a;},{});
    console.table(Object.entries(counts).map(([tipo,cantidad])=>({tipo,cantidad})));
    return counts;
  }

  global.ParksMigrationV740={run,verify};
})(window);
