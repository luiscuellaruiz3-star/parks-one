
(function(global){
'use strict';
const state={};
const fmt=n=>new Intl.NumberFormat('es-MX').format(Number(n)||0);
const pct=(n,d=2)=>Number.isFinite(Number(n))?(Math.min(1,Math.max(0,Number(n)))*100).toFixed(d)+'%':'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yes=v=>{const t=String(v||'').trim().toUpperCase();return !!t&&!['NO','N/A','NA','POR CONFIRMAR','POR VALIDAR'].includes(t)&&/(^|\b)(SI|SÍ)(\b|$)|TIENE/.test(t)};

function top23(){
 const reqs=Array.isArray(global.C?.requirements)?global.C.requirements:[];
 const integrated=reqs.reduce((s,x)=>s+(Number(x.ok)||0),0);
 const pending=reqs.reduce((s,x)=>s+(Number(x.no)||0),0);
 const na=reqs.reduce((s,x)=>s+(Number(x.na)||0),0);
 const validating=reqs.reduce((s,x)=>s+(Number(x.val)||0),0);
 const applicable=integrated+pending+validating;
 const parks=Array.isArray(global.C?.parks)?global.C.parks:[];
 return {integrated,pending,na,validating,applicable,compliance:applicable?integrated/applicable:0,parks,requirements:reqs,regions:Array.isArray(global.C?.regions)?global.C.regions:[]};
}
function top5MonthData(month){
 if(typeof global.T5==='undefined')return {admins:[],regions:[],compliance:NaN,month};
 const ov=typeof global.top5Overrides==='function'?global.top5Overrides():{};
 const admins=(global.T5.admins||[]).filter(x=>x.month===month).map(x=>{
  const z=ov[month+'|'+x.region+'|'+x.administrator];
  const records=z?Number(z.matutino||0)+Number(z.vespertino||0):Number(x.records||0);
  const compliance=Math.min(1,Math.max(0,z&&x.expected?records/x.expected:Number(x.compliance)||0));
  return {...x,records,compliance};
 });
 const regions=[...new Set(admins.map(x=>x.region))].map(region=>{
  const a=admins.filter(x=>x.region===region);
  return {region,compliance:Math.min(1,a.reduce((s,x)=>s+x.compliance,0)/(a.length||1))}
 });
 const fixed=(global.T5.months||[]).find(x=>x.month===month);
 const hasOverride=Object.keys(ov).some(k=>k.startsWith(month+'|'));
 const compliance=Math.min(1,Math.max(0,hasOverride?admins.reduce((s,x)=>s+x.compliance,0)/(admins.length||1):Number(fixed?.compliance)||0));
 return {month,admins,regions,compliance,records:admins.reduce((s,x)=>s+(Number(x.records)||0),0),expected:admins.reduce((s,x)=>s+(Number(x.expected)||0),0),cutoff:fixed?.cutoff||''};
}
function top5(){
 const selected=document.getElementById('top5Month')?.value||'Julio';
 const cur=top5MonthData(selected);
 const order=['Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
 const i=order.indexOf(selected),prev=i>0?top5MonthData(order[i-1]):null;
 return {...cur,previous:prev};
}
function docs(){
 const files=Array.isArray(global.C?.files)?global.C.files:[];
 const groups={}; files.forEach(f=>{const k=f.document_type||f.folder||'Sin clasificar';groups[k]=(groups[k]||0)+1});
 return {files,count:files.length,groups:Object.entries(groups).sort((a,b)=>b[1]-a[1])};
}
function alerts(){
 const items=Array.isArray(global.D?.alerts)?global.D.alerts:[];
 return {items,critical:items.filter(x=>x.severity==='critical').length,high:items.filter(x=>x.severity==='high').length,medium:items.filter(x=>x.severity==='medium').length};
}
function water(){
 const parks=Array.isArray(global.C?.parks)?global.C.parks:[];
 const rows=parks.map(p=>({park:p.park,region:p.region,ptar:p.hydrica?.ptar??p.ptar??'',pozo:p.hydrica?.pozo??'',descarga:p.hydrica?.tipo_descarga??p.discharge??'',audit:p.audit||''}));
 const ptar=rows.filter(x=>yes(x.ptar));
 const pozo=rows.filter(x=>yes(x.pozo));
 const discharge=rows.filter(x=>String(x.descarga||'').trim()&&!/^(NO|N\/?A|NA|POR CONFIRMAR|POR VALIDAR)$/i.test(String(x.descarga||'').trim()));
 return {rows,ptar,pozo,discharge};
}
function snapshot(){
 const t23=top23(),t5=top5(),d=docs(),a=alerts(),w=water();
 return {t23,t5,d,a,w,generatedAt:new Date()};
}
function donut(value,label,sub,color='var(--g)'){
 const deg=Math.min(360,Math.max(0,(Number(value)||0)*360));
 return `<div class="exec-mini-donut" style="background:conic-gradient(${color} 0 ${deg}deg,#e7efec ${deg}deg)"><span>${esc(label)}<small>${esc(sub)}</small></span></div>`;
}
function modal(title,html){global.openModal?.(title,html)}
function render(){
 const s=snapshot(); state.s=s;
 const $=global.$;
 if(!$||!global.C)return;
 $('#heroParks').textContent=fmt(s.t23.parks.length);
 $('#heroFiles').textContent=fmt(s.d.count);
 $('#heroAdmins').textContent=fmt(s.t5.admins.length);
 $('#heroRegions').textContent=fmt(s.t23.regions.length);
 $('#execSync').innerHTML='Fuentes sincronizadas';
 const criticalParks=s.t23.parks.filter(p=>p.risk==='CRÍTICO');
 const complete=s.t23.parks.filter(p=>(Number(p.pending)||0)===0&&(Number(p.validating)||0)===0);
 const cards=[
  ['top23','Cumplimiento documental',pct(s.t23.compliance),`${fmt(s.t23.integrated)} integrados de ${fmt(s.t23.applicable)} aplicables`,'good','TOP 23'],
  ['top5','Top 5 operativo',pct(s.t5.compliance),`${s.t5.month} · ${fmt(s.t5.records)} de ${fmt(s.t5.expected)} registros`,'info','TOP 5'],
  ['docs','Documentos cargados',fmt(s.d.count),`${fmt(new Set(s.d.files.map(f=>f.park).filter(Boolean)).size)} parques con evidencia`,'good','BIBLIOTECA'],
  ['alerts','Alertas críticas',fmt(s.a.critical),`${fmt(s.a.items.length)} alertas activas`,'danger','ALERTAS'],
  ['water','PTAR identificadas',fmt(s.w.ptar.length),`${fmt(s.w.discharge.length)} parques con descarga identificada`,'info','AGUA / PTAR'],
  ['risk','Parques críticos',fmt(criticalParks.length),`${fmt(complete.length)} expedientes sin pendientes`,'warn','TOP 23']
 ];
 $('#kpis').innerHTML=cards.map(x=>`<div class="card kpi ${x[4]}" onclick="ParksExecutiveHub.open('${x[0]}')"><span class="kpi-source">${x[5]}</span><small>${x[1]}</small><strong>${x[2]}</strong><div class="sub">${x[3]}</div><span class="kpi-action">Ver desglose →</span></div>`).join('');
 $('#summaryParks').textContent=`${fmt(s.t23.parks.length)} parques evaluados`;
 $('#summaryRegions').textContent=`${fmt(s.t23.regions.length)} regiones consolidadas`;
 $('#executiveSummaryText').textContent=`El cumplimiento documental nacional es ${pct(s.t23.compliance)} con ${fmt(s.t23.pending)} obligaciones pendientes. El Top 5 operativo se ubica en ${pct(s.t5.compliance)} para ${s.t5.month}. Existen ${fmt(criticalParks.length)} parques en riesgo crítico, ${fmt(s.a.critical)} alertas críticas y ${fmt(s.w.ptar.length)} PTAR identificadas.`;
 $('#regionalBars').innerHTML=[...s.t23.regions].sort((a,b)=>b.compliance-a.compliance).map(r=>`<div class="regrow exec-click-row" onclick="ParksExecutiveHub.region('${encodeURIComponent(r.region)}')"><span>${esc(r.region)}</span><div class="bar"><i style="width:${Math.min(100,Math.max(2,r.compliance*100))}%"></i></div><b>${pct(r.compliance)}</b></div>`).join('');
 $('#nationalBar').style.width=Math.min(100,s.t23.compliance*100)+'%'; $('#nationalPct').textContent=pct(s.t23.compliance);
 const priority=[...s.a.items].sort((a,b)=>({critical:0,high:1,medium:2}[a.severity]??3)-({critical:0,high:1,medium:2}[b.severity]??3)).slice(0,7);
 $('#priority').innerHTML=priority.map(a=>`<div class="alert ${a.severity==='critical'?'critical':a.severity==='medium'?'medium':''} exec-click-row" onclick="go('alertas')"><b>${esc(a.park)} · ${esc(a.document)}</b><small>${esc(a.message)}</small></div>`).join('')||'<div class="empty">Sin alertas disponibles.</div>';
 const annualRows=[
  ['Predial 2026',Number(global.D?.metrics?.predial_2026)||0,'predial'],
  ['Uso de suelo 2026',Number(global.D?.metrics?.uso_suelo_2026)||0,'uso'],
  ['Protección Civil 2026',Number(global.D?.metrics?.pc_2026)||0,'pc']
 ];
 $('#annual').innerHTML=annualRows.map(x=>`<div class="mini exec-click-row" onclick="ParksExecutiveHub.annual('${x[2]}')"><span>${x[0]}</span><div class="bar"><i style="width:${Math.min(100,x[1]/Math.max(1,s.t23.parks.length)*100)}%"></i></div><b>${fmt(x[1])}</b></div>`).join('');
 const audited=s.t23.parks.filter(p=>String(p.audit).toUpperCase()==='SI').length,withFiles=s.t23.parks.filter(p=>(Number(p.file_count)||0)>0).length;
 $('#coverage').innerHTML=[
  ['Auditorías registradas',audited,'audit'],
  ['Parques con archivos',withFiles,'files'],
  ['PTAR identificadas',s.w.ptar.length,'ptar']
 ].map(x=>`<div class="mini exec-click-row" onclick="ParksExecutiveHub.coverage('${x[2]}')"><span>${x[0]}</span><div class="bar"><i style="width:${Math.min(100,x[1]/Math.max(1,s.t23.parks.length)*100)}%"></i></div><b>${fmt(x[1])}</b></div>`).join('');
 const high=s.t23.parks.filter(p=>p.risk==='ALTO').length,controlled=s.t23.parks.length-criticalParks.length-high;
 $('#risk').innerHTML=`<div class="alert critical exec-click-row" onclick="ParksExecutiveHub.risk('CRÍTICO')"><b>${criticalParks.length} parques en riesgo crítico</b><small>Ver parques y pendientes que componen el indicador.</small></div><div class="alert exec-click-row" onclick="ParksExecutiveHub.risk('ALTO')"><b>${high} parques en riesgo alto</b><small>Requieren seguimiento prioritario.</small></div><div class="alert medium exec-click-row" onclick="ParksExecutiveHub.risk('CONTROLADO')"><b>${controlled} parques en riesgo medio o controlado</b><small>Seguimiento preventivo.</small></div>`;
 global.applyEditable?.();
}
function open(type){
 const s=state.s||snapshot();
 if(type==='top23'){
  return modal('Cumplimiento documental · Top 23',`<div class="exec-modal-summary">${donut(s.t23.compliance,pct(s.t23.compliance),'cumplimiento')}<div class="exec-statgrid"><div class="exec-stat"><small>Integrados</small><b>${fmt(s.t23.integrated)}</b></div><div class="exec-stat"><small>Pendientes</small><b>${fmt(s.t23.pending)}</b></div><div class="exec-stat"><small>N/A</small><b>${fmt(s.t23.na)}</b></div><div class="exec-stat"><small>Por definir</small><b>${fmt(s.t23.validating)}</b></div></div></div><div class="exec-simple-list">${[...s.t23.regions].sort((a,b)=>a.compliance-b.compliance).map(r=>`<div class="exec-simple-row"><b>${esc(r.region)}</b><div class="bar"><i style="width:${Math.max(2,r.compliance*100)}%"></i></div><span>${pct(r.compliance)}</span></div>`).join('')}</div><div class="exec-modal-actions"><button class="btn primary" onclick="closeModal();go('top23')">Abrir Top 23</button></div>`);
 }
 if(type==='top5'){
  const prev=s.t5.previous;
  const regions=[...s.t5.regions].sort((a,b)=>b.compliance-a.compliance);
  const names=[...new Set([...(prev?.regions||[]).map(x=>x.region),...regions.map(x=>x.region)])];
  const comp=prev?`<table class="top5-compare-table"><thead><tr><th>Región</th><th>${esc(prev.month)}</th><th>${esc(s.t5.month)}</th><th>Tendencia</th></tr></thead><tbody>${names.map(name=>{const a=prev.regions.find(x=>x.region===name)?.compliance??0,b=regions.find(x=>x.region===name)?.compliance??0,d=b-a;return `<tr><td><b>${esc(name)}</b></td><td>${pct(a)}</td><td><b>${pct(b)}</b></td><td><span class="trend ${d>0.0001?'up':d<-0.0001?'down':'flat'}">${d>0.0001?'● ▲':d<-0.0001?'● ▼':'● →'}</span></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">Sin mes anterior.</div>';
  return modal('Top 5 operativo',`<div class="exec-modal-summary">${donut(s.t5.compliance,pct(s.t5.compliance),s.t5.month,'var(--blue)')}<div><h3>${fmt(s.t5.records)} registros de ${fmt(s.t5.expected)} esperados</h3><p>${fmt(s.t5.admins.length)} administradores evaluados. Ningún cumplimiento se muestra por encima del 100%.</p></div></div><h4>Comparativo regional</h4><div class="tablewrap">${comp}</div><h4>Administradores</h4><div class="exec-simple-list">${[...s.t5.admins].sort((a,b)=>b.compliance-a.compliance).slice(0,25).map(x=>`<div class="exec-simple-row"><span><b>${esc(x.administrator)}</b><small>${esc(x.region)}</small></span><div class="bar"><i style="width:${Math.min(100,x.compliance*100)}%"></i></div><b>${pct(x.compliance)}</b></div>`).join('')}</div><div class="exec-modal-actions"><button class="btn primary" onclick="closeModal();go('top5')">Abrir Top 5</button></div>`);
 }
 if(type==='docs'){
  return modal('Biblioteca documental',`<div class="exec-modal-summary">${donut(1,fmt(s.d.count),'documentos')}<div><h3>${fmt(new Set(s.d.files.map(f=>f.park).filter(Boolean)).size)} parques con evidencia</h3><p>Desglose del índice documental actualmente visible.</p></div></div><div class="exec-simple-list">${s.d.groups.slice(0,18).map(([k,v])=>`<div class="exec-simple-row"><b>${esc(k)}</b><div class="bar"><i style="width:${Math.max(2,v/Math.max(1,s.d.groups[0]?.[1]||1)*100)}%"></i></div><b>${fmt(v)}</b></div>`).join('')}</div><div class="exec-modal-actions"><button class="btn primary" onclick="closeModal();go('documentos')">Abrir Biblioteca</button></div>`);
 }
 if(type==='alerts'){
  return modal('Centro de alertas',`<div class="exec-statgrid"><div class="exec-stat"><small>Críticas</small><b>${fmt(s.a.critical)}</b></div><div class="exec-stat"><small>Altas</small><b>${fmt(s.a.high)}</b></div><div class="exec-stat"><small>Medias</small><b>${fmt(s.a.medium)}</b></div><div class="exec-stat"><small>Total activas</small><b>${fmt(s.a.items.length)}</b></div></div><div class="exec-simple-list" style="margin-top:12px">${s.a.items.slice(0,30).map(a=>`<div class="alert ${a.severity==='critical'?'critical':a.severity==='medium'?'medium':''}"><b>${esc(a.park)} · ${esc(a.document)}</b><small>${esc(a.message)}</small></div>`).join('')}</div><div class="exec-modal-actions"><button class="btn primary" onclick="closeModal();go('alertas')">Abrir Alertas</button></div>`);
 }
 if(type==='water'){
  return modal('Agua, PTAR y descargas',`<div class="exec-statgrid"><div class="exec-stat"><small>PTAR</small><b>${fmt(s.w.ptar.length)}</b></div><div class="exec-stat"><small>Pozos</small><b>${fmt(s.w.pozo.length)}</b></div><div class="exec-stat"><small>Descargas</small><b>${fmt(s.w.discharge.length)}</b></div><div class="exec-stat"><small>Registros</small><b>${fmt(s.w.rows.length)}</b></div></div><div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Parque</th><th>Región</th><th>PTAR</th><th>Pozo</th><th>Descarga</th></tr></thead><tbody>${s.w.rows.filter(x=>yes(x.ptar)||yes(x.pozo)||String(x.descarga||'').trim()).map(x=>`<tr><td><b>${esc(x.park)}</b></td><td>${esc(x.region)}</td><td>${esc(x.ptar||'—')}</td><td>${esc(x.pozo||'—')}</td><td>${esc(x.descarga||'—')}</td></tr>`).join('')}</tbody></table></div><div class="exec-modal-actions"><button class="btn primary" onclick="closeModal();go('agua')">Abrir Agua / PTAR</button></div>`);
 }
 if(type==='risk')return risk('CRÍTICO');
}
function region(encoded){
 const name=decodeURIComponent(encoded),s=state.s||snapshot(),r=s.t23.regions.find(x=>x.region===name),parks=s.t23.parks.filter(p=>p.region===name).sort((a,b)=>a.compliance-b.compliance);
 if(!r)return;
 modal(`Región ${name}`,`<p><b>${pct(r.compliance)}</b> de cumplimiento · ${fmt(r.pending)} pendientes.</p><div class="exec-simple-list">${parks.map(p=>`<div class="exec-simple-row"><b>${esc(p.park)}</b><div class="bar"><i style="width:${Math.max(2,p.compliance*100)}%"></i></div><span>${pct(p.compliance)}</span></div>`).join('')}</div>`);
}
function risk(level){
 const s=state.s||snapshot();
 let parks=level==='CONTROLADO'?s.t23.parks.filter(p=>!['CRÍTICO','ALTO'].includes(p.risk)):s.t23.parks.filter(p=>p.risk===level);
 modal(`Riesgo ${level}`,`<div class="exec-simple-list">${parks.sort((a,b)=>a.compliance-b.compliance).map(p=>`<div class="exec-simple-row"><span><b>${esc(p.park)}</b><small>${esc(p.region)} · ${esc(p.administrator||'')}</small></span><span>${fmt(p.pending)} pendientes</span><b>${pct(p.compliance)}</b></div>`).join('')||'<div class="empty">Sin parques en esta categoría.</div>'}</div>`);
}
function coverage(type){
 const s=state.s||snapshot(); let list=[],title='';
 if(type==='audit'){title='Parques auditados';list=s.t23.parks.filter(p=>String(p.audit).toUpperCase()==='SI').map(p=>[p.park,p.region,'Auditoría registrada'])}
 if(type==='files'){title='Parques con archivos';list=s.t23.parks.filter(p=>(Number(p.file_count)||0)>0).map(p=>[p.park,p.region,fmt(p.file_count)+' archivos'])}
 if(type==='ptar'){title='Parques con PTAR';list=s.w.ptar.map(p=>[p.park,p.region,p.ptar])}
 modal(title,`<div class="exec-simple-list">${list.map(x=>`<div class="exec-simple-row"><b>${esc(x[0])}</b><span>${esc(x[1])}</span><span>${esc(x[2])}</span></div>`).join('')||'<div class="empty">Sin registros.</div>'}</div>`);
}
function annual(type){
 const s=state.s||snapshot(), map={predial:['Predial 2026',/PREDIAL/],uso:['Uso de suelo 2026',/USO.*SUELO/],pc:['Protección Civil 2026',/PROTECCION.*CIVIL|PC ESTATAL|PC MUNICIPAL/]},def=map[type];
 const files=s.d.files.filter(f=>def[1].test(String(`${f.document_type||''} ${f.folder||''} ${f.filename||''}`).toUpperCase())&&String(`${f.year||''} ${f.filename||''}`).includes('2026'));
 const byPark=[...new Set(files.map(f=>f.park).filter(Boolean))].sort();
 modal(def[0],`<p>${fmt(byPark.length)} parques con evidencia 2026 localizable en la Biblioteca.</p><div class="exec-simple-list">${byPark.map(p=>`<div class="exec-simple-row"><b>${esc(p)}</b><span>${esc(s.t23.parks.find(x=>x.park===p)?.region||'')}</span><span>2026</span></div>`).join('')||'<div class="empty">Sin evidencia 2026 localizable.</div>'}</div>`);
}
global.ParksExecutiveHub=Object.freeze({render,open,region,risk,coverage,annual});
})(window);
