export function createSisterBulk({api,escape,snapshot}) {
  const $=id=>document.getElementById(id), dialog=$('sister-bulk-dialog');
  let timer, loading=false, lastQueue;
  const label=s=>`${s.name} · ${s.locality} [${s.id}]`;
  const act=fn=>async event=>{event?.preventDefault();try{$('sister-bulk-feedback').textContent='';await fn();await refresh();}catch(error){$('sister-bulk-feedback').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,"");}};
  async function refresh(){
    if(!dialog.open||loading)return;
    loading=true;
    try {
      const data=await api.sisterQueue();if(!dialog.open)return;
      const version=JSON.stringify(data);
      if(version===lastQueue)return;
      lastQueue=version;
      const states={ready:'Pronta',running:'In acquisizione',paused:'Da riprendere',completed:'Acquisita'};
      $('sister-bulk-rows').innerHTML=data.entries.length?data.entries.map(e=>`<tr><td><strong>${escape(e.name)}</strong><small>${escape(e.municipality)} · ${escape(e.streetId)}</small></td><td>${escape(e.searchText)}</td><td>${escape(e.matchedName || e.resultName)}</td><td><strong>${e.status==='paused'&&e.needsStreetReview?'Via da verificare':states[e.status]}</strong> · ${e.handled}${e.total!==null?'/'+e.total:''}${e.anomalies?`<small>${e.anomalies} righe da verificare</small>`:''}${e.error?`<small>${escape(e.error)}</small>`:''}</td><td>${e.canEdit?`<button data-no-icon data-sister-edit="${escape(e.streetId)}" ${data.active?'disabled':''}>Modifica</button>`:''}<button data-no-icon data-sister-remove="${escape(e.streetId)}" ${data.active?'disabled':''}>Rimuovi</button></td></tr>`).join(''):'<tr><td colspan="5">Aggiungi una via da qui o un’intera zona da «Vie per zona».</td></tr>';
      dialog.querySelectorAll('[data-sister-remove]').forEach(b=>b.onclick=act(()=>api.sisterQueueRemove(b.dataset.sisterRemove)));
      dialog.querySelectorAll('[data-sister-edit]').forEach(b=>b.onclick=()=>{const entry=data.entries.find(e=>e.streetId===b.dataset.sisterEdit),street=snapshot().streets.find(s=>s.id===entry.streetId);$('sister-bulk-street').value=label(street);$('sister-bulk-keyword').value=entry.searchText;$('sister-bulk-name').value=entry.resultName;$('sister-bulk-keyword').focus();});
      const completed=data.entries.filter(e=>e.status==='completed').length;
      const reviews=data.entries.filter(e=>e.status==='paused'&&e.needsStreetReview).length;
      $('sister-bulk-summary').textContent=`${completed}/${data.entries.length} vie acquisite${reviews?` · ${reviews} vie da verificare`:''}${data.active?' · giro in corso':''}${data.entries.some(e=>e.anomalies)?` · ${data.entries.reduce((sum,e)=>sum+(e.anomalies||0),0)} immobili da verificare`:''}`;
      $('sister-bulk-start').textContent=reviews>0&&completed+reviews===data.entries.length?'Riprova vie da verificare':'Avvia / riprendi il giro';
      $('sister-bulk-start').disabled=data.active||completed===data.entries.length;
      $('sister-bulk-pause').disabled=!data.active;
      $('sister-bulk-clear').disabled=data.active||!data.entries.length;
      for(const control of $('sister-bulk-form').elements)control.disabled=data.active;
    }finally{loading=false;}
  }
  $('sister-bulk-open').onclick=act(async()=>{
    if(!snapshot())throw Error('Attendi il caricamento delle vie');
    $('sister-bulk-streets').innerHTML=snapshot().streets.filter(s=>!s.linkedOfficialId&&!s.needsReview).map(s=>`<option value="${escape(label(s))}"></option>`).join('');
    lastQueue=undefined;dialog.showModal();clearInterval(timer);timer=setInterval(()=>refresh().catch(e=>{$('sister-bulk-feedback').textContent=e.message;}),2000);
  });
  $('sister-bulk-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>clearInterval(timer));
  $('sister-bulk-street').onchange=()=>{
    const s=snapshot().streets.find(s=>label(s)===$('sister-bulk-street').value);
    if(s){$('sister-bulk-keyword').value='';$('sister-bulk-name').value=s.sisterName;}
  };
  $('sister-bulk-form').onsubmit=act(async()=>{
    const street=snapshot().streets.find(s=>label(s)===$('sister-bulk-street').value);
    if(!street)throw Error('Seleziona una via dall’elenco');
    await api.sisterQueuePut({streetId:street.id,search:{searchText:$('sister-bulk-keyword').value,resultName:$('sister-bulk-name').value}});
    $('sister-bulk-form').reset();
  });
  $('sister-bulk-start').onclick=act(()=>api.sisterQueueStart());
  $('sister-bulk-pause').onclick=act(()=>api.pause());
  $('sister-bulk-clear').onclick=act(async()=>{
    const button=$('sister-bulk-clear');
    button.disabled=true;
    try{
      const removed=await api.sisterQueueClear();
      if(removed)$('sister-bulk-feedback').textContent=removed===1?'Via rimossa dalla coda.':`${removed} vie rimosse dalla coda.`;
    }finally{lastQueue=undefined;await refresh();}
  });
}
