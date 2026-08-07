(function(global){
  'use strict';

  const state={selection:null,history:[],waterHistory:[],waterRows:[]};
  const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=n=>new Intl.NumberFormat('es-MX').format(Number(n)||0);

  function profileRole(){
    return String(global.ParksCloud?.profile?.()?.role||'').toLowerCase();
  }

  function assertArchitect(){
    if(profileRole()!=='arquitecto')throw new Error('Solo el Arquitecto del Sistema puede ejecutar cargas nacionales.');
  }

  function excelColIndex(ref){
    const letters=String(ref||'').match(/[A-Z]+/i)?.[0]||'A';
    let n=0;
    for(const ch of letters.toUpperCase())n=n*26+(ch.charCodeAt(0)-64);
    return Math.max(0,n-1);
  }

  async function workbookFromZip(buffer){
    if(!global.JSZip)throw new Error('El lector local de Excel no está disponible.');
    const zip=await JSZip.loadAsync(buffer);
    const parser=new DOMParser();

    const shared=[];
    const sharedFile=zip.file('xl/sharedStrings.xml');
    if(sharedFile){
      const xml=parser.parseFromString(await sharedFile.async('text'),'application/xml');
      [...xml.getElementsByTagName('si')].forEach(si=>{
        shared.push([...si.getElementsByTagName('t')].map(t=>t.textContent||'').join(''));
      });
    }

    const wbXml=parser.parseFromString(
      await zip.file('xl/workbook.xml').async('text'),
      'application/xml'
    );
    const relXml=parser.parseFromString(
      await zip.file('xl/_rels/workbook.xml.rels').async('text'),
      'application/xml'
    );

    const rels=new Map(
      [...relXml.getElementsByTagName('Relationship')]
        .map(r=>[r.getAttribute('Id'),r.getAttribute('Target')])
    );

    const SheetNames=[];
    const matrices={};

    for(const sheet of [...wbXml.getElementsByTagName('sheet')]){
      const name=sheet.getAttribute('name')||'Hoja';
      const rid=sheet.getAttribute('r:id')||
        sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      let target=rels.get(rid)||'';
      target=target.replace(/^\/+/,'');
      if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\//,'');
      const sheetFile=zip.file(target);
      if(!sheetFile)continue;

      const sx=parser.parseFromString(await sheetFile.async('text'),'application/xml');
      const matrix=[];

      for(const row of [...sx.getElementsByTagName('row')]){
        const arr=[];
        for(const cell of [...row.getElementsByTagName('c')]){
          const col=excelColIndex(cell.getAttribute('r'));
          const type=cell.getAttribute('t')||'';
          let value=null;

          if(type==='inlineStr'){
            value=[...cell.getElementsByTagName('t')].map(t=>t.textContent||'').join('');
          }else{
            const v=cell.getElementsByTagName('v')[0]?.textContent??'';
            if(type==='s')value=shared[Number(v)]??'';
            else if(type==='str')value=v;
            else if(type==='b')value=v==='1';
            else if(v!=='')value=Number.isNaN(Number(v))?v:Number(v);
          }
          arr[col]=value;
        }
        if(arr.some(v=>v!==undefined&&v!==null&&v!==''))matrix.push(arr);
      }

      SheetNames.push(name);
      matrices[name]=matrix;
    }

    if(!SheetNames.length)throw new Error('El Excel no contiene hojas legibles.');
    return {SheetNames,__matrices:matrices};
  }

  async function workbookFromFile(file){
    const buffer=await file.arrayBuffer();
    if(global.XLSX){
      try{return XLSX.read(buffer,{type:'array'});}
      catch(error){console.warn('SheetJS falló; usando lector local:',error);}
    }
    return workbookFromZip(buffer);
  }

  function matrixFromSheet(workbook,sheetName){
    if(workbook?.__matrices)return workbook.__matrices[sheetName]||[];
    if(!global.XLSX)throw new Error('No existe un lector de hoja disponible.');
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{
      header:1,raw:true,defval:null,blankrows:false
    });
  }

  function headerMap(headers){
    const out=new Map();
    headers.forEach((value,index)=>out.set(norm(value),index));
    return out;
  }

  function findColumn(map,aliases){
    for(const alias of aliases){
      const exact=map.get(norm(alias));
      if(exact!==undefined)return exact;
    }
    for(const [header,index] of map.entries()){
      if(aliases.some(alias=>header.includes(norm(alias))))return index;
    }
    return -1;
  }

  function detectWorkbookModule(workbook,fileName){
    const name=norm(fileName);

    for(const sheetName of workbook.SheetNames){
      const matrix=matrixFromSheet(workbook,sheetName);
      if(!matrix.length)continue;

      // TOP 5 has two header rows and Matutino/Vespertino totals.
      const h0=(matrix[0]||[]).map(norm);
      if(
        h0.some(x=>x.includes('ADMINISTRADOR')) &&
        h0.some(x=>x.includes('MATUTINO TOTAL')) &&
        h0.some(x=>x.includes('VESPERTINO TOTAL'))
      ){
        return {module:'top5',label:'Top 5 operativo',sheetName};
      }

      // Hydrica / guide of calls.
      const headers=(matrix[0]||[]).map(norm);
      const hasPark=headers.some(x=>x==='PARQUE');
      const hasPtAr=headers.some(x=>x.includes('PTAR'));
      const hasSupply=headers.some(x=>x.includes('SUMINISTRA')||x.includes('SUMINISTRO'));
      const hasDischarge=headers.some(x=>x.includes('DESCARGA'));
      if(hasPark && (hasPtAr||hasSupply||hasDischarge)){
        return {module:'water',label:'Agua, PTAR y descargas',sheetName};
      }

      // Users: detection only; creation remains in Users module because Auth credentials are required.
      if(
        headers.some(x=>x.includes('CORREO')||x.includes('EMAIL')) &&
        headers.some(x=>x.includes('ROL')) &&
        headers.some(x=>x.includes('NOMBRE'))
      ){
        return {module:'users',label:'Usuarios',sheetName,requiresUserFlow:true};
      }
    }

    if(name.includes('TOP 5')||name.includes('TOP5'))return {module:'top5',label:'Top 5 operativo',sheetName:workbook.SheetNames[0]};
    if(name.includes('HIDRAUL')||name.includes('PTAR'))return {module:'water',label:'Agua, PTAR y descargas',sheetName:workbook.SheetNames[0]};
    return {module:'unknown',label:'Archivo no reconocido',sheetName:workbook.SheetNames[0]};
  }

  function normalizeRegion(value){
    const s=norm(value);
    const match=s.match(/\bREGION\s*(\d{1,2})\b/);
    if(match)return `R${match[1]}`;
    const compact=s.match(/\bR\s*(\d{1,2})\b/);
    if(compact)return `R${compact[1]}`;
    if(s.includes('T MEX')||s.includes('TMEX')||s.includes('T EMEX'))return 'T-MEX';
    if(s.includes('BALBROS'))return 'GRUPO BALBROS';
    return String(value||'').trim();
  }

  function parseWaterWorkbook(workbook,fileName,sheetName){
    const matrix=matrixFromSheet(workbook,sheetName);
    if(matrix.length<2)throw new Error('El archivo hidráulico no contiene filas de información.');

    const headers=matrix[0]||[];
    const map=headerMap(headers);
    const cRegion=findColumn(map,['Región','Region']);
    const cAdmin=findColumn(map,['Administrador']);
    const cPark=findColumn(map,['Parque']);
    const cParksPays=findColumn(map,['¿Parks paga el agua?','Parks paga el agua']);
    const cClientsPay=findColumn(map,['¿Los clientes pagan el agua directamente al organismo?','Clientes pagan el agua']);
    const cParksSupply=findColumn(map,['¿Parks suministra agua a los clientes?','Parks suministra agua']);
    const cSupply=findColumn(map,['¿Cómo se suministra el agua?','Suministro','Cómo se suministra']);
    const cWell=findColumn(map,['¿El parque cuenta con pozo?','Pozo']);
    const cPtar=findColumn(map,['¿El parque cuenta con PTAR?','PTAR']);
    const cDischargePayer=findColumn(map,['¿Quién paga las descargas?','Quién paga las descargas']);
    const cDischarge=findColumn(map,['¿La descarga es municipal, estatal, federal o privada?','Tipo descarga','Descarga']);
    const cPending=findColumn(map,['Documentos o trámites pendientes','Pendientes']);
    const cSource=findColumn(map,['Fuente utilizada','Fuente']);
    const cDiff=findColumn(map,['Diferencias entre archivos','Diferencias']);
    const cObs=findColumn(map,['Observaciones']);
    const cExtra1=findColumn(map,['Columna1']);
    const cExtra2=findColumn(map,['Columna2']);
    const cUpdated=findColumn(map,['Última actualización','Ultima actualizacion','Fecha de actualización','Fecha actualizacion']);

    if(cPark<0)throw new Error('No encontré la columna Parque en el archivo hidráulico.');

    const rows=[];
    matrix.slice(1).forEach((row,index)=>{
      const park=String(row[cPark]||'').trim();
      if(!park)return;
      rows.push({
        row:index+2,
        region:cRegion>=0?normalizeRegion(row[cRegion]):'',
        administrator:cAdmin>=0?String(row[cAdmin]||'').trim():'',
        park,
        hydrica:{
          parks_paga_agua:cParksPays>=0?String(row[cParksPays]??'').trim():'',
          clientes_pagan_agua:cClientsPay>=0?String(row[cClientsPay]??'').trim():'',
          parks_suministra:cParksSupply>=0?String(row[cParksSupply]??'').trim():'',
          suministro:cSupply>=0?String(row[cSupply]??'').trim():'',
          pozo:cWell>=0?String(row[cWell]??'').trim():'',
          ptar:cPtar>=0?String(row[cPtar]??'').trim():'',
          paga_descargas:cDischargePayer>=0?String(row[cDischargePayer]??'').trim():'',
          tipo_descarga:cDischarge>=0?String(row[cDischarge]??'').trim():'',
          pendientes:cPending>=0?String(row[cPending]??'').trim():'',
          fuente:cSource>=0?String(row[cSource]??'').trim():'',
          diferencias:cDiff>=0?String(row[cDiff]??'').trim():'',
          observaciones:cObs>=0?String(row[cObs]??'').trim():'',
          columna1:cExtra1>=0?String(row[cExtra1]??'').trim():'',
          columna2:cExtra2>=0?String(row[cExtra2]??'').trim():'',
          ultima_actualizacion:cUpdated>=0?String(row[cUpdated]??'').trim():''
        }
      });
    });

    const matched=rows.filter(r=>findPark(r.park)).length;
    return {
      kind:'water',
      module:'water',
      label:'Agua, PTAR y descargas',
      sourceFilename:fileName,
      sheetName,
      updatedAt:new Date().toISOString(),
      records:rows.length,
      matched,
      unmatched:rows.length-matched,
      rows
    };
  }

  function canonicalParkName(value){
    return norm(value)
      .replace(/\bTULTIPARK\b/g,'TULTI PARK')
      .replace(/\bTULTEPARK\b/g,'TULTE PARK')
      .replace(/\bTEPOZOTLAN\b/g,'TEPOZOTLAN')
      .replace(/\s+/g,' ')
      .trim();
  }

  function findPark(name){
    const target=canonicalParkName(name);
    const parks=global.SIGOP_DATA?.parks||[];

    // Únicamente igualdad canónica. Nunca substring/fuzzy:
    // TULTI PARK III no puede terminar usando los datos de TULTI PARK IV.
    const matches=parks.filter(p=>canonicalParkName(p.park)===target);
    return matches.length===1?matches[0]:null;
  }

  function applyWaterSnapshot(snapshot){
    if(!snapshot?.rows)return {matched:0,unmatched:0};

    // Esta colección es la fuente maestra del módulo y conserva TODOS
    // los parques del Excel, aunque alguno aún no exista en el padrón general.
    state.waterRows=snapshot.rows.map(row=>({
      region:row.region||'',
      administrator:row.administrator||'',
      park:row.park||'',
      hydrica:{...(row.hydrica||{})},
      sourceFilename:snapshot.sourceFilename||'',
      updatedAt:snapshot.updatedAt||''
    }));

    let matched=0,unmatched=0;
    snapshot.rows.forEach(row=>{
      const park=findPark(row.park);
      if(!park){unmatched++;return;}
      park.hydrica={...(park.hydrica||{}),...row.hydrica};
      park.hydrica_updated=row.hydrica.ultima_actualizacion || snapshot.updatedAt.slice(0,10);
      park.hydrica_source=snapshot.sourceFilename;
      if(row.region&&!park.region)park.region=row.region;
      if(row.administrator)park.administrator=row.administrator;
      if(row.hydrica.suministro)park.supply=row.hydrica.suministro;
      if(row.hydrica.ptar)park.ptar=row.hydrica.ptar;
      if(row.hydrica.tipo_descarga)park.discharge=row.hydrica.tipo_descarga;
      matched++;
    });
    global.SIGOP_DATA.generated=snapshot.updatedAt.slice(0,10);
    return {matched,unmatched};
  }

  async function saveDataset(name,payload,fileName){
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase todavía no está disponible.');
    const userId=global.ParksCloud?.session?.()?.user?.id||null;
    const {error}=await client.from('datasets').upsert({
      name,
      payload,
      source_filename:fileName||null,
      updated_by:userId,
      updated_at:new Date().toISOString()
    },{onConflict:'name'});
    if(error)throw error;
  }

  async function analyzeFile(file){
    assertArchitect();
    const ext=String(file.name.split('.').pop()||'').toLowerCase();
    if(!['xlsx','xls','csv'].includes(ext)){
      return {
        file,module:'document',
        label:'Biblioteca documental / Top 23',
        note:'Los documentos PDF, Word, imágenes y ZIP se cargan mediante el repositorio documental para conservar Región, Parque y Requisito.'
      };
    }

    const workbook=await workbookFromFile(file);
    const detected=detectWorkbookModule(workbook,file.name);

    if(detected.module==='top5'){
      const snapshot=await global.ParksTop5Importer.analyzeFile(file);
      return {
        file,module:'top5',label:'Top 5 operativo',
        snapshot,
        summary:{
          period:`${snapshot.month} ${snapshot.year}`,
          records:snapshot.records,
          expected:snapshot.expected,
          entities:snapshot.administrators,
          note:`${snapshot.businessDays} días hábiles · meta ${snapshot.expectedPerAdministrator} por Administrador`
        }
      };
    }

    if(detected.module==='water'){
      const snapshot=parseWaterWorkbook(workbook,file.name,detected.sheetName);
      return {
        file,module:'water',label:'Agua, PTAR y descargas',
        snapshot,
        summary:{
          period:'Matriz Hídrica',
          records:snapshot.records,
          expected:snapshot.records,
          entities:snapshot.records,
          note:`${snapshot.records} registros hidráulicos detectados · ${snapshot.matched} enlazados al padrón general · ${snapshot.unmatched} permanecen como registros hidráulicos independientes`
        }
      };
    }

    if(detected.module==='users'){
      return {
        file,module:'users',label:'Usuarios',
        blocked:true,
        note:'El archivo parece ser de usuarios. Por seguridad, las altas y contraseñas siguen administrándose desde el módulo Usuarios.'
      };
    }

    return {
      file,module:'unknown',label:'Archivo no reconocido',
      blocked:true,
      note:'No reconocí una fuente Top 5 ni Agua/PTAR. Para documentos utiliza la carga de repositorio documental.'
    };
  }

  async function commitSelection(selection){
    assertArchitect();
    if(!selection||selection.blocked)throw new Error(selection?.note||'La selección no se puede procesar.');

    if(selection.module==='top5'){
      await global.ParksTop5Importer.commitSnapshot(selection.snapshot);
      await refreshHistory();
      return {
        title:'Top 5 actualizado',
        message:`El cierre ${selection.snapshot.month} ${selection.snapshot.year} ya alimenta Top 5, histórico, Centro de Inteligencia y reporte ejecutivo.`
      };
    }

    if(selection.module==='water'){
      const client=global.ParksCloud?.client?.();

      // Conserva una fotografía del corte anterior para el comparativo.
      if(client){
        const {data:previous}=await client
          .from('datasets')
          .select('payload,source_filename,updated_at')
          .eq('name','hydrica:current')
          .maybeSingle();

        if(previous?.payload){
          const stamp=new Date().toISOString().replace(/[:.]/g,'-');
          await saveDataset(`hydrica:history:${stamp}`,{
            ...previous.payload,
            archived_at:new Date().toISOString()
          },previous.source_filename||'Matriz hídrica anterior');
        }
      }

      const key='hydrica:current';
      await saveDataset(key,selection.snapshot,selection.file.name);
      const result=applyWaterSnapshot(selection.snapshot);
      global.refreshComputedDataFromSources?.();
      await loadWaterHistory();
      await refreshHistory();
      // Refresca todos los consumidores en la misma sesión.
      global.refreshComputedDataFromSources?.();
      global.renderWater?.();
      global.renderIntelligence?.();
      global.renderAlerts?.();

      return {
        title:'Matriz Hídrica actualizada',
        message:`Se guardaron ${selection.snapshot.records} registros hidráulicos. ${result.matched} quedaron enlazados al padrón general y ${result.unmatched} continúan visibles dentro del módulo Agua/PTAR.`
      };
    }

    throw new Error('No existe un adaptador activo para este módulo.');
  }

  async function loadWaterHistory(){
    const client=global.ParksCloud?.client?.();
    if(!client){
      state.waterHistory=[];
      return [];
    }

    const {data,error}=await client
      .from('datasets')
      .select('name,payload,source_filename,updated_at')
      .like('name','hydrica:history:%')
      .order('updated_at',{ascending:false})
      .limit(5);

    if(error){
      console.warn('Histórico hidráulico:',error.message);
      state.waterHistory=[];
      return [];
    }
    state.waterHistory=data||[];
    return state.waterHistory;
  }

  function getWaterHistory(){
    return [...state.waterHistory];
  }

  function currentWaterSnapshot(){
    if(state.waterRows?.length){
      return {
        updatedAt:state.waterRows.map(r=>r.updatedAt).filter(Boolean).sort().at(-1)||global.SIGOP_DATA?.generated||'',
        rows:state.waterRows.map(r=>({
          region:r.region||'',
          administrator:r.administrator||'',
          park:r.park||'',
          hydrica:{...(r.hydrica||{})}
        }))
      };
    }

    const parks=global.SIGOP_DATA?.parks||[];
    return {
      updatedAt:parks.map(p=>p.hydrica_updated).filter(Boolean).sort().at(-1)||global.SIGOP_DATA?.generated||'',
      rows:parks.filter(p=>p.hydrica&&Object.keys(p.hydrica).length).map(p=>({
        region:p.region||'',
        administrator:p.administrator||'',
        park:p.park||'',
        hydrica:{...(p.hydrica||{})}
      }))
    };
  }

  function getWaterRows(){
    const rows=currentWaterSnapshot().rows;
    if(rows?.length)return rows;

    const seed=global.PARKS_HYDRICA_MASTER_SEED;
    return seed?.rows?.length
      ? seed.rows.map(row=>({
          region:row.region||'',
          administrator:row.administrator||'',
          park:row.park||'',
          hydrica:{...(row.hydrica||{})}
        }))
      : [];
  }

  function waterTruthy(value){
    const text=String(value||'').trim().toUpperCase();
    if(!text||text==='NO'||text==='N/A'||text==='NA'||text.includes('POR CONFIRMAR'))return false;
    return /(^|\b)(SI|SÍ)(\b|$)|TIENE/.test(text);
  }

  function waterDischargeKnown(value){
    const text=String(value||'').trim().toUpperCase();
    if(!text||['NA','N/A','NO','POR CONFIRMAR','POR VALIDAR'].includes(text))return false;
    return true;
  }

  function xlsxXmlEscape(value){
    return String(value??'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function xlsxColName(index){
    let n=index+1,out='';
    while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}
    return out;
  }

  function xlsxSheetXml(matrix){
    const rows=matrix.map((row,ri)=>{
      const cells=(row||[]).map((value,ci)=>{
        if(value===null||value===undefined||value==='')return '';
        const ref=`${xlsxColName(ci)}${ri+1}`;
        if(typeof value==='number'&&Number.isFinite(value)){
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        const text=xlsxXmlEscape(value);
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
      }).join('');
      return `<row r="${ri+1}">${cells}</row>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
 <sheetData>${rows}</sheetData>
</worksheet>`;
  }

  async function buildWaterWorkbookBlob(){
    if(!global.JSZip)throw new Error('El generador local de Excel no está disponible.');
    const rows=getWaterRows();
    if(!rows.length)throw new Error('La Matriz Hídrica no tiene registros cargados.');

    const headers=[
      'Región','Administrador','Parque','¿Parks paga el agua?',
      '¿Los clientes pagan el agua directamente al organismo?',
      '¿Parks suministra agua a los clientes?','¿Cómo se suministra el agua?',
      '¿El parque cuenta con pozo?','¿El parque cuenta con PTAR?',
      '¿Quién paga las descargas?',
      '¿La descarga es municipal, estatal, federal o privada?',
      'Documentos o trámites pendientes','Fuente utilizada',
      'Diferencias entre archivos','Observaciones','Columna1','Columna2'
    ];

    const guide=[headers,...rows.map(row=>{
      const h=row.hydrica||{};
      return [
        row.region||'',row.administrator||'',row.park||'',
        h.parks_paga_agua||'',h.clientes_pagan_agua||'',h.parks_suministra||'',
        h.suministro||'',h.pozo||'',h.ptar||'',h.paga_descargas||'',
        h.tipo_descarga||'',h.pendientes||'',h.fuente||'',h.diferencias||'',
        h.observaciones||'',h.columna1||'',h.columna2||''
      ];
    })];

    const regions={};
    guide.slice(1).forEach(r=>{regions[r[0]||'Sin región']=(regions[r[0]||'Sin región']||0)+1;});
    const summary=[
      ['RESUMEN DE VALIDACIÓN','','','',''],
      ['','','','',''],
      ['Indicador','Resultado','','Región','Parques'],
      ['Total de registros hidráulicos',rows.length,'','',''],
      ['Con PTAR identificada',guide.slice(1).filter(r=>waterTruthy(r[8])).length,'','',''],
      ['Con pozo identificado',guide.slice(1).filter(r=>waterTruthy(r[7])).length,'','',''],
      ['Con descarga identificada',guide.slice(1).filter(r=>waterDischargeKnown(r[10])).length,'','',''],
      ['Por confirmar PTAR',guide.slice(1).filter(r=>/POR CONFIRMAR/i.test(String(r[8]||''))).length,'','','']
    ];
    Object.entries(regions).forEach(([region,total],i)=>{
      while(summary.length<=3+i)summary.push(['','','','','']);
      summary[3+i][3]=region;summary[3+i][4]=total;
    });

    const criteria=[
      ['CRITERIOS DE LECTURA Y PRIORIDAD DE FUENTES','','',''],
      ['','','',''],
      ['Prioridad','Fuente','Uso','Interpretación'],
      [1,'SIGOP','Información levantada en campo','Se conserva como dato principal cuando existe.'],
      [2,'Directorio vigente','Región, administrador y contacto','Define responsables actuales.'],
      [3,'Top 23 / Ajuste de responsabilidad de agua','Pagos, suministro y tomas','Se precarga para confirmar.'],
      [4,'Matriz de nomenclaturas','Suministro, pagos y descarga','Se conserva como referencia complementaria.'],
      ['Pendiente','Sin dato registrado','Información no localizada','Debe confirmarse antes de sustituir el dato.'],
      ['Carga','Importación nacional','Excel editable','Guarda el archivo y vuelve a cargarlo para actualizar PARKS ONE.']
    ];

    const zip=new JSZip();
    zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
    zip.folder('_rels').file('.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.folder('xl').file('workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets>
  <sheet name="GUÍA DE LLAMADAS" sheetId="1" r:id="rId1"/>
  <sheet name="RESUMEN" sheetId="2" r:id="rId2"/>
  <sheet name="CRITERIOS" sheetId="3" r:id="rId3"/>
 </sheets>
</workbook>`);
    zip.folder('xl').folder('_rels').file('workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
 <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    zip.folder('xl').file('styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
 <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
 <borders count="1"><border/></borders>
 <cellStyleXfs count="1"><xf/></cellStyleXfs>
 <cellXfs count="1"><xf xfId="0"/></cellXfs>
</styleSheet>`);
    const ws=zip.folder('xl').folder('worksheets');
    ws.file('sheet1.xml',xlsxSheetXml(guide));
    ws.file('sheet2.xml',xlsxSheetXml(summary));
    ws.file('sheet3.xml',xlsxSheetXml(criteria));

    return zip.generateAsync({
      type:'blob',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  async function exportWaterWorkbook(){
    // Prefer SheetJS when it is available, but PARKS ONE no longer depends on it.
    if(global.XLSX){
      try{
        const rows=getWaterRows();
        if(!rows.length)throw new Error('La Matriz Hídrica no tiene registros cargados.');
        const headers=[
          'Región','Administrador','Parque','¿Parks paga el agua?',
          '¿Los clientes pagan el agua directamente al organismo?',
          '¿Parks suministra agua a los clientes?','¿Cómo se suministra el agua?',
          '¿El parque cuenta con pozo?','¿El parque cuenta con PTAR?',
          '¿Quién paga las descargas?',
          '¿La descarga es municipal, estatal, federal o privada?',
          'Documentos o trámites pendientes','Fuente utilizada',
          'Diferencias entre archivos','Observaciones','Columna1','Columna2'
        ];
        const data=rows.map(row=>{
          const h=row.hydrica||{};
          return [row.region||'',row.administrator||'',row.park||'',h.parks_paga_agua||'',
            h.clientes_pagan_agua||'',h.parks_suministra||'',h.suministro||'',h.pozo||'',
            h.ptar||'',h.paga_descargas||'',h.tipo_descarga||'',h.pendientes||'',
            h.fuente||'',h.diferencias||'',h.observaciones||'',h.columna1||'',h.columna2||''];
        });
        const wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,...data]),'GUÍA DE LLAMADAS');
        XLSX.writeFile(wb,`HIDRICA_FINAL_PARKS_ONE_EDITABLE_${new Date().toISOString().slice(0,10)}.xlsx`);
        return;
      }catch(error){
        console.warn('SheetJS export falló; usando generador local:',error);
      }
    }

    const blob=await buildWaterWorkbookBlob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`HIDRICA_FINAL_PARKS_ONE_EDITABLE_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function loadStored(){
    applyMasterSeed();
    const client=global.ParksCloud?.client?.();
    if(!client)return;
    const {data,error}=await client
      .from('datasets')
      .select('name,payload,source_filename,updated_at')
      .like('name','hydrica:%')
      .order('updated_at',{ascending:false});
    if(error)throw error;
    const current=(data||[]).find(row=>row.name==='hydrica:current');
    const currentRows=current?.payload?.rows;

    // Protección de integridad:
    // una carga histórica/incompleta no puede borrar la línea base de 91 registros.
    // Sólo un snapshot suficientemente completo sustituye a la fuente maestra incluida.
    if(Array.isArray(currentRows) && currentRows.length>=80){
      applyWaterSnapshot(current.payload);
    }else if(current?.payload){
      console.warn(
        'Matriz Hídrica guardada ignorada por estar incompleta:',
        Array.isArray(currentRows)?currentRows.length:0,
        'registros. Se conserva la fuente maestra de 91 registros.'
      );
    }

    await loadWaterHistory();
    await refreshHistory();
  }

  async function refreshHistory(){
    const client=global.ParksCloud?.client?.();
    if(!client)return [];
    const {data,error}=await client
      .from('datasets')
      .select('name,source_filename,updated_at,payload')
      .order('updated_at',{ascending:false})
      .limit(12);
    if(error)return [];
    state.history=data||[];
    renderHistory();
    return state.history;
  }

  function moduleFromDataset(row){
    if(String(row.name).startsWith('top5:'))return 'Top 5';
    if(String(row.name).startsWith('hydrica:'))return 'Agua / PTAR';
    return 'Datos';
  }

  function renderHistory(){
    const host=document.getElementById('nationalImportHistory');
    if(!host)return;
    if(!state.history.length){
      host.innerHTML='<div class="empty">Todavía no hay cierres o fuentes tabulares guardadas.</div>';
      return;
    }
    host.innerHTML=state.history.map(row=>{
      const payload=row.payload||{};
      const detail=String(row.name).startsWith('top5:')
        ? `${esc(payload.month||'')} ${esc(payload.year||'')} · ${fmt(payload.administrators||0)} Administradores`
        : String(row.name).startsWith('hydrica:')
          ? `${fmt(payload.records||0)} parques · ${fmt(payload.matched||0)} reconocidos`
          : '';
      return `<div class="national-history-row">
        <div><b>${esc(moduleFromDataset(row))}</b><small>${esc(row.source_filename||row.name)}${detail?' · '+detail:''}</small></div>
        <span>${esc(row.updated_at?new Date(row.updated_at).toLocaleString('es-MX'):'')}</span>
      </div>`;
    }).join('');
  }

  function updateStatusCards(){
    const top5=(global.TOP5_DATA?.months||[]).at(-1);
    const waterRows=getWaterRows();
    const docs=global.C?.files?.length||global.SIGOP_DATA?.metrics?.files||0;
    const map={
      nationalTop5Status:top5?`${top5.month} ${top5.year||2026}`:'Sin cierre',
      nationalDocsStatus:`${fmt(docs)} archivos`,
      nationalWaterStatus:waterRows.length?`${fmt(waterRows.length)} registros`:'Sin fuente',
      nationalAlertsStatus:`Derivadas automáticamente`
    };
    Object.entries(map).forEach(([id,value])=>{
      const el=document.getElementById(id);if(el)el.textContent=value;
    });
  }

  function renderSelection(selection){
    const host=document.getElementById('nationalSmartPreview');
    if(!host)return;
    if(!selection){host.innerHTML='';return;}

    if(selection.blocked){
      host.innerHTML=`<div class="national-detected warn"><b>${esc(selection.label)}</b><p>${esc(selection.note)}</p></div>`;
      return;
    }

    if(selection.module==='document'){
      host.innerHTML=`<div class="national-detected"><b>${esc(selection.label)}</b><p>${esc(selection.note)}</p><button class="btn secondary" type="button" onclick="document.getElementById('nationalFolderInput').click()">Abrir carga documental</button></div>`;
      return;
    }

    const s=selection.summary||{};
    host.innerHTML=`<div class="national-detected">
      <div class="national-detected-head"><div><small>Módulo detectado</small><b>${esc(selection.label)}</b></div><span>${esc(selection.file.name)}</span></div>
      <div class="national-preview-grid">
        <div><small>Periodo / fuente</small><strong>${esc(s.period||'—')}</strong></div>
        <div><small>Registros</small><strong>${fmt(s.records)}</strong></div>
        <div><small>${selection.module==='top5'?'Administradores':selection.module==='water'?'Registros hidráulicos':'Registros'}</small><strong>${fmt(s.entities)}</strong></div>
      </div>
      <p class="meta">${esc(s.note||'')}</p>
      <div class="national-confirm"><button id="nationalCommitFile" class="btn primary" type="button">Actualizar ${esc(selection.label)}</button></div>
    </div>`;
    document.getElementById('nationalCommitFile')?.addEventListener('click',commitFromUi);
  }

  async function chooseFile(file){
    const host=document.getElementById('nationalSmartPreview');
    if(!file?.name)throw new Error('El archivo seleccionado no tiene un nombre válido.');
    if(typeof file.arrayBuffer!=='function')throw new Error('No pude leer el contenido del archivo seleccionado.');
    if(host)host.innerHTML='<div class="national-detected"><b>Analizando archivo…</b><p class="meta">PARKS ONE está identificando el módulo y validando la estructura.</p></div>';
    try{
      state.selection=await analyzeFile(file);
      renderSelection(state.selection);
    }catch(error){
      state.selection=null;
      console.error('Motor Nacional · análisis de archivo:',error);
      if(host)host.innerHTML=`<div class="national-detected error">
        <b>No pude analizar el archivo</b>
        <p>${esc(error.message)}</p>
        <small class="meta">El archivo no fue modificado. Revisa que sea Excel .xlsx/.xls y que conserve la hoja y encabezados de la Matriz Hídrica.</small>
      </div>`;
    }
  }

  function openFileChooser(){
    const input=document.getElementById('nationalSmartInput');
    if(!input){
      alert('No se encontró el selector de archivo.');
      return;
    }
    input.value='';
    input.click();
  }

  async function chooseFileFromInput(input){
    const file=input?.files?.[0];
    const host=document.getElementById('nationalSmartPreview');

    if(!file){
      if(host){
        host.innerHTML=`<div class="national-detected warn">
          <b>No se seleccionó ningún archivo</b>
          <p class="meta">Vuelve a presionar “Seleccionar archivo”.</p>
        </div>`;
      }
      return;
    }

    if(host){
      host.innerHTML=`<div class="national-detected loading">
        <b>Archivo seleccionado: ${esc(file.name)}</b>
        <p class="meta">Leyendo ${fmt(file.size||0)} bytes y analizando estructura…</p>
      </div>`;
    }

    try{
      const buffer=await file.arrayBuffer();
      const safeFile={
        name:file.name,
        type:file.type,
        size:file.size,
        lastModified:file.lastModified,
        arrayBuffer:async()=>buffer,
        text:async()=>new TextDecoder().decode(buffer)
      };

      await chooseFile(safeFile);
    }catch(error){
      console.error('Selección de archivo:',error);
      if(host){
        host.innerHTML=`<div class="national-detected error">
          <b>Error al leer el archivo</b>
          <p>${esc(error.message||String(error))}</p>
          <small class="meta">El archivo no fue modificado.</small>
        </div>`;
      }
    }finally{
      if(input)input.value='';
    }
  }

  async function commitFromUi(){
    const button=document.getElementById('nationalCommitFile');
    if(button){button.disabled=true;button.textContent='Actualizando…';}
    try{
      const result=await commitSelection(state.selection);
      global.toast?.(result.message);
      const host=document.getElementById('nationalSmartPreview');
      if(host)host.innerHTML=`<div class="national-detected success"><b>${esc(result.title)}</b><p>${esc(result.message)}</p></div>`;
      state.selection=null;
      updateStatusCards();
    }catch(error){
      alert('No se pudo completar la actualización: '+error.message);
      if(button){button.disabled=false;button.textContent='Reintentar';}
    }
  }

  function init(){
    const input=document.getElementById('nationalSmartInput');
    if(input && input.dataset.engineDirect!=='1' && !input.dataset.engineBound){
      input.dataset.engineBound='1';
      input.addEventListener('change',()=>chooseFileFromInput(input));
    }
    updateStatusCards();
    const host=document.getElementById('nationalSmartPreview');
    if(host&&!host.innerHTML.trim()){
      host.innerHTML=`<div class="national-detected ready">
        <b>Selector listo</b>
        <p class="meta">Selecciona un Excel para iniciar el análisis.</p>
      </div>`;
    }
    refreshHistory().catch(()=>{});
  }

  global.ParksNationalDataEngine=Object.freeze({
    init,analyzeFile,commitSelection,loadStored,refreshHistory,
    applyWaterSnapshot,parseWaterWorkbook,updateStatusCards,
    exportWaterWorkbook,currentWaterSnapshot,getWaterRows,getWaterHistory,loadWaterHistory,applyMasterSeed,
    chooseFileFromInput,chooseFile,openFileChooser
  });
})(window);
