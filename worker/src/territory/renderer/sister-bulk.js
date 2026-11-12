export function createSisterBulk({api,escape,snapshot}) {
  const $=id=>document.getElementById(id), dialog=$('sister-bulk-dialog');
  let timer, loading=false;
  const label=s=>`${s.name} · ${s.locality} [${s.id}]`;
  const act=fn=>async event=>{event?.preventDefault();try{await fn();$('sister-bulk-feedback').textContent='';await refresh();}catch(error){$('sister-bulk-feedback').textContent=error.message;}};
  async function refresh(){
    if(!dialog.open||loading)return;
    loading=true;
    try {
      const data=await api.sisterQueue();if(!dialog.open)return;
      const states={ready:'Pronta',running:'In acquisizione',paused:'Da riprendere',completed:'Acquisita'};
      $('sister-bulk-rows').innerHTML=data.entries.length?data.entries.map(e=>`<tr><td><strong>${escape(e.name)}</strong><small>${escape(e.municipality)} · ${escape(e.streetId)}</small></td><td>${escape(e.searchText)}</td><td>${escape(e.resultName)}</td><td>${states[e.status]} · ${e.handled}${e.total!==null?'/'+e.total:''}${e.error?`<small>${escape(e.error)}</small>`:''}</td><td><button data-sister-remove="${escape(e.streetId)}" ${data.active?'disabled':''}>Rimuovi</button></td></tr>`).join(''):'<tr><td colspan="5">Nessuna via in coda. Scegli una via e compila la ricerca Sister.</td></tr>';
      dialog.querySelectorAll('[data-sister-remove]').forEach(b=>b.onclick=act(()=>api.sisterQueueRemove(b.dataset.sisterRemove)));
      const completed=data.entries.filter(e=>e.status==='completed').length;
      $('sister-bulk-summary').textContent=`${completed}/${data.entries.length} vie acquisite${data.active?' · giro in corso':''}`;
      $('sister-bulk-start').disabled=data.active||completed===data.entries.length;
      $('sister-bulk-pause').disabled=!data.active;
      for(const control of $('sister-bulk-form').elements)control.disabled=data.active;
    }finally{loading=false;}
  }
  $('sister-bulk-open').onclick=act(async()=>{
    if(!snapshot())throw Error('Attendi il caricamento delle vie');
    $('sister-bulk-streets').innerHTML=snapshot().streets.filter(s=>!s.linkedOfficialId&&!s.needsReview).map(s=>`<option value="${escape(label(s))}"></option>`).join('');
    dialog.showModal();clearInterval(timer);timer=setInterval(()=>refresh().catch(e=>{$('sister-bulk-feedback').textContent=e.message;}),2000);
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
}
