import { currentImportHtml } from "./current-import.js";
import { activityModes, activityLabel, activityOptionsHtml } from "./activity-modes.js";
import { unitTableHtml, sortUnits, nextUnitSort } from './unit-table.js';
import { unitRecordHtml } from './unit-card.js';
import { wireUnitEditors } from './unit-editor.js';
import { icon, labelIcons } from './icons.js';

export function createQueuePanel(context) {
  const { api, escape, date, feedback } = context, $ = id => document.getElementById(id);
  let data, selected = new Set(), search = '', limit = 100, phase = 'selection', workId = null, clearConfirmation = null, searchTimer;
  let queueSort={key:'address',direction:'asc'},expandedKey=null;
  let settings = { includeCoOwners: true, importPolicy: 'create_update', activityMode: 'none' };
  const active = () => Boolean($('detail-dialog').open && $('queue-content'));
  const guard = () => { if (!context.dirty()) return true; feedback('Salva o annulla le correzioni prima di cambiare la coda.', true); return false; };
  const optionsText = (s, activityEnabled = s.activityMode !== 'none') => `${s.importPolicy === 'existing_only' ? 'Solo schede esistenti' : 'Crea o aggiorna'} · ${s.includeCoOwners ? 'Tutti gli intestatari' : 'Intestatario principale'} · ${activityEnabled ? activityLabel(s.activityMode) : activityLabel('none')}`;
  const entryActivityMode = entry => entry.recovery ? entry.recovery.activityEnabled ? entry.recovery.settings.activityMode : entry.recovery.canEnableActivity ? settings.activityMode : 'none' : settings.activityMode;
  const activityResult = summary => summary ? `<p class="meta">Attività: <strong>${summary.created} inserite e verificate</strong> · ${summary.recovered} salvataggi recuperati · ${summary.coveredProperty||0} già presenti sull’immobile questo mese · ${summary.coveredClient||0} accorpate per cliente nella giornata · ${summary.disabled} non richieste${summary.unconfirmed ? ` · ${summary.unconfirmed} senza prova conservata` : ''}</p>` : '';
  let previewVersion=0;
  async function activityPreview() {
    const chosen = data.entries.filter(e => selected.has(e.key) && data.readyKeys.includes(e.key));
    const count = chosen.filter(e => entryActivityMode(e) !== 'none').length;
    const target=$('queue-activity-total'),version=++previewVersion;
    const start=$('queue-import');if(start)start.disabled=true;
    target.textContent = `Calcolo delle attività per ${chosen.length} immobili…`;
    try{
      const preview=await api.queuePreview({keys:chosen.map(e=>e.key),settings});
      if(version===previewVersion&&target.isConnected){target.textContent=`${preview.properties} immobili da verificare · massimo ${preview.candidateActivities} attività nuove · ${preview.consolidated} accorpabili per cliente${preview.withoutActivity?` · ${preview.withoutActivity} senza attività`:''}. Le attività già presenti nel CRM possono ridurre ulteriormente il totale; saranno verificate prima di ogni inserimento.`;if(start)start.disabled=!chosen.length||Boolean(context.snapshot().activeRun);}
    }catch{
      if(version===previewVersion&&target.isConnected)target.textContent=`${count} immobili con attività richiesta. Conteggio dei clienti non disponibile: aggiorna la coda prima di partire.`;
    }
    if(version!==previewVersion||!target.isConnected)return;
    for (const row of document.querySelectorAll('[data-queue-recovery]')) {
      const entry = chosen.find(e => e.key === row.dataset.queueRecovery);
      if (entry) row.textContent = optionsText({ ...entry.recovery.settings, activityMode: entryActivityMode(entry) });
    }
  }
  async function refresh() {
    if (!active() || context.dirty()) return;
    data = await api.queue(); if (!active() || context.dirty()) return;
    if (clearConfirmation && clearConfirmation.revision !== data.revision) { clearConfirmation = null; feedback('La coda è cambiata: conferma di nuovo lo svuotamento.', true); }
    const before = [...selected]; selected = new Set(before.filter(key => data.readyKeys.includes(key)));
    if (phase === 'review' && selected.size !== before.length) { phase = 'selection'; feedback('La coda è cambiata: controlla di nuovo la selezione.', true); }
    render();
  }
  const unitFor = entry => entry.unit || {key:entry.key,source:{fullAddress:entry.recovery?.address||'Immobile non disponibile',category:'',cadastral:{},owners:[]},position:{floors:[],civic:null}};
  function rowMeta(unit){
    const entry=data.entries.find(e=>e.key===unit.key);
    return {disabled:!entry?.unit||entry.locked||Boolean(entry.problem),decision:entry?.problem||entry?.recovery?'review':entry?.retry?'update':'ready',
      stateLabel:!entry?.unit?'Non disponibile':entry.problem?'Da verificare':entry.locked?'In lavorazione':entry.recovery?'Da verificare':entry.retry?'Da riprovare':'Pronto'};
  }
  function recordDetails(unit){
    const entry=data.entries.find(e=>e.key===unit.key),busy=Boolean(context.snapshot().activeRun);
    const footer=`<div class="queue-card-footer"><span class="meta">In coda dal ${date(entry.addedAt)}</span>${phase==='selection'?`<button class="quiet" data-queue-remove="${escape(entry.key)}" ${busy?'disabled':''}>Rimuovi dalla coda</button>`:''}</div>${entry.problem?`<p class="queue-card-problem">${escape(entry.problem)}</p>`:''}${entry.recovery?`<p class="meta" data-queue-recovery="${escape(entry.key)}">${escape(optionsText(entry.recovery.settings,entry.recovery.activityEnabled))}</p>`:''}`;
    return entry.unit?unitRecordHtml(unit,{escape,date,detailsOnly:true,editDisabled:busy||entry.editLocked||phase!=='selection',footer}):`<section class="unit-expanded"><p>Scheda non disponibile: nessun dato ricostruito.</p>${footer}</section>`;
  }
  function table(entries,busy){
    return unitTableHtml(sortUnits(entries.map(unitFor),queueSort,rowMeta).slice(0,limit),{escape,selected,disabled:busy||phase!=='selection',queued:new Set(),expandedKey,renderDetails:recordDetails,sort:queueSort,showAddress:true,rowMeta});
  }
  function render() {
    const root = $('inspector'), state = $('queue-content') ? context.remember(root) : null, snapshot = context.snapshot();
    const busy = Boolean(snapshot.activeRun), run = snapshot.activeRun?.operation === 'apply' ? snapshot.activeRun : null;
    $('detail-dialog').dataset.panel='queue';
    const ready = new Set(data.readyKeys), chosen = [...selected].filter(key => ready.has(key));
    const needle = search.trim().toLocaleLowerCase('it');
    const rows = data.entries.filter(e => `${e.key} ${e.unit?.source.category || ''} ${e.unit?.source.fullAddress || ''} ${e.unit?.source.owners.map(o => `${o.fullName} ${o.taxCode}`).join(' ') || ''}`.toLocaleLowerCase('it').includes(needle));
    const visibleKeys = new Set(rows.map(e => e.key)), hiddenSelection = chosen.filter(key => !visibleKeys.has(key)).length;
    const result = workId && !run ? data.runs.find(r => r.id === workId && ['completed', 'stopped'].includes(r.state)) : null;
    const displayPhase = run ? 'running' : result ? 'result' : phase;
    const steps = `<ol class="workflow-steps" aria-label="Lavoro dalla coda">${[['selection', 'Scegli'], ['review', 'Controlla'], ['running', 'Avvia']].map(([p, label], i) => `<li ${displayPhase === p ? 'aria-current="step"' : ''} data-done="${displayPhase === 'result' || displayPhase === 'running' && i < 2 || displayPhase === 'review' && i === 0}"><span>${i + 1}</span>${label}</li>`).join('')}</ol>`;
    let body;
    if (clearConfirmation && displayPhase === 'selection') {
      body = `<section class="queue-work queue-clear-confirmation" role="alert"><h3>Svuotare tutta la coda?</h3><p>Rimuovi tutti i ${clearConfirmation.count} immobili, anche quelli esclusi dalla ricerca o non pronti per la lavorazione.</p><p class="meta">Dati, correzioni, storico e verifiche delle scritture restano conservati. Puoi aggiungere di nuovo gli immobili dalle vie o dalle query.</p><div class="actions"><button id="queue-empty-cancel">Annulla</button><button id="queue-empty-confirm" class="danger" ${busy ? 'disabled' : ''}>Svuota tutta la coda</button></div></section>`;
    } else if (displayPhase === 'running') {
      body = `<section class="queue-work"><div id="queue-run" class="run-inline"></div>${currentImportHtml(snapshot.currentItem, run, { escape, date })}${activityResult(run.activitySummary)}<p class="queue-success-count">${Object.keys(run.imports || {}).length} lavorazioni concluse e conservate</p></section>`;
    } else if (displayPhase === 'result') {
      const successes = Object.keys(result.imports || {}).length, skipped = Object.entries(result.skipped || {});
      body = `<section class="queue-work queue-result"><span class="empty-state-icon">${icon(successes ? 'check' : 'info')}</span><h3>${result.state === 'stopped' ? 'Lavoro interrotto' : 'Lavoro terminato'}</h3><p class="queue-result-count">${successes}<span> / ${result.total} lavorazioni completate</span></p>${skipped.length ? `<details class="queue-history" data-disclosure="queue-skipped"><summary>${skipped.length} ${skipped.length === 1 ? 'immobile accantonato' : 'immobili accantonati'}</summary><p class="meta">Gli altri immobili sono stati lavorati. Dati e verifiche da completare restano conservati.</p><ul class="runs-list">${skipped.map(([key, issue]) => `<li class="run-item"><strong>${escape(issue.address || data.entries.find(e => e.key === key)?.unit?.source.fullAddress || key)}</strong><p class="queue-card-problem">${escape(issue.reason)}</p></li>`).join('')}</ul></details>` : ''}<p>Ogni successo è registrato sull’immobile con la sua data.</p>${activityResult(result.activitySummary)}${result.error ? `<p class="queue-card-problem">${escape(result.error)}</p>` : ''}<p class="meta">${data.entries.length ? `${data.entries.length} immobili restano nella coda. Puoi sceglierli, correggerli o rimuoverli.` : 'La coda è vuota.'}</p><button id="queue-return" class="primary">Torna alla coda</button></section>`;
    } else if (displayPhase === 'review') {
      const chosenRows = data.entries.filter(e => selected.has(e.key) && ready.has(e.key));
      body = `<section class="queue-review"><header><span class="eyebrow">Passaggio 2</span><h3>Controlla ${chosen.length} immobili</h3><p class="meta">Il worker confronta il CRM prima di ogni scrittura. Crea le schede mancanti e aggiorna quelle riconosciute; i casi ambigui vanno in quarantena.</p></header><fieldset class="operation-options" ${busy ? 'disabled' : ''}><legend>Opzioni per i nuovi lavori</legend><div class="operation-fields"><label>Schede da gestire<select id="queue-policy"><option value="create_update">Crea o aggiorna secondo il confronto</option><option value="existing_only">Aggiorna soltanto schede esistenti</option></select></label><label>Intestatari<select id="queue-owners"><option value="all">Tutti gli intestatari acquisiti</option><option value="primary">Solo il principale</option></select></label><label>Attività nel gestionale<select id="queue-activity">${activityOptionsHtml()}</select></label></div><p id="queue-activity-hint" class="meta"></p></fieldset>${table(chosenRows,busy)}</section><footer class="selection-bar queue-selection"><div><strong>${chosen.length} immobili da lavorare</strong><span class="meta">La lavorazione si chiude dopo la verifica dell’attività o della copertura già presente.</span></div><div class="actions"><button id="queue-back">Indietro</button><button id="queue-import" class="primary" ${!chosen.length || busy ? 'disabled' : ''}>${snapshot.origin === 'simulation' ? 'Prova lavorazione' : 'Avvia lavorazione'} (${chosen.length})</button></div></footer>`;
    } else {
      body = data.entries.length ? `<div class="queue-controls"><label class="unit-search-control"><span class="sr-only">Cerca nella coda</span>${icon('search')}<input id="queue-search" type="search" value="${escape(search)}" placeholder="Cerca via, catasto o intestatario"></label><div class="actions"><button id="queue-select-all" ${busy?'disabled':''}>Seleziona tutti</button><button id="queue-clear" class="quiet" ${!selected.size?'disabled':''}>Deseleziona</button></div></div>${rows.length?table(rows,busy):'<div class="empty-state"><h3>Nessun risultato</h3><p>Cambia la ricerca.</p></div>'}${rows.length>limit?'<button id="queue-more" class="load-more">Mostra altri immobili</button>':''}<footer class="selection-bar queue-selection"><div><strong>${chosen.length} immobili selezionati${hiddenSelection?' · '+hiddenSelection+' fuori dalla ricerca':''}</strong></div><div class="actions"><button id="queue-remove-selected" class="quiet" ${!chosen.length||busy?'disabled':''}>Rimuovi selezionati</button><button id="queue-continue" class="primary" ${!chosen.length||busy?'disabled':''}>Continua (${chosen.length})</button></div></footer>` : `<div class="empty-state queue-empty"><h3>La coda è vuota</h3><p>Aggiungi gli immobili dalla scheda di una via o dalle query.</p></div>`;
    }
    root.innerHTML = `<section id="queue-content" class="queue-content" data-phase="${displayPhase}"><header class="queue-heading"><div><h2>Coda immobili</h2><p class="meta">${data.entries.length} immobili · ${data.readyKeys.length} pronti${data.entries.length-data.readyKeys.length?' · '+(data.entries.length-data.readyKeys.length)+' da verificare':''}</p></div><details class="queue-tools" data-disclosure="queue-tools"><summary>${icon('settings')}Strumenti</summary><div class="queue-tools-menu">${data.entries.length&&displayPhase==='selection'&&!clearConfirmation?`<button id="queue-empty" class="quiet" ${busy?'disabled':''}>Svuota tutta la coda</button>`:''}<details class="queue-history" data-disclosure="queue-history"><summary>Lavori precedenti (${data.runs.length})</summary><ul class="runs-list">${[...data.runs].reverse().slice(0, 10).map(r => `<li class="run-item"><strong>${r.state === 'running' ? 'Lavoro in corso' : 'Lavoro terminato'}</strong><p class="meta">${date(r.startedAt)} · ${Object.keys(r.imports || {}).length} immobili verificati su ${r.total} immobili${Object.keys(r.skipped || {}).length ? ` \u00b7 ${Object.keys(r.skipped).length} accantonati` : ''}</p>${r.error || Object.keys(r.skipped || {}).length ? `<details data-disclosure="queue-run-${escape(r.id)}"><summary>Esiti da controllare</summary>${r.error ? `<p class="queue-card-problem">${escape(r.error)}</p>` : ''}<ul class="runs-list">${Object.entries(r.skipped || {}).map(([key, issue]) => `<li class="run-item"><strong>${escape(issue.address || data.entries.find(e => e.key === key)?.unit?.source.fullAddress || key)}</strong><p class="queue-card-problem">${escape(issue.reason)}</p></li>`).join('')}</ul></details>` : ''}</li>`).join('') || '<li class="meta">Nessun lavoro dalla coda.</li>'}</ul></details></div></details></header>${steps}${body}</section>`;
    root.querySelector('.queue-heading').insertAdjacentHTML('beforeend','<button id="queue-open-browser" class="quiet">Apri Chrome di lavoro</button>');
    const followUpHtml=r=>Object.keys(r.followUps||{}).length?`<details class="queue-history"><summary>Attività concluse, altri dati da verificare (${Object.keys(r.followUps).length})</summary><ul>${Object.values(r.followUps).map(issue=>`<li><strong>${escape(issue.address||'Immobile')}</strong><p>${escape(issue.reason)}</p></li>`).join('')}</ul></details>`:'';
    if(result)root.querySelector('.queue-result')?.insertAdjacentHTML('beforeend',followUpHtml(result));
    const history=root.querySelector('[data-disclosure="queue-history"]');
    for(const previous of data.runs){
      history?.insertAdjacentHTML('beforeend',followUpHtml(previous));
      if(Object.keys(previous.skipped||{}).length)history?.insertAdjacentHTML('beforeend',`<button class="quiet" data-requeue-run="${escape(previous.id)}" ${busy?'disabled':''}>Riprepara i casi da verificare · ${date(previous.startedAt)}</button>`);
    }
    root.querySelectorAll('[data-requeue-run]').forEach(button=>{button.onclick=context.safe(async()=>{const previous=data.runs.find(r=>r.id===button.dataset.requeueRun);await api.enqueue({keys:Object.keys(previous?.skipped||{})});await context.refresh();});});
    $('queue-open-browser').onclick=context.safe(async()=>{await api.openBrowser();feedback('Chrome di lavoro aperto.');});
    if ($('queue-empty')) $('queue-empty').onclick = () => { if (!guard()) return; clearTimeout(searchTimer); clearConfirmation = { revision: data.revision, count: data.entries.length }; render(); $('queue-empty-cancel').focus(); };
    if ($('queue-empty-cancel')) $('queue-empty-cancel').onclick = () => { clearConfirmation = null; render(); $('queue-empty')?.focus(); };
    if ($('queue-empty-confirm')) $('queue-empty-confirm').onclick = context.safe(async () => { if (!guard() || busy) return; const revision = clearConfirmation.revision; const count = await api.clearQueue({ revision }); clearConfirmation = null; selected.clear(); search = ''; phase = 'selection'; workId = null; await context.refresh(); feedback(`${count} immobili rimossi dalla coda. Dati e storico conservati.`); });
    if ($('queue-search')) {
      $('queue-search').oninput = event => { if (!guard()) { event.target.value = search; return; } search = event.target.value; limit = 100; clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (active() && !context.dirty()) render(); }, 180); };
      $('queue-select-all').onclick = () => { if (!guard()) return; rows.filter(e => ready.has(e.key)).forEach(e => selected.add(e.key)); syncSelection(); };
      $('queue-clear').onclick = () => { if (!guard()) return; selected.clear(); syncSelection(); };
      $('queue-continue').onclick = () => { if (!guard()) return; phase = 'review'; render(); $('queue-policy').focus(); };
      $('queue-remove-selected').onclick = context.safe(async () => { if (!guard()) return; await api.dequeue({ keys: chosen }); await context.refresh(); });
    }
    if ($('queue-policy')) {
      $('queue-policy').value = settings.importPolicy;
      $('queue-owners').value = settings.includeCoOwners ? 'all' : 'primary';
      $('queue-activity').value = settings.activityMode;
      $('queue-activity-hint').textContent = activityModes[settings.activityMode]?.hint || '';
      const total = document.createElement('p'); total.id = 'queue-activity-total'; total.className = 'meta'; total.setAttribute('role', 'status'); $('queue-activity-hint').after(total);
      activityPreview();
      for (const id of ['queue-policy', 'queue-owners', 'queue-activity']) $(id).onchange = () => { settings = { importPolicy: $('queue-policy').value, includeCoOwners: $('queue-owners').value === 'all', activityMode: $('queue-activity').value }; $('queue-activity-hint').textContent = activityModes[settings.activityMode]?.hint || ''; activityPreview(); };
      $('queue-back').onclick = () => { phase = 'selection'; render(); $('queue-continue')?.focus(); };
      $('queue-import').onclick = context.safe(async () => { if (!guard()) return; const id = await api.start({ queue: true, operation: 'apply', selected: chosen, settings }); if (id) { workId = id; phase = 'selection'; selected.clear(); } await context.refresh(); });
    }
    if ($('queue-return')) $('queue-return').onclick = () => { workId = null; phase = 'selection'; selected = new Set(data.readyKeys); render(); $('queue-continue')?.focus(); };
    if ($('queue-more')) $('queue-more').onclick = () => { if (!guard()) return; limit += 100; render(); };
    root.querySelectorAll('[data-unit-select]').forEach(input => { input.onchange = () => { if (!guard()) { input.checked = selected.has(input.dataset.unitSelect); return; } input.checked ? selected.add(input.dataset.unitSelect) : selected.delete(input.dataset.unitSelect); syncSelection(); }; });
    root.querySelectorAll('[data-unit-sort]').forEach(button=>{button.onclick=()=>{
      if(!guard())return;const key=button.dataset.unitSort;queueSort=nextUnitSort(queueSort,key);render();
      $('inspector').querySelector('.unit-table-scroll')?.scrollTo(0,0);
      $('inspector').querySelector(`[data-unit-sort="${key}"]`)?.focus({preventScroll:true});
    };});
    root.querySelectorAll('[data-unit-open]').forEach(button=>{button.onclick=()=>{
      if(!guard())return;expandedKey=expandedKey===button.dataset.unitOpen?null:button.dataset.unitOpen;render();
    };});
    root.querySelectorAll('.unit-table-row').forEach(row=>{row.onclick=event=>{
      if(!event.target.closest('input,label,button,a')&&!window.getSelection()?.toString())row.querySelector('[data-unit-open]')?.click();
    };});
    root.querySelectorAll('[data-queue-remove]').forEach(button => { button.onclick = context.safe(async () => { if (!guard()) return; await api.dequeue({ keys: [button.dataset.queueRemove] }); await context.refresh(); }); });
    wireUnitEditors(root, data.entries.filter(e => e.unit).map(e => e.unit), { ...context, afterSave: () => context.refresh(), cancel: form => { context.cancel(form); if (!context.dirty()) void refresh(); } });
    if (run) context.progressContent($('queue-run'), run, snapshot.streets.find(s => s.id === run.streetId), 'queue-pause');
    context.notifyRunIssue(data.runs.at(-1)); labelIcons(root);
    if (state) context.restore(root, state);
  }
  function syncSelection() {
    // Keep editors, disclosures, focus and scroll mounted when only selection changes.
    const ready = new Set(data.readyKeys), chosen = [...selected].filter(key => ready.has(key));
    const cards = $('inspector').querySelectorAll('[data-unit]');
    const needle = search.trim().toLocaleLowerCase('it');
    const matching = new Set(data.entries.filter(e => `${e.key} ${e.unit?.source.category || ''} ${e.unit?.source.fullAddress || ''} ${e.unit?.source.owners.map(o => `${o.fullName} ${o.taxCode}`).join(' ') || ''}`.toLocaleLowerCase('it').includes(needle)).map(e => e.key));
    const hidden = chosen.filter(key => !matching.has(key)).length;
    for (const card of cards) {
      const key = card.dataset.unit;
      card.dataset.selected = String(selected.has(key));
      card.querySelector('[data-unit-select]').checked = selected.has(key);
    }
    $('queue-clear').disabled = !selected.size;
    $('queue-remove-selected').disabled = !chosen.length || Boolean(context.snapshot().activeRun);
    $('queue-continue').disabled = !chosen.length || Boolean(context.snapshot().activeRun);
    $('queue-continue').textContent = `Continua (${chosen.length})`;
    labelIcons($('queue-continue').parentElement);
    $('queue-remove-selected').onclick = context.safe(async () => { if (!guard()) return; await api.dequeue({ keys: chosen }); await context.refresh(); });
    $('inspector').querySelector('.queue-selection strong').textContent = `${chosen.length} immobili selezionati${hidden ? ' · ' + hidden + ' fuori dalla ricerca' : ''}`;
  }
  async function open() {
    if (!await context.open()) return;
    clearTimeout(searchTimer); clearConfirmation = null; data = await api.queue(); search = ''; limit = 100; phase = 'selection'; workId = null; selected = new Set(data.readyKeys);
    const last = [...data.runs].reverse().find(r => r.settings); if (last) settings = { includeCoOwners: last.settings.includeCoOwners, importPolicy: last.settings.importPolicy, activityMode: last.settings.activityMode };
    render();
  }
  return { open, refresh, get active() { return active(); } };
}
