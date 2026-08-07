(function(global){
  'use strict';

  const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let preview=null;
  const executiveNotesCache=new Map();

  function businessDaysInMonth(year,monthIndex){
    let count=0;
    const lastDay=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate();
    for(let day=1;day<=lastDay;day++){
      const dow=new Date(Date.UTC(year,monthIndex,day)).getUTCDay();
      if(dow>=1&&dow<=5)count++;
    }
    return count;
  }

  function expectedPerAdministrator(year,monthIndex){
    return businessDaysInMonth(year,monthIndex)*2;
  }

  function isApplicableBusinessDay(isoDate,year,monthIndex){
    const date=new Date(`${isoDate}T00:00:00Z`);
    if(Number.isNaN(date.getTime()))return false;
    const dow=date.getUTCDay();
    return date.getUTCFullYear()===year &&
      date.getUTCMonth()===monthIndex &&
      dow>=1&&dow<=5;
  }

  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=n=>new Intl.NumberFormat('es-MX').format(Number(n)||0);
  const pct=(n,d=2)=>`${((Number(n)||0)*100).toFixed(d)}%`;

  function excelDate(serial){
    if(serial instanceof Date)return serial;
    if(typeof serial!=='number')return null;
    return new Date(Date.UTC(1899,11,30)+serial*86400000);
  }

  function dateISO(date){
    if(!date)return '';
    return date.toISOString().slice(0,10);
  }

  function formatTime(value){
    if(value===null||value===undefined||value==='')return '';
    if(typeof value==='number'){
      const seconds=Math.round((((value%1)+1)%1)*86400);
      const h=String(Math.floor(seconds/3600)%24).padStart(2,'0');
      const m=String(Math.floor((seconds%3600)/60)).padStart(2,'0');
      return `${h}:${m}`;
    }
    return String(value).trim();
  }

  function findHeader(headers,aliases){
    const normalized=headers.map(norm);
    return normalized.findIndex(h=>aliases.some(a=>h===norm(a)));
  }

  function parsePeriod(sheetName,firstDate){
    const n=norm(sheetName);
    const monthIndex=MONTHS.findIndex(m=>n.includes(norm(m)));
    const yearMatch=String(sheetName).match(/\b(20\d{2})\b/);
    const date=firstDate||new Date();
    return {
      month:monthIndex>=0?MONTHS[monthIndex]:MONTHS[date.getUTCMonth()],
      year:yearMatch?Number(yearMatch[1]):date.getUTCFullYear(),
      monthIndex:monthIndex>=0?monthIndex:date.getUTCMonth()
    };
  }

  function parseWorkbook(workbook,fileName){
    const sheetName=workbook.SheetNames.find(name=>/20\d{2}|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE/i.test(name))||workbook.SheetNames[0];
    const ws=workbook.Sheets[sheetName];
    const matrix=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false});
    if(matrix.length<4)throw new Error('El Excel no contiene suficientes filas para procesar Top 5.');

    const h0=matrix[0]||[];
    const h1=matrix[1]||[];
    const regionCol=findHeader(h0,['Región','Region']);
    const adminCol=findHeader(h0,['Administrador']);
    const parkCol=findHeader(h0,['Unidad de Negocio','Parque','Unidad']);
    const matTotalCol=findHeader(h0,['Matutino Total']);
    const vesTotalCol=findHeader(h0,['Vespertino Total']);
    const adminPctCol=findHeader(h0,['Porcentaje Admin','Porcentaje Administrador']);
    const regionPctCol=findHeader(h0,['Porcentaje Región','Porcentaje Region']);

    if([regionCol,adminCol,parkCol,matTotalCol,vesTotalCol,adminPctCol].some(x=>x<0)){
      throw new Error('No reconocí la estructura. Deben existir Región, Administrador, Unidad de Negocio, Matutino Total, Vespertino Total y Porcentaje Admin.');
    }

    const dateColumns=[];
    let firstDate=null,lastDate=null;
    for(let c=parkCol+1;c<matTotalCol;c++){
      const shift=norm(h1[c]);
      if(!['M','V'].includes(shift))continue;
      let dateValue=h0[c];
      if(dateValue==null&&c>0)dateValue=h0[c-1];
      const date=excelDate(dateValue);
      if(!date)continue;
      if(!firstDate||date<firstDate)firstDate=date;
      if(!lastDate||date>lastDate)lastDate=date;
      dateColumns.push({col:c,shift,date});
    }

    const period=parsePeriod(sheetName,firstDate);
    const groups=new Map();
    const regionWorkbook=new Map();

    matrix.slice(2).forEach((row,rowIndex)=>{
      const region=String(row[regionCol]||'').trim();
      const administrator=String(row[adminCol]||'').trim();
      const park=String(row[parkCol]||'').trim();
      if(!administrator||!region)return;

      const key=`${norm(region)}|${norm(administrator)}`;
      let group=groups.get(key);
      if(!group){
        group={
          region,administrator,parks:[],
          matutino:0,vespertino:0,
          records:0,
          compliance:0,
          expected:0,
          sourceRows:[],
          events:new Map()
        };
        groups.set(key,group);
      }
      if(park&&!group.parks.includes(park))group.parks.push(park);
      group.sourceRows.push({row,park,rowNumber:rowIndex+3});

      if(!regionWorkbook.has(region)&&regionPctCol>=0&&Number.isFinite(Number(row[regionPctCol]))){
        regionWorkbook.set(region,Number(row[regionPctCol])||0);
      }

      for(const dc of dateColumns){
        const value=row[dc.col];

        // Regla PARKS ONE:
        // - vacío = no existe registro
        // - 0 numérico / "0" = no existe registro (Excel lo mostraba como 00:00
        //   y estaba inflando artificialmente el cumplimiento)
        // - una hora real = registro válido
        // - texto operativo (VACACIONES, SUSPENSIÓN, INCAPACIDAD, etc.) se
        //   conserva como evidencia válida si fue capturado expresamente.
        if(value===null||value===undefined||value==='')continue;
        if((typeof value==='number'&&value===0)||String(value).trim()==='0')continue;

        const eventKey=`${dateISO(dc.date)}|${dc.shift}`;
        if(!group.events.has(eventKey)){
          group.events.set(eventKey,{
            month:period.month,
            year:period.year,
            date:dateISO(dc.date),
            region,
            administrator,
            park,
            shift:dc.shift,
            time:formatTime(value)
          });
        }
      }
    });

    const admins=[...groups.values()];
    if(!admins.length)throw new Error('No encontré Administradores válidos en el Excel.');

    // Regla PARKS ONE:
    // Meta por Administrador = días hábiles del mes (lunes a viernes) × 2 turnos.
    // Solo cuenta máximo un M y un V por fecha para cada Administrador.
    const businessDays=businessDaysInMonth(period.year,period.monthIndex);
    const adminExpected=expectedPerAdministrator(period.year,period.monthIndex);

    admins.forEach(group=>{
      const validEvents=[...group.events.values()].filter(event=>
        isApplicableBusinessDay(event.date,period.year,period.monthIndex)
      );

      group.matutino=validEvents.filter(event=>event.shift==='M').length;
      group.vespertino=validEvents.filter(event=>event.shift==='V').length;
      group.records=group.matutino+group.vespertino;
      group.expected=adminExpected;
      group.compliance=adminExpected>0
        ? Math.min(group.records/adminExpected,1)
        : 0;
    });

    const regions=[...new Set(admins.map(x=>x.region))].map(region=>{
      const rows=admins.filter(x=>x.region===region);
      const regionRecords=rows.reduce((s,x)=>s+x.records,0);
      const regionExpected=rows.reduce((s,x)=>s+x.expected,0);
      const calculated=regionExpected>0
        ? Math.min(regionRecords/regionExpected,1)
        : 0;
      return {
        month:period.month,
        year:period.year,
        region,
        compliance:calculated,
        workbookCompliance:regionWorkbook.get(region)??null,
        administrators:rows.length,
        records:regionRecords,
        expected:regionExpected
      };
    });

    const records=admins.reduce((s,x)=>s+x.records,0);
    const expected=admins.reduce((s,x)=>s+x.expected,0);
    const compliance=expected>0?Math.min(records/expected,1):0;
    const matutino=admins.reduce((s,x)=>s+x.matutino,0);
    const vespertino=admins.reduce((s,x)=>s+x.vespertino,0);
    const detail=admins.flatMap(x=>
      [...x.events.values()].filter(event=>
        isApplicableBusinessDay(event.date,period.year,period.monthIndex)
      )
    );

    const warnings=[];
    regions.forEach(r=>{
      if(r.workbookCompliance!=null&&Math.abs(r.workbookCompliance-r.compliance)>.005){
        warnings.push(`${r.region}: el porcentaje regional del Excel (${pct(r.workbookCompliance)}) difiere del promedio consolidado por Administrador (${pct(r.compliance)}).`);
      }
    });

    return {
      sourceFilename:fileName,
      sheetName,
      month:period.month,
      year:period.year,
      monthIndex:period.monthIndex,
      cutoff:dateISO(lastDate),
      businessDays,
      expectedPerAdministrator:adminExpected,
      compliance,
      records,
      expected,
      matutino,
      vespertino,
      administrators:admins.length,
      admins:admins.map(x=>({
        month:period.month,year:period.year,region:x.region,administrator:x.administrator,
        parks:x.parks,matutino:x.matutino,vespertino:x.vespertino,records:x.records,
        expected:x.expected,compliance:x.compliance
      })),
      regions,
      recordsDetail:detail,
      warnings
    };
  }

  function mergeSnapshot(snapshot){
    const target=global.TOP5_DATA||(global.TOP5_DATA={months:[],admins:[],regions:[],records:[]});
    const same=x=>x.month===snapshot.month&&Number(x.year||snapshot.year)===snapshot.year;
    target.months=(target.months||[]).filter(x=>!same(x));
    target.admins=(target.admins||[]).filter(x=>!same(x));
    target.regions=(target.regions||[]).filter(x=>!same(x));
    target.records=(target.records||[]).filter(x=>!same(x));

    target.months.push({
      month:snapshot.month,year:snapshot.year,
      compliance:snapshot.compliance,cutoff:snapshot.cutoff,
      records:snapshot.records,expected:snapshot.expected,
      imported:true,source_filename:snapshot.sourceFilename
    });
    target.admins.push(...snapshot.admins);
    target.regions.push(...snapshot.regions.map(x=>({
      month:x.month,year:x.year,region:x.region,compliance:x.compliance
    })));
    target.records.push(...snapshot.recordsDetail);

    target.months.sort((a,b)=>(Number(a.year||2026)-Number(b.year||2026))||(MONTHS.indexOf(a.month)-MONTHS.indexOf(b.month)));
  }

  async function loadStored(){
    const client=global.ParksCloud?.client?.();
    if(!client)return;
    const {data,error}=await client.from('datasets').select('name,payload,source_filename,updated_at').like('name','top5:%').order('name');
    if(error)throw error;
    (data||[]).forEach(row=>{
      const snap=row.payload;
      if(snap?.month&&Array.isArray(snap.admins))mergeSnapshot(snap);
    });
  }

  async function saveSnapshot(snapshot){
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase todavía no está disponible.');
    const key=`top5:${snapshot.year}-${String(snapshot.monthIndex+1).padStart(2,'0')}`;
    const userId=global.ParksCloud?.session?.()?.user?.id||null;
    const {error}=await client.from('datasets').upsert({
      name:key,
      payload:snapshot,
      source_filename:snapshot.sourceFilename,
      updated_by:userId,
      updated_at:new Date().toISOString()
    },{onConflict:'name'});
    if(error)throw error;
    mergeSnapshot(snapshot);
  }

  function previousMonth(snapshot){
    const months=(global.TOP5_DATA?.months||[])
      .filter(x=>!(x.month===snapshot.month&&Number(x.year||snapshot.year)===snapshot.year))
      .map(x=>({...x,idx:Number(x.year||2026)*12+MONTHS.indexOf(x.month)}))
      .filter(x=>x.idx<snapshot.year*12+snapshot.monthIndex)
      .sort((a,b)=>b.idx-a.idx);
    return months[0]||null;
  }

  function normalizedAdminsForPeriod(month,year){
    const monthIndex=MONTHS.indexOf(month);
    const expected=expectedPerAdministrator(year,monthIndex);
    return (global.TOP5_DATA?.admins||[])
      .filter(x=>x.month===month&&Number(x.year||year)===year)
      .map(x=>{
        const records=(Number(x.matutino)||0)+(Number(x.vespertino)||0);
        return {
          ...x,
          records,
          expected,
          compliance:expected>0?Math.min(records/expected,1):0
        };
      });
  }

  function regionSummaryFromAdmins(month,year){
    const admins=normalizedAdminsForPeriod(month,year);
    const regions=[...new Set(admins.map(x=>x.region).filter(Boolean))];
    return regions.map(region=>{
      const rows=admins.filter(x=>x.region===region);
      // El indicador ejecutivo se consolida por Administrador.
      const compliance=rows.length
        ? rows.reduce((sum,x)=>sum+(Number(x.compliance)||0),0)/rows.length
        : 0;
      return {month,year,region,compliance,administrators:rows.length};
    });
  }

  function reportData(month){
    const data=global.TOP5_DATA||{months:[],admins:[],regions:[]};
    const current=data.months.find(x=>x.month===month);
    if(!current)return null;
    const year=Number(current.year||2026);
    const monthIndex=MONTHS.indexOf(month);
    const prev=data.months
      .map(x=>({...x,idx:Number(x.year||2026)*12+MONTHS.indexOf(x.month)}))
      .filter(x=>x.idx<year*12+monthIndex)
      .sort((a,b)=>b.idx-a.idx)[0]||null;

    const regions=regionSummaryFromAdmins(month,year);
    const previousRegions=prev
      ? regionSummaryFromAdmins(prev.month,Number(prev.year||year))
      : [];
    const prevMap=new Map(previousRegions.map(x=>[x.region,Number(x.compliance)||0]));
    const allRegions=[...new Set([
      ...regions.map(x=>x.region),
      ...previousRegions.map(x=>x.region)
    ])];

    const currentMap=new Map(regions.map(x=>[x.region,x]));
    const rows=allRegions.map(region=>{
      const currentRow=currentMap.get(region);
      const currentValue=Number(currentRow?.compliance)||0;
      const previous=prevMap.has(region)?prevMap.get(region):null;
      const delta=previous==null?null:currentValue-previous;
      return {
        ...(currentRow||{month,year,region,compliance:currentValue,administrators:0}),
        previous,
        delta
      };
    }).sort((a,b)=>{
      const regionOrder=value=>{
        const m=String(value).match(/^R(\d+)$/i);
        if(m)return Number(m[1]);
        if(String(value).toUpperCase().includes('T-'))return 90;
        if(String(value).toUpperCase().includes('BALBROS'))return 99;
        return 95;
      };
      return regionOrder(a.region)-regionOrder(b.region);
    });

    return {current,prev,rows,year};
  }

  function comparisonTableHtml(month){
    const summary=getExecutiveSummary(month);
    if(!summary)return '<div class="empty">No hay datos suficientes para comparar este periodo.</div>';
    const previousLabel=summary.prev?.month||'Mes anterior';
    const rows=summary.rows.map(row=>{
      const current=Number(row.compliance)||0;
      const previous=row.previous;
      const trend=previous==null
        ? '<span class="top5-trend neutral">● —</span>'
        : row.delta>.00005
          ? '<span class="top5-trend up">● ▲</span>'
          : row.delta<-.00005
            ? '<span class="top5-trend down">● ▼</span>'
            : '<span class="top5-trend neutral">● →</span>';
      return `<tr>
        <td><b>${esc(row.region)}</b></td>
        <td>${previous==null?'—':pct(previous)}</td>
        <td><b>${pct(current)}</b></td>
        <td>${trend}</td>
      </tr>`;
    }).join('');
    return `<div class="top5-comparison-wrap">
      <table class="top5-comparison-table">
        <thead><tr><th>Región</th><th>${esc(previousLabel)}</th><th>${esc(month)}</th><th>Tendencia</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function getExecutiveSummary(month){
    const r=reportData(month);
    if(!r)return null;
    const best=[...r.rows].sort((a,b)=>b.compliance-a.compliance)[0];
    const low=[...r.rows].sort((a,b)=>a.compliance-b.compliance)[0];
    const improved=r.rows.filter(x=>x.delta!=null&&x.delta>.00005);
    const declined=r.rows.filter(x=>x.delta!=null&&x.delta<-.00005);
    const same=r.rows.filter(x=>x.delta!=null&&Math.abs(x.delta)<=.00005);
    return {
      cardsHtml:`
        <div class="alert"><b>Cierre ${esc(month)} ${r.year}: ${pct(r.current.compliance)}</b><small>${r.prev?`${r.current.compliance>=r.prev.compliance?'Mejora':'Disminución'} de ${Math.abs((r.current.compliance-r.prev.compliance)*100).toFixed(2)} puntos porcentuales frente a ${esc(r.prev.month)}.`:'Primer periodo disponible.'}</small></div>
        ${best?`<div class="alert"><b>Mayor cumplimiento: ${esc(best.region)}</b><small>${pct(best.compliance)}.</small></div>`:''}
        ${low?`<div class="alert critical"><b>Principal área de atención: ${esc(low.region)}</b><small>${pct(low.compliance)}.</small></div>`:''}
        ${improved.length?`<div class="alert"><b>${improved.length} regiones mejoraron</b><small>${improved.map(x=>esc(x.region)).join(', ')}.</small></div>`:''}
      `,
      improved,declined,same,best,low,...r
    };
  }

  function noteKey(month){
    const current=(global.TOP5_DATA?.months||[]).find(x=>x.month===month)||{};
    const year=Number(current.year||2026);
    const monthIndex=MONTHS.indexOf(month);
    return `top5_note:${year}-${String(monthIndex+1).padStart(2,'0')}`;
  }

  function isArchitect(){
    return String(global.ParksCloud?.profile?.()?.role||'').toLowerCase()==='arquitecto';
  }

  async function loadExecutiveNote(month,force=false){
    const key=noteKey(month);
    if(!force&&executiveNotesCache.has(key))return executiveNotesCache.get(key);

    const client=global.ParksCloud?.client?.();
    if(!client){
      const fallback={text:'',updated_at:'',updated_by_name:''};
      executiveNotesCache.set(key,fallback);
      return fallback;
    }

    const {data,error}=await client
      .from('datasets')
      .select('payload,updated_at')
      .eq('name',key)
      .maybeSingle();

    if(error){
      console.warn('Top 5 notas ejecutivas:',error.message);
      const fallback={text:'',updated_at:'',updated_by_name:''};
      executiveNotesCache.set(key,fallback);
      return fallback;
    }

    const note={
      text:String(data?.payload?.text||''),
      updated_at:data?.updated_at||data?.payload?.updated_at||'',
      updated_by_name:String(data?.payload?.updated_by_name||'')
    };
    executiveNotesCache.set(key,note);
    return note;
  }

  async function saveExecutiveNote(month,text){
    if(!isArchitect())throw new Error('Solo el Arquitecto del Sistema puede editar los aspectos relevantes.');
    const client=global.ParksCloud?.client?.();
    if(!client)throw new Error('Supabase todavía no está disponible.');

    const key=noteKey(month);
    const profile=global.ParksCloud?.profile?.()||{};
    const userId=global.ParksCloud?.session?.()?.user?.id||null;
    const payload={
      text:String(text||'').trim(),
      updated_at:new Date().toISOString(),
      updated_by_name:profile.full_name||profile.email||'Arquitecto'
    };

    const {error}=await client.from('datasets').upsert({
      name:key,
      payload,
      source_filename:null,
      updated_by:userId,
      updated_at:new Date().toISOString()
    },{onConflict:'name'});

    if(error)throw error;
    const note={...payload};
    executiveNotesCache.set(key,note);
    return note;
  }

  async function renderExecutiveNotes(month){
    const host=document.getElementById('top5ExecutiveNotes');
    if(!host)return;

    host.innerHTML='<div class="top5-note-view empty">Cargando notas…</div>';
    const note=await loadExecutiveNote(month);

    // Evitar que una respuesta asíncrona de otro mes pinte el periodo equivocado.
    const selected=document.getElementById('top5Month')?.value;
    if(selected&&selected!==month)return;

    if(isArchitect()){
      host.innerHTML=`
        <div class="top5-note-editor">
          <textarea id="top5ExecutiveNoteText" placeholder="Escribe aquí los datos relevantes del cierre, incidencias, avances o puntos de atención que quieras dejar visibles para Dirección y demás perfiles.">${esc(note.text)}</textarea>
          <div class="top5-note-actions">
            <span id="top5ExecutiveNoteStatus" class="top5-note-status">${note.updated_at?`Última actualización: ${esc(new Date(note.updated_at).toLocaleString('es-MX'))}`:'Sin nota guardada para este periodo.'}</span>
            <button id="saveTop5ExecutiveNote" class="btn primary" type="button">Guardar nota</button>
          </div>
        </div>`;

      document.getElementById('saveTop5ExecutiveNote')?.addEventListener('click',async()=>{
        const button=document.getElementById('saveTop5ExecutiveNote');
        const status=document.getElementById('top5ExecutiveNoteStatus');
        const text=document.getElementById('top5ExecutiveNoteText')?.value||'';
        try{
          button.disabled=true;
          button.textContent='Guardando…';
          const saved=await saveExecutiveNote(month,text);
          if(status)status.textContent=`Guardado ${new Date(saved.updated_at).toLocaleString('es-MX')}`;
          global.toast?.('Aspectos relevantes guardados.');
        }catch(error){
          alert('No fue posible guardar la nota: '+error.message);
        }finally{
          button.disabled=false;
          button.textContent='Guardar nota';
        }
      });
    }else{
      host.innerHTML=note.text
        ? `<div class="top5-note-view">${esc(note.text)}</div>
           ${note.updated_at?`<div class="top5-note-status" style="margin-top:8px">Actualizado ${esc(new Date(note.updated_at).toLocaleString('es-MX'))}</div>`:''}`
        : '<div class="top5-note-view empty">No se registraron aspectos relevantes para este periodo.</div>';
    }
  }

  function reportHtml(month){
    const s=getExecutiveSummary(month);
    if(!s)return '<p>No hay datos del periodo seleccionado.</p>';
    const rows=s.rows.map(x=>{
      const trend=x.delta==null?'—':x.delta>.00005?'🟢 ▲':x.delta<-.00005?'🔴 ▼':'🟡 →';
      return `<tr><td><b>${esc(x.region)}</b></td><td>${x.previous==null?'—':pct(x.previous)}</td><td>${pct(x.compliance)}</td><td>${trend}</td></tr>`;
    }).join('');
    const relevant=[];
    if(s.improved.length)relevant.push(`✅ Las regiones <b>${s.improved.map(x=>esc(x.region)).join(', ')}</b> registraron una mejora respecto a ${esc(s.prev?.month||'el periodo anterior')}.`);
    if(s.same.length)relevant.push(`🟡 <b>${s.same.map(x=>esc(x.region)).join(', ')}</b> mantuvieron prácticamente el mismo nivel de cumplimiento.`);
    if(s.declined.length)relevant.push(`⚠️ Las regiones <b>${s.declined.map(x=>esc(x.region)).join(', ')}</b> disminuyeron y representan las principales áreas de seguimiento.`);
    const perfect=s.rows.filter(x=>x.compliance>=.9995);
    if(perfect.length)relevant.push(`✅ <b>${perfect.map(x=>esc(x.region)).join(', ')}</b> alcanzaron 100% de cumplimiento.`);
    relevant.push('✅ El cálculo se realiza con base en el <b>promedio consolidado por Administrador</b>, evitando duplicar a los Administradores con varios parques.');

    const cachedNote=executiveNotesCache.get(noteKey(month));
    const manualNote=cachedNote?.text
      ? `<p><b>Comentarios del cierre</b></p><div style="white-space:pre-wrap">${esc(cachedNote.text)}</div>`
      : '';

    return `
      <div class="top5-report-box" id="top5ExecutiveReport">
        <p>Hola Dani, buenas tardes.</p>
        <p>Comparto el <b>resumen ejecutivo del cumplimiento del TOP 5 correspondiente al mes de ${esc(month.toLowerCase())} de ${s.year}</b>, calculado con base en el <b>promedio consolidado por Administrador</b>, considerando el desempeño global de todos los parques bajo su responsabilidad.</p>
        <p><b>Cumplimiento por región</b></p>
        <table><thead><tr><th>Región</th><th>${esc(s.prev?.month||'Anterior')}</th><th>${esc(month)}</th><th>Tendencia</th></tr></thead><tbody>${rows}</tbody></table>
        <p><b>Aspectos relevantes</b></p>
        <ul>${relevant.map(x=>`<li>${x}</li>`).join('')}</ul>
        ${manualNote}
        <p>Quedo atento a cualquier comentario o ajuste que consideres necesario.</p>
        <p>Saludos.</p>
      </div>`;
  }

  async function fileSelected(file){
    if(!global.XLSX)throw new Error('No se pudo cargar el lector de Excel (SheetJS). Verifica tu conexión a Internet.');
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:'array'});
    preview=parseWorkbook(workbook,file.name);
    renderPreview();
  }

  function renderPreview(){
    if(!preview)return;
    const best=[...preview.regions].sort((a,b)=>b.compliance-a.compliance)[0];
    const low=[...preview.regions].sort((a,b)=>a.compliance-b.compliance)[0];
    const host=document.getElementById('top5ImportPreview');
    if(!host)return;
    host.innerHTML=`
      <div class="top5-import-preview">
        <div><small>Periodo</small><strong>${esc(preview.month)} ${preview.year}</strong></div>
        <div><small>Cumplimiento</small><strong>${pct(preview.compliance)}</strong></div>
        <div><small>Administradores</small><strong>${fmt(preview.administrators)}</strong></div>
        <div><small>Días hábiles</small><strong>${fmt(preview.businessDays)}</strong></div>
        <div><small>Meta por Admin</small><strong>${fmt(preview.expectedPerAdministrator)}</strong></div>
        <div><small>Registros válidos</small><strong>${fmt(preview.records)}</strong></div>
        <div><small>Mejor región</small><strong>${esc(best?.region||'—')}</strong></div>
        <div><small>Región a atender</small><strong>${esc(low?.region||'—')}</strong></div>
      </div>
      ${preview.warnings.length?`<div class="top5-import-warning"><b>Validación:</b><br>${preview.warnings.map(esc).join('<br>')}</div>`:''}
      <div class="top5-report-actions"><button class="btn primary" id="commitTop5Import">Actualizar Top 5</button></div>`;
    document.getElementById('commitTop5Import')?.addEventListener('click',commit);
  }

  function open(){
    const role=String(global.ParksCloud?.profile?.()?.role||'').toLowerCase();
    if(role!=='arquitecto')return alert('Solo el Arquitecto del Sistema puede cargar cierres Top 5.');
    preview=null;
    global.openModal('Cargar cierre mensual Top 5',`
      <p>Sube el Excel mensual con la misma estructura del archivo que utilizas actualmente. PARKS ONE consolidará Administradores multiparque y actualizará KPIs, histórico, Centro de Inteligencia y reporte ejecutivo.</p>
      <div class="top5-upload-zone">
        <b>Excel de cierre mensual</b>
        <p class="meta">Formato esperado: Región · Administrador · Unidad de Negocio · horarios M/V · Matutino Total · Vespertino Total · Porcentaje Admin · Porcentaje Región.</p>
        <label class="btn primary">Seleccionar Excel<input id="top5ExcelInput" type="file" accept=".xlsx,.xls"></label>
      </div>
      <div id="top5ImportPreview"></div>
    `);
    document.getElementById('top5ExcelInput')?.addEventListener('change',async event=>{
      const file=event.target.files?.[0];
      if(!file)return;
      try{await fileSelected(file);}
      catch(error){alert('No pude procesar el Excel: '+error.message);}
    });
  }

  async function commit(){
    if(!preview)return;
    if(!confirm(`Se actualizará el cierre ${preview.month} ${preview.year} con ${preview.administrators} Administradores. ¿Continuar?`))return;
    try{
      await saveSnapshot(preview);
      global.closeModal();
      global.refreshTop5Selectors?.();
      const month=document.getElementById('top5Month');
      if(month)month.value=preview.month;
      global.renderTop5?.();
      global.toast?.(`Top 5 ${preview.month} actualizado correctamente.`);
      preview=null;
    }catch(error){
      alert('No fue posible guardar el cierre Top 5: '+error.message+'\n\nSi es la primera vez que usas esta función, ejecuta el archivo supabase/002_top5_datasets.sql en Supabase.');
    }
  }

  function openReport(){
    const month=document.getElementById('top5Month')?.value||global.TOP5_DATA?.months?.at(-1)?.month;
    if(!month)return alert('No hay periodos Top 5 disponibles.');
    global.openModal(`Reporte ejecutivo Top 5 · ${month}`,`
      ${reportHtml(month)}
      <div class="top5-report-actions">
        <button class="btn secondary" id="copyTop5Report">Copiar correo</button>
      </div>
    `);
    document.getElementById('copyTop5Report')?.addEventListener('click',async()=>{
      const text=document.getElementById('top5ExecutiveReport')?.innerText||'';
      try{
        await navigator.clipboard.writeText(text);
        global.toast?.('Reporte copiado al portapapeles.');
      }catch{
        alert('Selecciona el texto del reporte y cópialo manualmente.');
      }
    });
  }

  async function analyzeFile(file){
    if(!global.XLSX)throw new Error('No se pudo cargar el lector de Excel (SheetJS).');
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:'array'});
    return parseWorkbook(workbook,file.name);
  }

  async function commitSnapshot(snapshot){
    if(!snapshot?.month)throw new Error('El cierre Top 5 no contiene un periodo válido.');
    await saveSnapshot(snapshot);
    global.refreshTop5Selectors?.();
    const month=document.getElementById('top5Month');
    if(month)month.value=snapshot.month;
    global.renderTop5?.();
    return snapshot;
  }

  global.ParksTop5Importer=Object.freeze({
    open,openReport,loadStored,getExecutiveSummary,comparisonTableHtml,parseWorkbook,
    businessDaysInMonth,expectedPerAdministrator,
    analyzeFile,commitSnapshot,
    renderExecutiveNotes,loadExecutiveNote,saveExecutiveNote
  });
})(window);
