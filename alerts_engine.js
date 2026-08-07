(function(global){
  'use strict';

  const STATE_DATASET='alerts:state';
  const UPCOMING_DAYS=60;
  let lifecycle={version:1,started_at:'',active:{},resolved:[],last_diff:null};
  let prepared=[];
  let syncTimer=null;
  let lastSyncHash='';

  const norm=value=>String(value??'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();

  const DAY=86400000;

  function currentRole(){
    return String(
      global.ParksPermissions?.currentRole?.() ||
      global.ParksCloud?.profile?.()?.role ||
      'consulta'
    ).toLowerCase();
  }

  function accessScope(){
    return global.ParksCloud?.accessScope?.() || {};
  }

  function normalizeRole(role){
    const aliases={
      architect:'arquitecto',
      executive:'direccion',
      administrator:'administrador',
      operations:'divisional'
    };
    const clean=String(role||'').toLowerCase();
    return aliases[clean]||clean;
  }

  function alertDivision(alert){
    if(alert?.division)return String(alert.division);
    const park=(global.D?.parks||global.C?.parks||global.SIGOP_DATA?.parks||[])
      .find(p=>norm(p.park)===norm(alert?.park));
    return String(park?.division||park?.division_name||'');
  }

  function alertRegion(alert){
    if(alert?.region)return String(alert.region);
    const park=(global.D?.parks||global.C?.parks||global.SIGOP_DATA?.parks||[])
      .find(p=>norm(p.park)===norm(alert?.park));
    return String(park?.region||'');
  }

  function isAlertVisible(alert){
    const role=normalizeRole(currentRole());
    const scope=accessScope();

    if(['arquitecto','divisional','direccion','director','ceo','consulta'].includes(role)){
      return true;
    }

    if(role==='regional'){
      const userDivision=norm(scope.division_code||scope.division_name||scope.division_id||'');
      const userRegion=norm(scope.region_code||scope.region_name||scope.region_id||'');
      const targetDivision=norm(alertDivision(alert));
      const targetRegion=norm(alertRegion(alert));

      if(userDivision&&targetDivision)return userDivision===targetDivision;
      if(userRegion&&targetRegion)return userRegion===targetRegion;

      // Si el perfil no tiene todavía alcance estructurado, no ampliamos
      // permisos artificialmente: se respeta el padrón visible ya cargado.
      return visibleParks().some(p=>norm(p.park)===norm(alert.park));
    }

    if(role==='administrador'){
      const parkName=norm(scope.park_name||scope.park_code||'');
      if(parkName)return norm(alert.park)===parkName;

      // Algunos administradores tienen varios parques; cuando el alcance
      // ya viene filtrado por Supabase, sólo puede ver alertas de ese padrón.
      return visibleParks().some(p=>norm(p.park)===norm(alert.park));
    }

    return false;
  }

  function canFollowAlert(alert){
    const role=normalizeRole(currentRole());
    if(['arquitecto','divisional'].includes(role))return true;
    if(role!=='regional')return false;

    const scope=accessScope();
    const userDivision=norm(scope.division_code||scope.division_name||scope.division_id||'');
    const userRegion=norm(scope.region_code||scope.region_name||scope.region_id||'');
    const targetDivision=norm(alertDivision(alert));
    const targetRegion=norm(alertRegion(alert));

    if(userDivision&&targetDivision)return userDivision===targetDivision;
    if(userRegion&&targetRegion)return userRegion===targetRegion;
    return isAlertVisible(alert);
  }

  function scopeLabel(){
    const role=normalizeRole(currentRole());
    const scope=accessScope();

    if(role==='regional'){
      return `Mi alcance regional${scope.division_name?` · ${scope.division_name}`:scope.region_name?` · ${scope.region_name}`:''}`;
    }
    if(role==='administrador')return 'Mis parques';
    if(role==='divisional')return 'Nacional · seguimiento operativo';
    if(role==='arquitecto')return 'Nacional · control total';
    if(['direccion','director','ceo','consulta'].includes(role))return 'Nacional · solo lectura';
    return 'Alcance autorizado';
  }

  function todayStart(){
    const d=new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate());
  }

  function visibleParks(){
    return (global.D?.parks||global.C?.parks||global.SIGOP_DATA?.parks||[]).filter(Boolean);
  }

  function parkMap(){
    const map=new Map();
    visibleParks().forEach(park=>{
      map.set(norm(park.park),park);
      const compact=norm(park.park).replace(/\b(PARK|PARQUE|INDUSTRIAL)\b/g,' ').replace(/\s+/g,' ').trim();
      if(compact&&!map.has(compact))map.set(compact,park);
    });
    return map;
  }

  function findPark(name,map){
    const exact=map.get(norm(name));
    if(exact)return exact;
    const compact=norm(name).replace(/\b(PARK|PARQUE|INDUSTRIAL)\b/g,' ').replace(/\s+/g,' ').trim();
    if(map.has(compact))return map.get(compact);
    const candidates=visibleParks().filter(park=>{
      const other=norm(park.park).replace(/\b(PARK|PARQUE|INDUSTRIAL)\b/g,' ').replace(/\s+/g,' ').trim();
      return compact.length>=5&&(other===compact||other.includes(compact)||compact.includes(other));
    });
    return candidates.length===1?candidates[0]:null;
  }

  function stableKey(parts){
    return parts.map(norm).join('|');
  }

  function alertObject(props){
    return {
      key:props.key,
      type:props.type,
      severity:props.severity,
      park:props.park||'',
      region:props.region||'',
      division:props.division||'',
      administrator:props.administrator||'',
      document:props.document||'',
      message:props.message||'',
      due:props.due||'',
      due_precision:props.due_precision||'',
      source:props.source||'',
      file:props.file||null,
      requirement_number:props.requirement_number||null,
      annual_year:props.annual_year||null
    };
  }

  function annualDocumentMatches(file,key){
    const text=norm([
      file?.document_type,
      file?.folder,
      file?.filename
    ].filter(Boolean).join(' '));
    const number=Number(file?.document_number)||0;

    if(key==='predial')return number===1||text.includes('PREDIAL');
    if(key==='uso_suelo')return number===5||text.includes('USO DE SUELO')||text.includes('USO SUELO');
    if(key==='proteccion_civil'){
      return [6,7].includes(number)||text.includes('PROTECCION CIVIL');
    }
    return false;
  }

  function fileIsPublished(file){
    const workflow=String(file?.workflow_status||'').toLowerCase();
    const status=String(file?.status||'').toLowerCase();
    const publication=String(file?.publication||'').toLowerCase();

    if(publication==='direct')return true;
    if(['aprobado','approved'].some(v=>workflow.includes(v)))return true;
    if(['integrado','vigente'].some(v=>status.includes(v)))return true;

    // Evidencia histórica de 2026 cargada antes del workflow.
    if(!file?.workflow_managed && Number(file?.year)>=2026)return true;
    return false;
  }

  function hasCurrentAnnualFile(park,key,year){
    return (park.files||[]).some(file=>
      file?.is_current!==false &&
      Number(file?.year)===year &&
      annualDocumentMatches(file,key) &&
      fileIsPublished(file)
    );
  }

  function annualAlerts(){
    const annual=global.PARKS_ANNUAL_DOCS_2026;
    if(!annual?.rows?.length)return [];

    const year=Number(annual.year);
    const map=parkMap();
    const docs=[
      ['predial','Predial'],
      ['uso_suelo','Uso de Suelo'],
      ['proteccion_civil','Protección Civil']
    ];
    const alerts=[];

    for(const row of annual.rows){
      const park=findPark(row.park,map);
      if(!park)continue; // respeta alcance del perfil
      for(const [key,label] of docs){
        const currentByFile=hasCurrentAnnualFile(park,key,year);
        const currentBySeed=row[key]==='current';
        if(currentByFile||currentBySeed)continue;

        if(row[key]==='process'){
          alerts.push(alertObject({
            key:stableKey(['annual',year,row.park,key]),
            type:'annual_in_process',
            severity:'medium',
            park:park.park,
            region:park.region||row.region,
            division:park.division||park.division_name||'',
            administrator:park.administrator||row.administrator,
            document:label,
            message:`Actualización ${year} reportada EN PROCESO.`,
            source:annual.source,
            annual_year:year
          }));
        }else{
          alerts.push(alertObject({
            key:stableKey(['annual',year,row.park,key]),
            type:'annual_missing',
            severity:'high',
            park:park.park,
            region:park.region||row.region,
            division:park.division||park.division_name||'',
            administrator:park.administrator||row.administrator,
            document:label,
            message:`No se tiene registrada la actualización ${year}.`,
            source:annual.source,
            annual_year:year
          }));
        }
      }

      // El archivo fuente reporta explícitamente estas vigencias por mes.
      const note=norm(row.notes);
      const months={
        ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,
        JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12
      };
      if(note.includes('VIGENCIA')&&note.includes('PROTECCION CIVIL')){
        const monthName=Object.keys(months).find(m=>note.includes(m));
        if(monthName){
          const month=months[monthName];
          const today=todayStart();
          const endOfMonth=new Date(year,month,0);
          const dayDiff=Math.ceil((endOfMonth-today)/DAY);

          if(dayDiff>=0&&dayDiff<=UPCOMING_DAYS){
            alerts.push(alertObject({
              key:stableKey(['reported-month-expiry',year,row.park,'proteccion civil',month]),
              type:'expiry_upcoming',
              severity:'high',
              park:park.park,
              region:park.region||row.region,
              division:park.division||park.division_name||'',
              administrator:park.administrator||row.administrator,
              document:'Protección Civil',
              message:`Vigencia reportada hasta ${monthName.toLowerCase()} ${year}.`,
              due:`${year}-${String(month).padStart(2,'0')}`,
              due_precision:'month',
              source:annual.source
            }));
          }else if(dayDiff<0){
            alerts.push(alertObject({
              key:stableKey(['reported-month-expiry',year,row.park,'proteccion civil',month]),
              type:'expiry_overdue',
              severity:'critical',
              park:park.park,
              region:park.region||row.region,
              division:park.division||park.division_name||'',
              administrator:park.administrator||row.administrator,
              document:'Protección Civil',
              message:`La vigencia reportada hasta ${monthName.toLowerCase()} ${year} ya concluyó.`,
              due:`${year}-${String(month).padStart(2,'0')}`,
              due_precision:'month',
              source:annual.source
            }));
          }
        }
      }
    }

    return alerts;
  }

  function exactExpiryAlerts(){
    const alerts=[];
    const today=todayStart();

    for(const park of visibleParks()){
      for(const file of (park.files||[])){
        if(file?.is_current===false||!file?.expiry)continue;
        const due=new Date(`${String(file.expiry).slice(0,10)}T00:00:00`);
        if(Number.isNaN(due.getTime()))continue;
        const days=Math.ceil((due-today)/DAY);
        const document=file.document_type||file.folder||'Documento';

        if(days<0){
          alerts.push(alertObject({
            key:stableKey(['expiry',park.park,document,String(file.expiry).slice(0,10)]),
            type:'expiry_overdue',
            severity:'critical',
            park:park.park,
            region:park.region,
            division:park.division||park.division_name||'',
            administrator:park.administrator,
            document,
            message:`Vencido hace ${Math.abs(days)} día${Math.abs(days)===1?'':'s'}.`,
            due:String(file.expiry).slice(0,10),
            due_precision:'date',
            source:'Biblioteca documental',
            file
          }));
        }else if(days<=30){
          alerts.push(alertObject({
            key:stableKey(['expiry',park.park,document,String(file.expiry).slice(0,10)]),
            type:'expiry_upcoming',
            severity:'high',
            park:park.park,
            region:park.region,
            division:park.division||park.division_name||'',
            administrator:park.administrator,
            document,
            message:`Vence en ${days} día${days===1?'':'s'}.`,
            due:String(file.expiry).slice(0,10),
            due_precision:'date',
            source:'Biblioteca documental',
            file
          }));
        }else if(days<=UPCOMING_DAYS){
          alerts.push(alertObject({
            key:stableKey(['expiry',park.park,document,String(file.expiry).slice(0,10)]),
            type:'expiry_upcoming',
            severity:'medium',
            park:park.park,
            region:park.region,
            division:park.division||park.division_name||'',
            administrator:park.administrator,
            document,
            message:`Vence en ${days} días.`,
            due:String(file.expiry).slice(0,10),
            due_precision:'date',
            source:'Biblioteca documental',
            file
          }));
        }
      }
    }
    return alerts;
  }

  function workflowAlerts(){
    const alerts=[];
    const requests=typeof global.getRequests==='function'?global.getRequests():[];

    for(const request of requests){
      if(request.status==='En revisión'){
        alerts.push(alertObject({
          key:stableKey(['review',request.id||request.park,request.document,request.filename]),
          type:'approval_pending',
          severity:'medium',
          park:request.park,
          region:request.region||'',
          administrator:request.uploadedBy||'',
          document:request.document,
          message:'Documento cargado por Administrador pendiente de aprobación.',
          source:'Flujos y aprobaciones'
        }));
      }
      if(request.status==='Devuelto'){
        alerts.push(alertObject({
          key:stableKey(['returned',request.id||request.park,request.document,request.filename]),
          type:'document_returned',
          severity:'critical',
          park:request.park,
          region:request.region||'',
          administrator:request.uploadedBy||'',
          document:request.document,
          message:request.reviewNotes
            ? `Documento devuelto: ${request.reviewNotes}`
            : 'Documento devuelto; requiere corrección y nueva carga.',
          source:'Flujos y aprobaciones'
        }));
      }
    }
    return alerts;
  }

  function computeCurrent(){
    const all=[...annualAlerts(),...exactExpiryAlerts(),...workflowAlerts()];
    const priority={critical:0,high:1,medium:2};
    const seen=new Map();

    for(const alert of all){
      const existing=seen.get(alert.key);
      if(!existing||priority[alert.severity]<priority[existing.severity]){
        seen.set(alert.key,alert);
      }
    }

    return [...seen.values()]
      .map(alert=>{
        if(!alert.division){
          const park=visibleParks().find(p=>norm(p.park)===norm(alert.park));
          if(park)alert.division=park.division||park.division_name||'';
          if(park&&!alert.region)alert.region=park.region||'';
        }
        return alert;
      })
      .filter(isAlertVisible)
      .sort((a,b)=>{
      const sev=priority[a.severity]-priority[b.severity];
      if(sev)return sev;
      return String(a.region).localeCompare(String(b.region),'es',{numeric:true})||
        String(a.park).localeCompare(String(b.park),'es');
    });
  }

  function prepare(){
    prepared=computeCurrent();
    if(global.D)global.D.alerts=prepared;
    if(global.SIGOP_DATA)global.SIGOP_DATA.alerts=prepared;
    return prepared;
  }

  function currentAlerts(){
    return prepare();
  }

  function activeVisibleKeys(alerts){
    return new Set(alerts.map(a=>a.key));
  }

  function scopeParkNames(){
    return new Set(visibleParks().map(p=>norm(p.park)));
  }

  function stats(alerts=prepared){
    const parks=scopeParkNames();
    const resolved=(lifecycle.resolved||[]).filter(item=>
      !item.alert?.park||parks.has(norm(item.alert.park))
    );
    const avgHours=resolved.length
      ? resolved.reduce((sum,item)=>sum+(Number(item.duration_hours)||0),0)/resolved.length
      : null;

    return {
      critical:alerts.filter(a=>a.severity==='critical').length,
      upcoming:alerts.filter(a=>a.type==='expiry_upcoming').length,
      resolved:resolved.length,
      avgHours
    };
  }

  function averageLabel(hours){
    if(hours===null||hours===undefined)return '—';
    if(hours<24)return `${Math.max(1,Math.round(hours))} h`;
    return `${(hours/24).toFixed(hours<240?1:0)} d`;
  }

  async function loadLifecycle(){
    const client=global.ParksCloud?.client?.();
    if(!client)return lifecycle;

    const {data,error}=await client
      .from('datasets')
      .select('payload')
      .eq('name',STATE_DATASET)
      .maybeSingle();

    if(error){
      console.warn('Alertas lifecycle:',error.message);
      return lifecycle;
    }

    if(data?.payload&&typeof data.payload==='object'){
      lifecycle={
        version:1,
        started_at:data.payload.started_at||'',
        active:data.payload.active||{},
        resolved:Array.isArray(data.payload.resolved)?data.payload.resolved:[],
        last_diff:data.payload.last_diff||null
      };
    }
    return lifecycle;
  }

  async function saveLifecycle(){
    const client=global.ParksCloud?.client?.();
    if(!client)return;
    const userId=global.ParksCloud?.session?.()?.user?.id||null;

    const {error}=await client.from('datasets').upsert({
      name:STATE_DATASET,
      payload:lifecycle,
      source_filename:null,
      updated_by:userId,
      updated_at:new Date().toISOString()
    },{onConflict:'name'});

    if(error)console.warn('Guardar lifecycle alertas:',error.message);
  }

  async function syncLifecycle(alerts=prepared){
    const hash=alerts.map(a=>a.key).sort().join('||');
    if(hash===lastSyncHash)return lifecycle;
    lastSyncHash=hash;

    const now=new Date().toISOString();
    if(!lifecycle.started_at)lifecycle.started_at=now;

    const current=new Map(alerts.map(a=>[a.key,a]));
    const previous=lifecycle.active||{};
    const next={};
    const newKeys=[];
    const resolvedKeys=[];

    for(const [key,alert] of current.entries()){
      const old=previous[key];
      if(!old)newKeys.push(key);
      next[key]={
        first_seen_at:old?.first_seen_at||now,
        last_seen_at:now,
        followup:old?.followup||null,
        alert
      };
    }

    for(const [key,old] of Object.entries(previous)){
      if(current.has(key))continue;
      const first=new Date(old.first_seen_at||now);
      const end=new Date(now);
      const hours=Math.max(0,(end-first)/3600000);
      lifecycle.resolved.push({
        key,
        first_seen_at:old.first_seen_at||now,
        resolved_at:now,
        duration_hours:hours,
        alert:old.alert
      });
      resolvedKeys.push(key);
    }

    // Keep enough history for KPIs without unbounded payload growth.
    if(lifecycle.resolved.length>1000){
      lifecycle.resolved=lifecycle.resolved.slice(-1000);
    }

    lifecycle.active=next;
    lifecycle.last_diff={
      at:now,
      new_count:newKeys.length,
      resolved_count:resolvedKeys.length,
      active_count:alerts.length
    };

    await saveLifecycle();
    return lifecycle;
  }

  function scheduleSync(alerts=prepared){
    clearTimeout(syncTimer);
    syncTimer=setTimeout(async()=>{
      try{
        await syncLifecycle(alerts);
        global.renderAlerts?.();
      }catch(error){
        console.warn('Sincronización alertas:',error);
      }
    },300);
  }

  function followupFor(key){
    return lifecycle.active?.[key]?.followup || null;
  }

  async function saveFollowup(key,{status,note}={}){
    const entry=lifecycle.active?.[key];
    if(!entry)throw new Error('La alerta ya no está activa.');
    if(!canFollowAlert(entry.alert)){
      throw new Error('Tu perfil no tiene permiso para registrar seguimiento en esta alerta.');
    }

    const profile=global.ParksCloud?.profile?.()||{};
    entry.followup={
      status:String(status||'En seguimiento'),
      note:String(note||'').trim(),
      updated_at:new Date().toISOString(),
      updated_by:profile.full_name||profile.email||'Usuario',
      role:normalizeRole(currentRole())
    };
    lifecycle.active[key]=entry;
    await saveLifecycle();
    return entry.followup;
  }

  function followupStats(alerts=prepared){
    let followed=0;
    for(const alert of alerts){
      if(followupFor(alert.key)?.status==='En seguimiento')followed++;
    }
    return {followed};
  }

  function resolvedHistory(){
    const parks=scopeParkNames();
    return (lifecycle.resolved||[])
      .filter(item=>!item.alert?.park||parks.has(norm(item.alert.park)))
      .sort((a,b)=>String(b.resolved_at).localeCompare(String(a.resolved_at)));
  }

  function diff(){
    return lifecycle.last_diff||{
      at:'',
      new_count:0,
      resolved_count:0,
      active_count:prepared.length
    };
  }

  async function init(){
    prepare();
    await loadLifecycle();
    await syncLifecycle(prepared);
    global.renderAlerts?.();
  }

  global.ParksAlertsEngine=Object.freeze({
    prepare,
    init,
    currentAlerts,
    stats,
    averageLabel,
    scheduleSync,
    resolvedHistory,
    diff,
    followupFor,
    saveFollowup,
    followupStats,
    canFollowAlert,
    isAlertVisible,
    scopeLabel,
    currentRole,
    upcomingDays:UPCOMING_DAYS
  });
})(window);
