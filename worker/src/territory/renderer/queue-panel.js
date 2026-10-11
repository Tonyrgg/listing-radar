import { unitRecordHtml } from './unit-card.js';
import { wireUnitEditors } from './unit-editor.js';
import { icon, labelIcons } from './icons.js';

export function createQueuePanel(context) {
  const { api, escape, date, feedback } = context, $ = id => document.getElementById(id);
  let data, selected = new Set(), search = '', limit = 100;
  let settings = { includeCoOwners: true, importPolicy: 'create_update', activityMode: 'none' };
  const active = () => Boolean($('detail-dialog').open && $('queue-content'));
  const guard = () => { if (!context.dirty()) return true; feedback('Salva o annulla le correzioni prima di cambiare la coda.', true); return false; };
  async function refresh() {
    if (!active() || context.dirty()) return;
    data = await api.queue(); if (!active() || context.dirty()) return;
    selected = new Set([...selected].filter(key => data.readyKeys.includes(key)));
    render();
  }
  function render() {
    const root = $('inspector'), state = $('queue-content') ? context.remember(root) : null, snapshot = context.snapshot();
    const busy = Boolean(snapshot.activeRun);
    const pending = data.runs.filter(r => ['paused', 'failed'].includes(r.state) && r.handled < r.itemKeys.length);
    const ready = new Set(data.readyKeys), chosen = [...selected].filter(key => ready.has(key));
    const needle = search.trim().toLocaleLowerCase('it');
    const rows = data.entries.filter(e => `${e.key} ${e.unit?.source.category || ""} ${e.unit?.source.fullAddress || ""} ${e.unit?.source.owners.map(o => `${o.fullName} ${o.taxCode}`).join(' ') || ''}`.toLocaleLowerCase('it').includes(needle));
    const visibleKeys = new Set(rows.map(e => e.key)), hiddenSelection = chosen.filter(key => !visibleKeys.has(key)).length;
    root.innerHTML = `<section id="queue-content" class="queue-content"><header class="queue-heading"><div><span class="eyebrow">Import in Tecnocloud</span><h2>Coda immobili</h2><p class="meta">${data.entries.length} immobili · ${new Set(data.entries.map(e => e.streetId)).size} vie · ${ready.size} pronti</p></div>${icon('layers')}</header><div id="queue-run" class="run-inline" hidden></div>${pending.map(run => `<section class="queue-resume run-item"><strong>Import da riprendere · ${run.handled}/${run.total} elaborati</strong><p class="explanation">${escape(run.error || 'Avanzamento e opzioni originali conservati.')}</p><button class="primary" data-queue-resume="${escape(run.id)}" ${busy ? 'disabled' : ''}>Riprendi import</button></section>`).join('')}<p class="queue-permanent-note icon-label">${icon('info')}Le correzioni aggiornano la memoria dell’immobile in tutte le viste. Rimuovere dalla coda conserva dati e storico.</p>${data.entries.length ? `<div class="queue-controls"><label>Cerca nella coda<input id="queue-search" type="search" value="${escape(search)}" placeholder="Via, catasto o intestatario…"></label><div class="actions"><button id="queue-select-all" ${busy ? 'disabled' : ''}>Seleziona tutti</button><button id="queue-clear" class="quiet" ${!selected.size ? 'disabled' : ''}>Deseleziona</button></div></div><details class="operation-options" data-disclosure="queue-options"><summary>Opzioni dell’import</summary><fieldset ${busy || pending.length ? 'disabled' : ''}><div class="operation-fields"><label>Schede da gestire<select id="queue-policy"><option value="create_update">Crea o aggiorna secondo il confronto</option><option value="existing_only">Aggiorna soltanto schede esistenti</option></select></label><label>Intestatari<select id="queue-owners"><option value="all">Tutti gli intestatari acquisiti</option><option value="primary">Solo il principale</option></select></label><label>Attività nel gestionale<select id="queue-activity"><option value="none">Nessuna attività</option><option value="plain">Telefonata da eseguire</option></select></label></div><p class="meta">Il confronto viene eseguito prima di ogni scrittura. Le riprese mantengono il piano originale.</p></fieldset></details><div class="units-grid">${rows.slice(0, limit).map(entry => entry.unit ? unitRecordHtml(entry.unit, { escape, date, selected: selected.has(entry.key), selectionDisabled: busy || entry.locked || Boolean(entry.problem), editDisabled: busy || entry.locked, footer: `<div class="queue-card-footer"><span class="meta">In coda dal ${date(entry.addedAt)}${entry.locked ? ' · piano da concludere' : ''}</span><button class="quiet" data-queue-remove="${escape(entry.key)}" ${entry.locked ? 'disabled' : ''}>Rimuovi dalla coda</button></div>${entry.problem ? `<p class="queue-card-problem icon-label">${icon('warning')}${escape(entry.problem)}</p>` : ''}` }) : `<article class="unit"><h3>${escape(entry.key)}</h3><p>${escape(entry.problem)}</p><button data-queue-remove="${escape(entry.key)}">Rimuovi dalla coda</button></article>`).join('') || '<div class="empty-state"><h3>Nessun risultato</h3><p>Cambia la ricerca per ritrovare gli immobili in coda.</p></div>'}</div>${rows.length > limit ? '<button id="queue-more" class="load-more">Mostra altri immobili</button>' : ''}<footer class="selection-bar queue-selection"><div><strong>${chosen.length} immobili selezionati${hiddenSelection ? " · " + hiddenSelection + " fuori dalla ricerca" : ""}</strong><span class="meta">Gli import verificati escono dalla coda; le anomalie restano da gestire.</span></div><div class="actions"><button id="queue-remove-selected" class="quiet" ${!chosen.length || busy ? 'disabled' : ''}>Rimuovi selezionati</button><button id="queue-import" class="primary" ${!chosen.length || busy || pending.length ? 'disabled' : ''}>${snapshot.origin === 'simulation' ? 'Prova import' : 'Importa in Tecnocloud'} (${chosen.length})</button></div></footer>` : `<div class="empty-state queue-empty"><span class="empty-state-icon">${icon('layers')}</span><h3>La coda è vuota</h3><p>Apri una via o una query, filtra gli immobili e aggiungi quelli che vuoi importare.</p></div>`}<details class="queue-history" data-disclosure="queue-history"><summary>Ultimi import (${data.runs.length})</summary><ul class="runs-list">${[...data.runs].reverse().slice(0, 10).map(run => `<li class="run-item"><strong>${run.state === 'completed' ? 'Import concluso' : run.state === 'running' ? 'Import in corso' : 'Import da riprendere'}</strong><p class="meta">${date(run.startedAt)} · ${Object.keys(run.imports || {}).length} import verificati su ${run.total} immobili</p></li>`).join('') || '<li class="meta">Nessun import dalla coda.</li>'}</ul></details></section>`;
    if ($('queue-search')) {
      $('queue-search').oninput = event => { if (!guard()) { event.target.value = search; return; } search = event.target.value; limit = 100; render(); };
      $('queue-select-all').onclick = () => { if (!guard()) return; rows.filter(e => ready.has(e.key)).forEach(e => selected.add(e.key)); render(); };
      $('queue-clear').onclick = () => { if (!guard()) return; selected.clear(); render(); };
      $('queue-policy').value = settings.importPolicy;
      $('queue-owners').value = settings.includeCoOwners ? 'all' : 'primary';
      $('queue-activity').value = settings.activityMode;
      for (const id of ['queue-policy', 'queue-owners', 'queue-activity']) $(id).onchange = () => { settings = { importPolicy: $('queue-policy').value, includeCoOwners: $('queue-owners').value === 'all', activityMode: $('queue-activity').value }; };
      $('queue-import').onclick = context.safe(async () => { if (!guard()) return; const id = await api.start({ queue: true, operation: 'apply', selected: chosen, settings }); if (id) selected.clear(); await context.refresh(); });
      $('queue-remove-selected').onclick = context.safe(async () => { if (!guard()) return; await api.dequeue({ keys: chosen }); await context.refresh(); });
    }
    if ($('queue-more')) $('queue-more').onclick = () => { if (!guard()) return; limit += 100; render(); };
    root.querySelectorAll('[data-unit-select]').forEach(input => { input.onchange = () => { if (!guard()) { input.checked = selected.has(input.dataset.unitSelect); return; } input.checked ? selected.add(input.dataset.unitSelect) : selected.delete(input.dataset.unitSelect); render(); }; });
    root.querySelectorAll('.unit').forEach(card => { card.onclick = event => { if (!event.target.closest('input,label,button,details,summary,textarea,select,a') && !window.getSelection()?.toString()) card.querySelector('[data-unit-select]:not(:disabled)')?.click(); }; });
    root.querySelectorAll('[data-queue-remove]').forEach(button => { button.onclick = context.safe(async () => { if (!guard()) return; await api.dequeue({ keys: [button.dataset.queueRemove] }); await context.refresh(); }); });
    root.querySelectorAll('[data-queue-resume]').forEach(button => { button.onclick = context.safe(async () => { if (!guard()) return; await api.start({ queue: true, operation: 'apply', resumeId: button.dataset.queueResume }); await context.refresh(); }); });
    wireUnitEditors(root, data.entries.filter(e => e.unit).map(e => e.unit), { ...context, afterSave: () => context.refresh(), cancel: form => { context.cancel(form); if (!context.dirty()) void refresh(); } });
    const run = snapshot.activeRun; $('queue-run').hidden = !run;
    if (run) context.progressContent($('queue-run'), run, context.snapshot().streets.find(s => s.id === run.streetId), 'queue-pause');
    context.notifyRunIssue(data.runs.at(-1)); labelIcons(root);
    if (state) context.restore(root, state);
  }
  async function open() {
    if (!await context.open()) return;
    data = await api.queue(); search = ''; limit = 100; selected = new Set(data.readyKeys);
    const last = [...data.runs].reverse().find(r => r.settings); if (last) settings = { includeCoOwners: last.settings.includeCoOwners, importPolicy: last.settings.importPolicy, activityMode: last.settings.activityMode };
    render();
  }
  return { open, refresh, get active() { return active(); } };
}
