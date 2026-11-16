export function createZoneDirectory({api,escape,canOpen,openStreet,showAreas,fitArea,filterStreets}){
 const $=id=>document.getElementById(id),dialog=$('zone-streets-dialog');
 let data=null,selectedAreas=new Set(),selectedStreets=new Set(),openGroups=new Set(),search='',acquired=false,expanded=false,loading=false,timer;
 const belongs=(s,id)=>id==='unlocated'?s.unlocated:id==='unassigned'?!s.unlocated&&!s.areaIds.length:s.areaIds.includes(id);
 const groups=()=>[...data.areas.map(a=>({id:a.id,name:a.name,count:a.streetCount})),{id:'unassigned',name:'Fuori dalle zone disegnate',count:data.streets.filter(s=>!s.unlocated&&!s.areaIds.length).length},{id:'unlocated',name:'Da localizzare',count:data.streets.filter(s=>s.unlocated).length}];
 const filtered=()=>data.streets.filter(s=>(!acquired||s.lastScanAt||s.count)&&(!search.trim()||`${s.name} ${s.locality} ${s.id}`.toLocaleLowerCase('it').includes(search.trim().toLocaleLowerCase('it'))));
 const eligible=s=>!s.needsReview&&Boolean(s.sisterName);
 function render(){
  openGroups=new Set([...dialog.querySelectorAll('[data-zone-group][open]')].map(el=>el.dataset.zoneGroup));
  const visible=filtered(),visibleGroups=groups().filter(g=>!selectedAreas.size||selectedAreas.has(g.id));
  $('zone-streets-filters').innerHTML=`<h3>Zone da mostrare</h3><button id="zone-streets-all" class="quiet">Tutte le zone</button>${groups().map(g=>`<label><input type="checkbox" data-zone-filter="${escape(g.id)}" ${selectedAreas.has(g.id)?'checked':''}><span>${escape(g.name)}</span><small>${g.count}</small></label>`).join('')}<p class="meta">Le vie che attraversano più zone compaiono in ciascuna lista e si accodano una sola volta. SISTER acquisisce tutta la via.</p>`;
  $('zone-streets-count').textContent=`${visible.filter(s=>!selectedAreas.size||[...selectedAreas].some(id=>belongs(s,id))).length} vie uniche${data.stale?' · copia delle zone salvata, aggiornamento online non disponibile':''}`;
  $('zone-streets-groups').innerHTML=visibleGroups.map(g=>{
   const rows=visible.filter(s=>belongs(s,g.id));
   return `<details class="zone-streets-group" data-zone-group="${escape(g.id)}" ${expanded||selectedAreas.size||openGroups.has(g.id)?'open':''}><summary>${escape(g.name)}<span>${rows.length} vie</span></summary><div class="zone-streets-group-actions"><label><input type="checkbox" data-zone-select="${escape(g.id)}" ${rows.some(eligible)&&rows.filter(eligible).every(s=>selectedStreets.has(s.id))?'checked':''} ${rows.some(eligible)?'':'disabled'}>${search.trim()||acquired?'Seleziona le vie visibili della zona':'Seleziona tutta la zona'}</label>${data.areas.some(a=>a.id===g.id)?`<button class="quiet" data-zone-fit="${escape(g.id)}">Inquadra zona</button>`:''}</div>${rows.length?`<div class="sister-bulk-table"><table><thead><tr><th>Seleziona</th><th>Via</th><th>Località / riferimento</th><th>In memoria</th><th>Acquisizione</th></tr></thead><tbody>${rows.map(s=>`<tr><td><input type="checkbox" aria-label="Seleziona ${escape(s.name)}" data-zone-street="${escape(s.id)}" ${selectedStreets.has(s.id)?'checked':''} ${eligible(s)?'':'disabled'}></td><th scope="row"><button class="quiet" data-zone-open="${escape(s.id)}">${escape(s.name)}</button><small>Codice ${escape(s.id)}${s.areaIds.length>1?' · attraversa più zone':''}${s.needsReview?' · via da verificare':''}</small></th><td>${escape(s.locality)}</td><td>${s.count??0} immobili</td><td>${s.lastScanAt?new Date(s.lastScanAt).toLocaleDateString('it-IT'):'Non acquisita'}</td></tr>`).join('')}</tbody></table></div>`:'<p>Nessuna via con questi filtri.</p>'}</details>`;
  }).join('');
  $('zone-streets-selection').textContent=`${selectedStreets.size} vie selezionate`;
  $('zone-streets-add').disabled=!selectedStreets.size||loading;
  $('zone-streets-filters').querySelectorAll('[data-zone-filter]').forEach(el=>el.onchange=()=>{el.checked?selectedAreas.add(el.dataset.zoneFilter):selectedAreas.delete(el.dataset.zoneFilter);render();});
  $('zone-streets-all').onclick=()=>{selectedAreas.clear();render();};
  dialog.querySelectorAll('[data-zone-street]').forEach(el=>el.onchange=()=>{el.checked?selectedStreets.add(el.dataset.zoneStreet):selectedStreets.delete(el.dataset.zoneStreet);render();});
  dialog.querySelectorAll('[data-zone-select]').forEach(el=>{const candidates=visible.filter(s=>belongs(s,el.dataset.zoneSelect)&&eligible(s));const count=candidates.filter(s=>selectedStreets.has(s.id)).length;el.indeterminate=count>0&&count<candidates.length;el.onchange=()=>{visible.filter(s=>belongs(s,el.dataset.zoneSelect)&&eligible(s)).forEach(s=>el.checked?selectedStreets.add(s.id):selectedStreets.delete(s.id));render();};});
  dialog.querySelectorAll('[data-zone-open]').forEach(el=>el.onclick=()=>{dialog.close();openStreet(el.dataset.zoneOpen);});
  dialog.querySelectorAll('[data-zone-fit]').forEach(el=>el.onclick=()=>fitArea(data.areas.find(a=>a.id===el.dataset.zoneFit)));
  showAreas(data.areas.filter(a=>selectedAreas.has(a.id)));
  filterStreets(selectedAreas.size?data.streets.filter(s=>[...selectedAreas].some(id=>belongs(s,id))).map(s=>s.id):null);
 }
 async function refresh(){if(loading||!dialog.open)return;loading=true;try{data=await api.zoneDirectory();if(!dialog.open)return;selectedStreets=new Set([...selectedStreets].filter(id=>data.streets.some(s=>s.id===id)));render();}catch(e){$('zone-streets-feedback').textContent=e.message;}finally{loading=false;if(data&&dialog.open)$('zone-streets-add').disabled=!selectedStreets.size;}}
 $('zone-streets-open').onclick=async()=>{if(!canOpen())return;dialog.showModal();$('zone-streets-feedback').textContent='';if(!data)$('zone-streets-count').textContent='Caricamento delle zone e delle vie…';await refresh();clearInterval(timer);if(dialog.open)timer=setInterval(refresh,30000);};
 $('zone-streets-export').onclick=async()=>{try{const rows=filtered().filter(s=>!selectedAreas.size||[...selectedAreas].some(id=>belongs(s,id)));const result=await api.exportZoneDirectory(rows.map(s=>s.id));if(result.saved)$('zone-streets-feedback').textContent=`Esportate ${result.count} vie in Excel`;}catch(e){$('zone-streets-feedback').textContent=e.message;}};
 $('zone-streets-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{clearInterval(timer);});
 $('zone-streets-search').oninput=e=>{search=e.target.value;if(data)render();};
 $('zone-streets-acquired').onchange=e=>{acquired=e.target.checked;if(data)render();};
 $('zone-streets-expand').onclick=()=>{expanded=!expanded;if(!expanded){openGroups.clear();dialog.querySelectorAll('[data-zone-group][open]').forEach(el=>el.open=false);}$('zone-streets-expand').textContent=expanded?'Richiudi liste':'Apri liste';if(data)render();};
 $('zone-streets-refresh').onclick=refresh;
 $('zone-streets-clear').onclick=()=>{selectedStreets.clear();if(data)render();};
 $('zone-streets-add').onclick=async()=>{
  if(loading)return;loading=true;$('zone-streets-add').disabled=true;
  try{const result=await api.sisterQueuePutMany([...selectedStreets]);selectedStreets.clear();$('zone-streets-feedback').textContent=`${result.added} vie aggiunte alla coda SISTER · ${result.alreadyQueued} già in coda${result.excluded.length?` · ${result.excluded.length} da verificare`:''}. Il giro non è stato avviato.`;render();}
  catch(e){$('zone-streets-feedback').textContent=e.message;}finally{loading=false;$('zone-streets-add').disabled=!selectedStreets.size;}
 };
 $('zone-streets-queue').onclick=()=>{dialog.close();$('sister-bulk-open').click();};
}
