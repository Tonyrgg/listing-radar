import { currentImportHtml } from "./current-import.js";
import { activityModes, activityLabel, activityOptionsHtml } from "./activity-modes.js";
import { unitRecordHtml } from './unit-card.js';
import { wireUnitEditors } from './unit-editor.js';
import { icon, labelIcons } from './icons.js';

export function createQueuePanel(context) {
  const { api, escape, date, feedback } = context, $ = id => document.getElementById(id);
  let data, selected = new Set(), search = '', limit = 100, phase = 'selection', workId = null, clearConfirmation = null, searchTimer;
  let settings = { includeCoOwners: true, importPolicy: 'create_update', activityMode: 'none' };
  const active = () => Boolean($('detail-dialog').open && $('queue-content'));
  const guard = () => { if (!context.dirty()) return true; feedback('Salva o annulla le correzioni prima di cambiare la coda.', true); return false; };
  const optionsText = (s, activityEnabled = s.activityMode !== 'none') => `${s.importPolicy === 'existing_only' ? 'Solo schede esistenti' : 'Crea o aggiorna'} · ${s.includeCoOwners ? 'Tutti gli intestatari' : 'Intestatario principale'} · ${activityEnabled ? activityLabel(s.activityMode) : activityLabel('none')}`;
  async function refresh() {
    if (!active() || context.dirty()) return;
    data = await api.queue(); if (!active() || context.dirty()) return;
    if (clearConfirmation && clearConfirmation.revision !== data.revision) { clearConfirmation = null; feedback('La coda è cambiata: conferma di nuovo lo svuotamento.', true); }
    const before = [...selected]; selected = new Set(before.filter(key => data.readyKeys.includes(key)));
    if (phase === 'review' && selected.size !== before.length) { phase = 'selection'; feedback('La coda è cambiata: controlla di nuovo la selezione.', true); }
    render();
  }
  function render() {
    const root = $('inspector'), state = $('queue-content') ? context.remember(root) : null, snapshot = context.snapshot();
    const busy = Boolean(snapshot.activeRun), run = snapshot.activeRun?.operation === 'apply' ? snapshot.activeRun : null;
    const ready = new Set(data.readyKeys), chosen = [...selected].filter(key => ready.has(key));
    const needle = search.trim().toLocaleLowerCase('it');
    const rows = data.entries.filter(e => `${e.key} ${e.unit?.source.category || ''} ${e.unit?.source.fullAddress || ''} ${e.unit?.source.owners.map(o => `${o.fullName} ${o.taxCode}`).join(' ') || ''}`.toLocaleLowerCase('it').includes(needle));
    const visibleKeys = new Set(rows.map(e => e.key)), hiddenSelection = chosen.filter(key => !visibleKeys.has(key)).length;
    const result = workId && !run ? data.runs.find(r => r.id === workId && ['completed', 'stopped'].includes(r.state)) : null;
    const displayPhase = run ? 'running' : result ? 'result' : phase;
    const steps = `<ol class="workflow-steps" aria-label="Lavoro dalla coda">${[['selection', 'Scegli'], ['review', 'Controlla'], ['running', 'Avvia']].map(([p, label], i) => `<li ${displayPhase === p ? 'aria-current="step"' : ''} data-done="${displayPhase === 'result' || displayPhase === 'running' && i < 2 || displayPhase === 'review' && i === 0}"><span>${i + 1}</span>${label}</li>`).join('')}</ol>`;
    let body;
    if (clearConfirmation && displayPhase === 'selection') {
      body = `<section class="queue-work queue-clear-confirmation" role="alert"><h3>Svuotare tutta la coda?</h3><p>Rimuovi tutti i ${clearConfirmation.count} immobili, anche quelli esclusi dalla ricerca o non pronti per l’import.</p><p class="meta">Dati, correzioni, storico e verifiche delle scritture restano conservati. Puoi aggiungere di nuovo gli immobili dalle vie o dalle query.</p><div class="actions"><button id="queue-empty-cancel">Annulla</button><button id="queue-empty-confirm" class="danger" ${busy ? 'disabled' : ''}>Svuota tutta la coda</button></div></section>`;
    } else if (displayPhase === 'running') {
      body = `<section class="queue-work"><div id="queue-run" class="run-inline"></div>${currentImportHtml(snapshot.currentItem, run, { escape, date })}<p class="queue-success-count">${Object.keys(run.imports || {}).length} import riusciti e già conservati</p></section>`;
    } else if (displayPhase === 'result') {
      const successes = Object.keys(result.imports || {}).length, skipped = Object.entries(result.skipped || {});
      body = `<section class="queue-work queue-result"><span class="empty-state-icon">${icon(successes ? 'check' : 'info')}</span><h3>${result.state === 'stopped' ? 'Lavoro interrotto' : 'Lavoro terminato'}</h3><p class="queue-result-count">${successes}<span> / ${result.total} import riusciti</span></p>${skipped.length ? `<details class="queue-history" data-disclosure="queue-skipped"><summary>${skipped.length} ${skipped.length === 1 ? 'immobile accantonato' : 'immobili accantonati'}</summary><p class="meta">Gli altri immobili sono stati lavorati. Dati e verifiche da completare restano conservati.</p><ul class="runs-list">${skipped.map(([key, issue]) => `<li class="run-item"><strong>${escape(issue.address || data.entries.find(e => e.key === key)?.unit?.source.fullAddress || key)}</strong><p class="queue-card-problem">${escape(issue.reason)}</p></li>`).join('')}</ul></details>` : ''}<p>Ogni successo è registrato sull’immobile con la sua data.</p>${result.error ? `<p class="queue-card-problem">${escape(result.error)}</p>` : ''}<p class="meta">${data.entries.length ? `${data.entries.length} immobili restano nella coda. Puoi sceglierli, correggerli o rimuoverli.` : 'La coda è vuota.'}</p><button id="queue-return" class="primary">Torna alla coda</button></section>`;
    } else if (displayPhase === 'review') {
      const chosenRows = data.entries.filter(e => selected.has(e.key) && ready.has(e.key));
      body = `<section class="queue-review"><header><span class="eyebrow">Passaggio 2</span><h3>Controlla ${chosen.length} immobili</h3><p class="meta">Il worker confronta il CRM prima di ogni scrittura. Crea le schede mancanti e aggiorna quelle riconosciute; i casi ambigui vanno in quarantena.</p></header><fieldset class="operation-options" ${busy ? 'disabled' : ''}><legend>Opzioni per i nuovi lavori</legend><div class="operation-fields"><label>Schede da gestire<select id="queue-policy"><option value="create_update">Crea o aggiorna secondo il confronto</option><option value="existing_only">Aggiorna soltanto schede esistenti</option></select></label><label>Intestatari<select id="queue-owners"><option value="all">Tutti gli intestatari acquisiti</option><option value="primary">Solo il principale</option></select></label><label>Attività nel gestionale<select id="queue-activity">${activityOptionsHtml()}</select></label></div><p id="queue-activity-hint" class="meta"></p></fieldset><ul class="queue-review-list">${chosenRows.map(e => `<li><div><strong>${escape(e.recovery?.address || e.unit.source.fullAddress)}</strong><span class="mono">${escape(e.key)}</span></div>${e.recovery ? `<p class="queue-card-problem">Scrittura da verificare: conserva il piano originale.</p><p class="meta">${escape(optionsText(e.recovery.settings, e.recovery.activityEnabled))}</p>` : ''}</li>`).join('')}</ul></section><footer class="selection-bar queue-selection"><div><strong>${chosen.length} immobili da lavorare</strong><span class="meta">Ogni import riuscito viene registrato subito.</span></div><div class="actions"><button id="queue-back">Indietro</button><button id="queue-import" class="primary" ${!chosen.length || busy ? 'disabled' : ''}>${snapshot.origin === 'simulation' ? 'Prova import' : 'Avvia import'} (${chosen.length})</button></div></footer>`;
    } else {
      body = `<p class="queue-permanent-note">Scegli gli immobili da lavorare. Le correzioni sono permanenti; rimuovere dalla coda conserva dati e storico.</p>${data.entries.length ? `<div class="queue-controls"><label>Cerca nella coda<input id="queue-search" type="search" value="${escape(search)}" placeholder="Via, catasto o intestatario…"></label><div class="actions"><button id="queue-select-all" ${busy ? 'disabled' : ''}>Seleziona tutti</button><button id="queue-clear" class="quiet" ${!selected.size ? 'disabled' : ''}>Deseleziona</button></div></div><div class="units-grid">${rows.slice(0, limit).map(entry => entry.unit ? unitRecordHtml(entry.unit, { escape, date, selected: selected.has(entry.key), selectionDisabled: busy || entry.locked || Boolean(entry.problem), editDisabled: busy || entry.editLocked, footer: `<div class="queue-card-footer"><span class="meta">In coda dal ${date(entry.addedAt)}</span><button class="quiet" data-queue-remove="${escape(entry.key)}" ${busy ? 'disabled' : ''}>Rimuovi dalla coda</button></div>${entry.problem ? `<p class="queue-card-problem icon-label">${icon('warning')}${escape(entry.problem)}</p>` : entry.retry ? `<p class="meta">Puoi riprovare senza modificare i dati: il worker esegue un nuovo confronto.</p>` : entry.recovery ? `<p class="meta">Scrittura da verificare: al prossimo avvio recuperiamo il piano originale. I dati restano protetti dalle modifiche.</p>` : ''}` }) : `<article class="unit"><h3>${escape(entry.key)}</h3><p>${escape(entry.problem)}</p><button data-queue-remove="${escape(entry.key)}" ${busy ? 'disabled' : ''}>Rimuovi dalla coda</button></article>`).join('') || '<div class="empty-state"><h3>Nessun risultato</h3><p>Cambia la ricerca per ritrovare gli immobili in coda.</p></div>'}</div>${rows.length > limit ? '<button id="queue-more" class="load-more">Mostra altri immobili</button>' : ''}<footer class="selection-bar queue-selection"><div><strong>${chosen.length} immobili selezionati${hiddenSelection ? ' · ' + hiddenSelection + ' fuori dalla ricerca' : ''}</strong><span class="meta">Nel prossimo passaggio controlli opzioni e riepilogo.</span></div><div class="actions"><button id="queue-remove-selected" class="quiet" ${!chosen.length || busy ? 'disabled' : ''}>Rimuovi selezionati</button><button id="queue-continue" class="primary" ${!chosen.length || busy ? 'disabled' : ''}>Continua (${chosen.length})</button></div></footer>` : `<div class="empty-state queue-empty"><span class="empty-state-icon">${icon('layers')}</span><h3>La coda è vuota</h3><p>Apri una via o una query, filtra gli immobili e aggiungi quelli che vuoi importare.</p></div>`}`;
    }
    root.innerHTML = `<section id="queue-content" class="queue-content"><header class="queue-heading"><div><span class="eyebrow">Immobili da lavorare</span><h2>Coda immobili</h2><p class="meta">${data.entries.length} immobili · ${new Set(data.entries.map(e => e.streetId)).size} vie</p></div><div class="actions">${data.entries.length && displayPhase === 'selection' && !clearConfirmation ? `<button id="queue-empty" class="quiet" ${busy ? 'disabled' : ''}>${icon('close')}Svuota coda</button>` : icon('layers')}</div></header>${steps}${body}<details class="queue-history" data-disclosure="queue-history"><summary>Lavori precedenti (${data.runs.length})</summary><ul class="runs-list">${[...data.runs].reverse().slice(0, 10).map(r => `<li class="run-item"><strong>${r.state === 'running' ? 'Lavoro in corso' : 'Lavoro terminato'}</strong><p class="meta">${date(r.startedAt)} · ${Object.keys(r.imports || {}).length} import riusciti su ${r.total} immobili${Object.keys(r.skipped || {}).length ? ` \u00b7 ${Object.keys(r.skipped).length} accantonati` : ''}</p>${r.error || Object.keys(r.skipped || {}).length ? `<details data-disclosure="queue-run-${escape(r.id)}"><summary>Esiti da controllare</summary>${r.error ? `<p class="queue-card-problem">${escape(r.error)}</p>` : ''}<ul class="runs-list">${Object.entries(r.skipped || {}).map(([key, issue]) => `<li class="run-item"><strong>${escape(issue.address || data.entries.find(e => e.key === key)?.unit?.source.fullAddress || key)}</strong><p class="queue-card-problem">${escape(issue.reason)}</p></li>`).join('')}</ul></details>` : ''}</li>`).join('') || '<li class="meta">Nessun lavoro dalla coda.</li>'}</ul></details></section>`;
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
      for (const id of ['queue-policy', 'queue-owners', 'queue-activity']) $(id).onchange = () => { settings = { importPolicy: $('queue-policy').value, includeCoOwners: $('queue-owners').value === 'all', activityMode: $('queue-activity').value }; $('queue-activity-hint').textContent = activityModes[settings.activityMode]?.hint || ''; };
      $('queue-back').onclick = () => { phase = 'selection'; render(); $('queue-continue')?.focus(); };
      $('queue-import').onclick = context.safe(async () => { if (!guard()) return; const id = await api.start({ queue: true, operation: 'apply', selected: chosen, settings }); if (id) { workId = id; phase = 'selection'; selected.clear(); } await context.refresh(); });
    }
    if ($('queue-return')) $('queue-return').onclick = () => { workId = null; phase = 'selection'; selected = new Set(data.readyKeys); render(); $('queue-continue')?.focus(); };
    if ($('queue-more')) $('queue-more').onclick = () => { if (!guard()) return; limit += 100; render(); };
    root.querySelectorAll('[data-unit-select]').forEach(input => { input.onchange = () => { if (!guard()) { input.checked = selected.has(input.dataset.unitSelect); return; } input.checked ? selected.add(input.dataset.unitSelect) : selected.delete(input.dataset.unitSelect); syncSelection(); }; });
    root.querySelectorAll('.unit').forEach(card => { card.onclick = event => { if (!event.target.closest('input,label,button,details,summary,textarea,select,a') && !window.getSelection()?.toString()) card.querySelector('[data-unit-select]:not(:disabled)')?.click(); }; });
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
