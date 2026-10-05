/* The renderer receives data and explicit commands only, never filesystem or credentials. */
(() => {
  const api = window.territory;
  api.onAppearance?.(value => { document.body.classList.toggle('integrated', value.integrated); document.documentElement.dataset.theme = value.theme; if (snapshot) paint(); });
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => value ? new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : 'Non ancora acquisita';
  const decisions = { unknown: 'Da confrontare', create: 'Da creare', update: 'Da aggiornare', unchanged: 'Già coerente', review: 'Da verificare', synced: 'Allineato' };
  const operations = { scan: 'Acquisizione della via', compare: 'Confronto con il gestionale', apply: 'Applicazione del piano' };
  const runStates = { running: 'In corso', paused: 'Da riprendere', completed: 'Conclusa', failed: 'Interrotta' };
  let snapshot = null, detail = null, selectedStreet = null, tab = 'dossier', dirty = false, request = 0;
  const selected = new Set(), layers = new Map();
  const dirtyForms = new Set();
  let hoverId = null, hideTimer = null, feedbackTimer = null;
  let hoverPoint = null;
  let highlightedId = null, highlightSource = null;
  const stroke = { weight: 2, opacity: .7 }, hoverStroke = { weight: 6, opacity: 1 };
  let historyView = false, historyRows = [], historyFilter = '';
  let testsView = false, testConfig = null, testFilter = '';
  let networkView = false, pinnedPreview = false, dialogOpener = null;
  const testSelected = new Set();
  let syncBusy = false;
  function markDirty(form) { dirtyForms.add(form); dirty = true; }
  function saved(form) {
    dirtyForms.delete(form); dirty = Boolean(dirtyForms.size);
    for (const input of form.querySelectorAll('input,textarea')) { if (input.type === 'checkbox') input.defaultChecked = input.checked; else input.defaultValue = input.value; }
  }
  const map = L.map('map', { zoomControl: false, preferCanvas: true, renderer: L.canvas({ tolerance: 5 }) }).setView([41.11, 16.69], 15);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  tiles.on('tileerror', () => { $('map-offline').hidden = false; });
  tiles.on('tileload', () => { $('map-offline').hidden = true; });
  const colors = () => {
    const s = getComputedStyle(document.documentElement), token = name => s.getPropertyValue(name).trim();
    return { never: token('--lr-data-muted'), recent: token('--lr-ok'), aging: token('--lr-warn'), stale: token('--lr-danger') };
  };
  function feedback(text, error = false) {
    clearTimeout(feedbackTimer); $('feedback').textContent = text; $('feedback').classList.toggle('error', error); $('feedback').hidden = false;
    feedbackTimer = setTimeout(() => { $('feedback').hidden = true; }, error ? 10000 : 4000);
  }
  const safe = handler => async event => { try { await handler(event); } catch (error) { feedback(error.message || 'Operazione non riuscita', true); } };
  function filtered() {
    const needle = $('search').value.trim().toLocaleLowerCase('it');
    const kind = $('catalog-kind').value;
    return snapshot.streets.filter(s => (!needle || `${s.name} ${s.id}`.toLocaleLowerCase('it').includes(needle)) && (!kind || (kind === 'network' ? s.catalogKind === 'network' : s.catalogKind !== 'network')) && (!$('status').value || s.status === $('status').value) && (!$('locality').value || s.locality === $('locality').value)).sort((a, b) => Number(a.needsReview) - Number(b.needsReview) || a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id));
  }
  const streetIdentity = street => street.catalogKind === 'network' ? `${escape(street.locality)} · Rete propria` : `${escape(street.locality)} · Codvia ${escape(street.id)}`;
  function statusHtml(street) { return `<span class="status">${escape(street.label)}</span>`; }
  function progressHtml(street, compact = false) {
    const p = street.progress;
    const coverage = p.percent !== null ? `${p.percent}% · ${p.imported}/${p.total} immobili importati` : !p.acquisitionRunId ? 'Da acquisire' : p.total === 0 ? 'Nessun immobile nell’ultima acquisizione' : `${p.imported} importati · ${p.observed} letti, totale da verificare`;
    const age = p.ageDays !== null ? `Ultimo import: ${p.ageDays === 0 ? 'oggi' : p.ageDays === 1 ? '1 giorno fa' : `${p.ageDays} giorni fa`}` : p.imported ? 'Data import non disponibile' : 'Nessun import nell’ultima run';
    return `<${compact ? 'span' : 'div'} class="import-summary ${compact ? 'meta' : ''}" data-import-tone="${p.tone}"><strong>${coverage}</strong><span>${age}</span>${compact ? '' : `<span class="meta">Ultima acquisizione: ${p.acquiredAt ? date(p.acquiredAt) : 'non eseguita'}. Il totale riguarda questa run.</span>`}</${compact ? 'span' : 'div'}>`;
  }
  function renderList() {
    const streets = filtered();
    if (highlightSource === 'list') highlight(highlightedId, false);
    $('result-count').textContent = `${streets.length} vie · ${streets.filter(s => s.geometry).length} sulla mappa`;
    $('streets').innerHTML = streets.slice(0, 200).map(s => `<button class="street-row ${selectedStreet === s.id ? 'selected' : ''}" data-street="${escape(s.id)}" aria-label="${escape(s.name)}, ${escape(s.label)}, codice ${escape(s.id)}"><span class="dot ${s.progress.tone}"></span><span><strong>${escape(s.name)}</strong><span class="meta">${escape(s.label)} · ${s.count} immobili${s.catalogKind === 'network' ? ' · rete propria' : ''}${s.geometry ? '' : ' · senza geometria'}</span>${progressHtml(s, true)}</span></button>`).join('') || '<p class="explanation">Nessuna via con questi filtri. Cambia ricerca o stato.</p>';
    if (streets.length > 200) $('streets').insertAdjacentHTML('beforeend', '<p class="explanation">Prime 200 vie. Cerca per nome per restringere l’elenco.</p>');
    $('streets').querySelectorAll('[data-street]').forEach(button => {
      button.addEventListener('click', safe(() => choose(button.dataset.street)));
      button.addEventListener('mouseenter', () => { hidePreview(); highlight(button.dataset.street, true, 'list'); });
      button.addEventListener('mouseleave', () => highlight(button.dataset.street, false));
    });
    const visible = new Set(streets.map(s => s.id));
    if (hoverId && !visible.has(hoverId)) hidePreview();
    if (highlightedId && !visible.has(highlightedId)) highlight(highlightedId, false);
    for (const [id, layer] of layers) { if (visible.has(id)) layer.addTo(map); else layer.remove(); }
  }
  function paint() {
    const c = colors();
    for (const street of snapshot.streets) {
      const layer = layers.get(street.id); if (!layer) continue;
      layer.setStyle({ color: c[street.progress.tone], ...(street.id === highlightedId ? hoverStroke : stroke) });
      const label = map.getZoom() >= 16 && street.progress.percent !== null ? `${street.progress.percent}%` : null;
      if (layer.percentLabel !== label) { layer.unbindTooltip(); if (label) layer.bindTooltip(label, { permanent: true, direction: 'center', className: 'street-percent-label', opacity: 1 }); layer.percentLabel = label; }
    }
  }
  map.on('zoomend', () => { if (snapshot) paint(); });
  function highlight(id, enabled, source = 'map') {
    if (enabled) {
      if (highlightedId && highlightedId !== id) layers.get(highlightedId)?.setStyle(stroke);
      highlightedId = id; highlightSource = source;
    } else if (highlightedId === id) { highlightedId = null; highlightSource = null; }
    layers.get(id)?.setStyle(enabled ? hoverStroke : stroke);
  }
  function hidePreview() { clearTimeout(hideTimer); highlight(highlightedId, false); hoverId = null; pinnedPreview = false; $('hover').hidden = true; }
  function scheduleHide() { if (pinnedPreview) return; clearTimeout(hideTimer); hideTimer = setTimeout(hidePreview, 280); }
  function hover(street, point, pin = false, activate = true) {
    if (!street || $('detail-dialog').open) return;
    if (activate) {
      if (hoverId !== street.id) pinnedPreview = false;
      if (pin) { pinnedPreview = true; selectedStreet = street.id; renderList(); }
      clearTimeout(hideTimer); highlight(street.id, true);
    }
    hoverId = street.id; hoverPoint = point;
    $('hover').innerHTML = `<button class="preview-close quiet" aria-label="Chiudi riepilogo">×</button><span class="eyebrow">${streetIdentity(street)}</span><h3>${escape(street.name)}</h3>${progressHtml(street)}<p>${statusHtml(street)}<br>${street.count} immobili conservati · ${street.unresolved} da gestire</p><div class="actions"><button data-open="${escape(street.id)}">Apri scheda</button><button data-attention="${escape(street.id)}">${street.attention ? 'Togli segnalazione' : 'Da verificare'}</button></div>`;
    const width = $('map').clientWidth, height = $('map').clientHeight;
    $('hover').style.left = `${Math.max(10, Math.min(point.x + 14, width - 300))}px`;
    $('hover').hidden = false;
    $('hover').style.top = `${Math.max(10, Math.min(point.y + 14, height - $('hover').offsetHeight - 10))}px`;
    $('hover').querySelector('[data-open]').onclick = safe(() => choose(street.id));
    $('hover').querySelector('.preview-close').onclick = hidePreview;
    $('hover').querySelector('[data-attention]').onclick = safe(async () => {
      const current = await api.detail(street.id);
      await api.annotate({ streetId: street.id, note: current.memory.note, attention: !current.memory.attention });
      await refresh(); const updated = snapshot.streets.find(s => s.id === street.id);
      feedback(updated.attention ? 'Via segnata da verificare' : 'Segnalazione rimossa');
    });
  }
  $('hover').addEventListener('mouseenter', () => { highlight(highlightedId, false); clearTimeout(hideTimer); });
  $('hover').addEventListener('mouseleave', scheduleHide);
  L.DomEvent.disableClickPropagation($('hover'));
  L.DomEvent.disableScrollPropagation($('hover'));
  $('map').addEventListener('mouseleave', () => { highlight(highlightedId, false); scheduleHide(); });
  // Canvas throttles hover events. Check the active trace on every pointer move
  // so a fast exit followed by a stationary cursor cannot leave a wide stroke.
  $('map').addEventListener('mousemove', event => {
    if (!highlightedId || highlightSource !== 'map') return;
    const geometry = snapshot.streets.find(s => s.id === highlightedId)?.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.coordinates || [];
    const rect = $('map').getBoundingClientRect(), point = L.point(event.clientX - rect.left, event.clientY - rect.top);
    const onTrace = lines.some(line => {
      let previous = null;
      return line.some(([lon, lat]) => {
        const next = map.latLngToContainerPoint([lat, lon]);
        const close = previous && L.LineUtil.pointToSegmentDistance(point, previous, next) <= 8;
        previous = next; return close;
      });
    });
    if (!onTrace) { highlight(highlightedId, false); scheduleHide(); }
  }, { capture: true, passive: true });
  map.on('dragstart zoomstart', hidePreview);
  map.on('click', hidePreview);
  window.addEventListener('blur', hidePreview);
  function openDialog(title) {
    $('dialog-title').textContent = title;
    if (!$('detail-dialog').open) { dialogOpener = document.activeElement; hidePreview(); $('detail-dialog').append($('feedback')); $('detail-dialog').showModal(); }
  }
  function closeDialog() {
    if (dirty) { feedback('Salva le modifiche aperte o premi Annulla prima di chiudere la scheda.', true); return; }
    $('detail-dialog').close();
  }
  $('detail-close').onclick = closeDialog;
  $('detail-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  $('detail-dialog').addEventListener('click', event => {
    const rect = $('detail-dialog').getBoundingClientRect();
    if (event.target === $('detail-dialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog();
  });
  $('detail-dialog').addEventListener('close', () => {
    networkView = testsView = historyView = false; document.body.append($('feedback'));
    const target = dialogOpener?.isConnected ? dialogOpener : [...$('streets').querySelectorAll('[data-street]')].find(b => b.dataset.street === selectedStreet) ?? $('search');
    (target.getClientRects().length ? target : $('home')).focus({ preventScroll: true });
  });
  async function choose(id) {
    if (dirty) { feedback('Salva le modifiche aperte o premi Annulla prima di cambiare via.', true); return; }
    const chosen = await api.detail(id);
    if (chosen.street.id !== id || !filtered().some(s => s.id === chosen.street.id)) { $('catalog-kind').value = ''; $('status').value = ''; $('locality').value = ''; $('search').value = chosen.street.name; }
    historyView = false; testsView = false; networkView = false; selectedStreet = chosen.street.id; selected.clear(); tab = 'dossier'; hidePreview(); $('inspector').scrollTop = 0; $('catalog')?.classList.remove('open');
    detail = chosen; renderDetail(); openDialog('Scheda della via');
    await refresh();
    $('inspector').scrollTop = 0;
    const layer = layers.get(selectedStreet); if (layer) map.fitBounds(layer.getBounds(), { padding: [45, 45], maxZoom: 17 });
    else feedback('Questa via è censita ma non ha ancora una geometria. La scheda e i processi sono disponibili.');
  }
  function renderProgress() {
    const run = snapshot.activeRun;
    $('run-progress').hidden = !run;
    if (!run) return;
    const street = snapshot.streets.find(s => s.id === run.streetId);
    $('run-progress').innerHTML = `<div><strong>${escape(operations[run.operation])}</strong><p>${escape(street?.name)} · ${run.handled}${run.total === null ? '' : ` / ${run.total}`} immobili</p><progress ${run.total ? `value="${run.handled}" max="${run.total}"` : ''} aria-label="Avanzamento della via"></progress></div><button id="pause">Pausa</button>`;
    $('pause').onclick = safe(async () => { await api.pause(); feedback('Pausa richiesta. Attendo il punto sicuro e conservo l’avanzamento.'); });
  }
  function renderDetail() {
    if (!detail) return;
    const s = detail.street;
    $('inspector').innerHTML = `<header class="detail-header"><span class="eyebrow">${streetIdentity(s)}</span><h2>${escape(s.name)}</h2>${statusHtml(s)}${progressHtml(s)}<p class="meta">${s.count} immobili conservati · ${s.unresolved} da gestire<br>Scheda Territorio creata: ${date(s.registeredAt)}<br>Ultima lettura: ${date(s.lastObservationAt)}<br>Acquisizione completa: ${s.lastScanAt ? date(s.lastScanAt) : 'Non eseguita nel laboratorio'}</p>${s.geometry ? '' : '<p class="explanation">Geometria non disponibile. La via resta selezionabile dalla ricerca.</p>'}</header><nav class="tabs" role="tablist" aria-label="Dettaglio della via">${[['dossier', 'Dossier'], ['units', `Immobili ${s.count}`], ['history', 'Storico']].map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${tab === key}">${label}</button>`).join('')}</nav><div class="detail-content" id="detail-body" role="tabpanel"></div>`;
    $('inspector').querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { if (dirty) return feedback('Salva o annulla le modifiche prima di cambiare scheda.', true); tab = button.dataset.tab; renderDetail(); }; });
    const disabled = snapshot.activeRun ? 'disabled' : '';
    const actions = `<div class="actions"><button class="primary" data-operation="scan" ${disabled || s.needsReview ? 'disabled' : ''}>Acquisisci via</button><button data-operation="compare" ${disabled || !s.count ? 'disabled' : ''}>Confronta gestionale</button></div>`;
    const paused = [...detail.runs].reverse().find(r => ['paused', 'failed'].includes(r.state));
    const resume = paused ? `<section class="run-item"><strong>${escape(operations[paused.operation])}: da riprendere</strong><p class="explanation">${escape(paused.error || 'L’avanzamento è conservato.')}</p><button id="resume" ${disabled}>Riprendi operazione</button></section>` : '';
    if (tab === 'dossier') {
      $('detail-body').innerHTML = actions + resume + `<p class="explanation">Ogni immobile viene confrontato prima di creare o aggiornare la sua scheda. I casi dubbi restano da verificare.</p><form id="memory-form"><div class="field"><label for="street-note">Annotazioni della via</label><textarea id="street-note" rows="5" placeholder="Contesto utile per il prossimo controllo…">${escape(detail.memory.note)}</textarea></div><label class="check-label"><input id="attention" type="checkbox" ${detail.memory.attention ? 'checked' : ''}>Da verificare</label><div class="actions"><button type="submit">Salva annotazioni</button><button type="button" data-cancel>Annulla</button></div></form><p class="explanation">La segnalazione è manuale. Lo stato del lavoro deriva dalle acquisizioni e dagli esiti verificati.</p>${s.geometryEvidence ? `<details><summary>Provenienza della geometria</summary><p class="explanation">${escape(s.geometryEvidence)}</p></details>` : ''}`;
      $('memory-form').oninput = event => markDirty(event.currentTarget);
      $('memory-form').onsubmit = safe(async event => { event.preventDefault(); const form = event.currentTarget; await api.annotate({ streetId: selectedStreet, note: $('street-note').value, attention: $('attention').checked }); saved(form); await refresh(); feedback('Annotazioni conservate'); });
      if (s.catalogKind === 'network') {
        $('detail-body').insertAdjacentHTML('afterbegin', `<section class="network-link"><h3>Collega il tracciato alla via.</h3><p class="explanation">Questa scheda appartiene alla rete propria e può conservare note e lavoro già da ora. Scegli un Codvia solo dopo aver verificato che il tracciato corrisponde alla via ufficiale. ${s.needsReview ? 'Per un tratto senza nome, questa associazione abilita anche l’acquisizione.' : ''}</p><form id="network-link-form"><label for="network-official">Via dell'inventario ufficiale</label><input id="network-official" list="network-official-options" required placeholder="Nome della via e Codvia"><datalist id="network-official-options">${snapshot.streets.filter(s => s.catalogKind !== 'network' && !s.needsReview).map(s => `<option value="${escape(`${s.name} · Codvia ${s.id}`)}"></option>`).join('')}</datalist><div class="actions"><button type="submit" ${disabled}>Conferma associazione</button><button type="button" data-cancel>Annulla</button></div></form><p class="explanation">L'associazione aggiunge il tracciato alla via. Letture, operazioni e annotazioni precedenti restano conservate.</p></section>`);
        $('network-link-form').oninput = event => markDirty(event.currentTarget);
        $('network-link-form').onsubmit = safe(async event => {
          event.preventDefault(); const form = event.currentTarget;
          if (dirtyForms.size > 1) return feedback('Salva o annulla le altre modifiche prima di associare il tracciato.', true);
          const official = snapshot.streets.find(s => s.catalogKind !== 'network' && `${s.name} · Codvia ${s.id}` === $('network-official').value);
          if (!official) return feedback('Scegli una voce completa con Codvia.', true);
          await api.bindNetwork({ networkId: s.id, officialId: official.id }); saved(form); await choose(official.id); feedback('Tracciato associato. Lo storico precedente resta nella scheda.');
        });
      }
      for (const memory of detail.linkedNotes || []) $('detail-body').insertAdjacentHTML('beforeend', `<details><summary>Annotazioni precedenti sul tracciato</summary><p class="explanation">${escape(memory.note)}</p></details>`);
    } else if (tab === 'units') {
      $('detail-body').innerHTML = `<div class="actions"><button id="select-all" ${disabled}>Seleziona pronti</button><button id="apply" class="primary" ${disabled || !selected.size ? 'disabled' : ''}>${snapshot.origin === 'simulation' ? 'Prova piano' : 'Applica selezionati'} (${selected.size})</button></div><p class="explanation">${snapshot.origin === 'simulation' ? 'I dati di prova includono creazioni, aggiornamenti, duplicati e una ricerca incompleta.' : 'Scritture ammesse soltanto sulle schede di prova concordate.'}</p>${resume}${detail.units.length ? detail.units.map(unitHtml).join('') : '<p class="explanation">Nessun immobile conservato. Avvia un’acquisizione dal Dossier.</p>'}`;
      $('select-all').onclick = () => { if (dirty) return feedback('Salva o annulla le modifiche prima di cambiare selezione.', true); for (const u of detail.units) if (u.canWrite && ['create', 'update', 'synced'].includes(u.assessment?.kind)) selected.add(u.key); renderDetail(); };
      $('apply').onclick = safe(() => operate('apply'));
      $('detail-body').querySelectorAll('[data-unit-select]').forEach(input => { input.onchange = () => { input.checked ? selected.add(input.dataset.unitSelect) : selected.delete(input.dataset.unitSelect); $('apply').disabled = !selected.size || Boolean(snapshot.activeRun); $('apply').textContent = `${snapshot.origin === 'simulation' ? 'Prova piano' : 'Applica selezionati'} (${selected.size})`; }; });
      $('detail-body').querySelectorAll('[data-edit]').forEach(form => { form.oninput = () => markDirty(form); form.onsubmit = safe(async event => {
        event.preventDefault(); const key = form.dataset.edit, unit = detail.units.find(u => u.key === key); const data = new FormData(form);
        const owners = unit.source.owners.map((owner, i) => ({ ...owner, fullName: String(data.get(`name-${i}`)), taxCode: String(data.get(`cf-${i}`)), sharePercentage: String(data.get(`share-${i}`)).trim() === '' ? null : Number(data.get(`share-${i}`)) }));
        await api.correct({ key, note: String(data.get('note')), correction: { address: String(data.get('address')), category: String(data.get('category')), owners } }); saved(form); selected.delete(key); await refresh(); feedback('Correzione conservata. Serve un nuovo confronto.');
      }); });
    } else {
      $('detail-body').innerHTML = `<h3>Operazioni della via</h3><ul class="runs-list">${[...detail.runs].reverse().map(run => `<li class="run-item"><strong>${escape(operations[run.operation])}</strong><p>${escape(runStates[run.state])} · ${run.handled} immobili</p><p class="meta">${date(run.startedAt)}${run.endedAt ? ` → ${date(run.endedAt)}` : ''}</p>${run.error ? `<p class="explanation">${escape(run.error)}</p>` : ''}</li>`).join('') || '<li class="explanation">Nessuna operazione su questa via.</li>'}</ul><h3>Diario</h3><ul class="timeline">${[...detail.events].reverse().map(e => `<li><p>${escape(e.text)}</p><span class="meta">${date(e.at)}</span></li>`).join('') || '<li class="explanation">Il diario conserva operazioni e annotazioni.</li>'}</ul>`;
      if (detail.history?.length) $('detail-body').insertAdjacentHTML('afterbegin', `<h3>Lavorazioni precedenti</h3><p class="explanation">Prove recuperate dal worker precedente. I vecchi checkpoint restano nel loro archivio; la presenza attuale richiede un nuovo confronto.</p><ul class="runs-list">${detail.history.map(h => `<li class="run-item"><strong>${escape(h.street || 'Acquisizione precedente')}</strong><p>${escape(({ completed: 'Conclusa', paused: 'Sospesa', saved: 'Acquisizione conservata', needs_review: 'Da verificare' })[h.status] || 'Stato precedente da verificare')}</p><p class="meta">${date(h.at)} · ${h.acquired} righe nella lavorazione<br>${h.imported} import precedenti conclusi · ${h.issues.length} righe da verificare</p></li>`).join('')}</ul>`);
    }
    $('detail-body').querySelectorAll('[data-cancel]').forEach(button => { button.onclick = () => { const form = button.closest('form'); form.reset(); dirtyForms.delete(form); dirty = Boolean(dirtyForms.size); if (!dirty) renderDetail(); }; });
    $('detail-body').querySelectorAll('[data-operation]').forEach(button => { button.onclick = safe(() => operate(button.dataset.operation)); });
    if ($('resume')) $('resume').onclick = safe(async () => { if (dirty) return feedback('Salva o annulla le modifiche prima di riprendere il processo.', true); await api.start({ streetId: selectedStreet, operation: paused.operation, selected: paused.itemKeys, resumeId: paused.id }); await refresh(); });
  }
  function unitHtml(u) {
    const s = u.source, decision = u.assessment?.kind || 'unknown';
    const enabled = !snapshot.activeRun && u.canWrite && ['create', 'update', 'synced'].includes(decision);
    return `<article class="unit"><div class="unit-head"><input type="checkbox" aria-label="Seleziona ${escape(s.fullAddress)}" data-unit-select="${escape(u.key)}" ${selected.has(u.key) ? 'checked' : ''} ${enabled ? '' : 'disabled'}><div><h3>${escape(s.fullAddress)}</h3><p class="identity">F ${escape(s.cadastral.sheet)} · P ${escape(s.cadastral.parcel)} · S ${escape(s.cadastral.subaltern)}</p><span class="status">${escape(decisions[decision])}</span> ${u.origin === 'simulation' ? '<span class="unit-origin">Dati di prova</span>' : ''}</div></div><p class="reason">${escape(u.assessment?.reason || 'Acquisizione conservata. Esegui il confronto con il gestionale.')}</p><details><summary>Scheda immobile e intestatari</summary><table><tr><td>Categoria</td><td>${escape(s.category)}</td></tr><tr><td>Consistenza</td><td>${escape(s.consistency)}</td></tr><tr><td>Ultima acquisizione</td><td>${date(u.observations.at(-1).at)}</td></tr>${u.crmId ? `<tr><td>Scheda gestionale</td><td>${escape(u.crmId)}</td></tr><tr><td>Ultimo import concluso</td><td>${u.importedAt ? date(u.importedAt) : 'Data non disponibile'}</td></tr>` : ''}</table>${s.owners.map(owner => `<div class="owner"><strong>${escape(owner.fullName)}</strong><p class="mono">${escape(owner.taxCode)}</p><p>${escape(owner.rightType)} · quota ${escape(owner.sharePercentage ?? '?')}%</p>${owner.contacts.phones.length ? `<p>${escape(owner.contacts.phones.join(' · '))}</p>` : ''}</div>`).join('')}<p>${escape(u.note)}</p><details><summary>Acquisizioni precedenti (${u.observations.length})</summary>${[...u.observations].reverse().map(o => `<p class="explanation">${date(o.at)} · ${escape(o.source.fullAddress)} · ${o.source.owners.length} intestatari</p>`).join('')}</details></details><details><summary>Correggi i dati conservati</summary><p class="explanation">La lettura originale resta nello storico. Le correzioni manuali saranno conservate anche alla prossima acquisizione.</p><form class="edit-form" data-edit="${escape(u.key)}"><div class="field"><label>Indirizzo<input name="address" required value="${escape(s.fullAddress)}"></label></div><div class="field"><label>Categoria<input name="category" required value="${escape(s.category)}"></label></div>${s.owners.map((owner, i) => `<div class="owner-edit"><input name="name-${i}" aria-label="Nome intestatario ${i + 1}" required value="${escape(owner.fullName)}"><input name="cf-${i}" aria-label="Codice fiscale intestatario ${i + 1}" value="${escape(owner.taxCode)}"><input name="share-${i}" type="number" min="0" max="100" step="0.001" aria-label="Quota intestatario ${i + 1}" value="${owner.sharePercentage ?? ''}"></div>`).join('')}<div class="field"><label>Annotazioni<textarea name="note" rows="2">${escape(u.note)}</textarea></label></div><div class="actions"><button ${snapshot.activeRun ? 'disabled' : ''}>Salva correzioni</button><button type="button" data-cancel>Annulla</button></div></form></details></article>`;
  }
  async function operate(operation) {
    if (dirty) return feedback('Salva o annulla le modifiche prima di avviare il processo.', true);
    const runId = await api.start({ streetId: selectedStreet, operation, selected: operation === 'apply' ? [...selected] : [] });
    if (runId && operation === 'apply') selected.clear();
    await refresh();
  }
  async function refresh() {
    const currentRequest = ++request;
    const next = await api.snapshot();
    const nextDetail = selectedStreet ? await api.detail(selectedStreet) : null;
    const memory = await api.syncStatus();
    if (currentRequest !== request) return;
    snapshot = next; detail = nextDetail;
    document.body.classList.toggle('integrated', Boolean(snapshot.integrated));
    $('open-browser').hidden = !snapshot.integrated || snapshot.origin !== 'live';
    $('test-settings').hidden = snapshot.origin !== 'live';
    $('cloud-memory').hidden = !memory.configured;
    const online = memory.environment === 'online';
    $('cloud-memory').textContent = online ? (memory.error ? 'Memoria online · da sincronizzare' : memory.syncing ? 'Memoria online · salvataggio…' : 'Memoria online') : 'Memoria';
    $('cloud-memory').title = memory.error || (online ? 'Vie, immobili, note e storico sincronizzati su Supabase' : 'Memoria condivisa locale');
    $('memory-title').textContent = online ? 'Memoria online' : 'Memoria condivisa di prova';
    $('memory-description').textContent = online ? 'Vie, immobili, note e storico vengono sincronizzati automaticamente dopo le modifiche e al termine delle lavorazioni. Una copia locale permette di conservare il lavoro anche senza rete. I conflitti richiedono un confronto.' : "Archivio nell'ambiente locale separato. Un conflitto conserva le tue modifiche e richiede un confronto.";
    if (memory.configured) $('memory-date').textContent = memory.error || (memory.syncing ? 'Salvataggio in corso…' : memory.pending ? 'Modifiche locali in attesa di sincronizzazione.' : memory.syncedAt ? `Ultima sincronizzazione: ${date(memory.syncedAt)}` : 'Non ancora sincronizzata');
    $('history-review').hidden = !snapshot.historyIssues;
    $('history-review').textContent = `Storico (${snapshot.historyIssues || 0})`;
    $('environment').textContent = snapshot.origin === 'simulation' ? 'Laboratorio locale · simulazione' : snapshot.integrated ? 'Worker V2 · collaudo reale' : 'Archivio reale · laboratorio';
    $('notice').textContent = snapshot.origin === 'simulation' ? 'Le vie sono reali. Immobili e gestionale sono simulati; il lavoro di prova resta conservato in questo laboratorio.' : 'Profilo di prova separato. Le scritture sono limitate alle identità catastali concordate; consulta il piano prima di applicare.';
    const present = new Set(snapshot.streets.filter(s => s.geometry).map(s => s.id));
    for (const [id, layer] of layers) if (!present.has(id)) { layer.remove(); layers.delete(id); }
    for (const street of snapshot.streets) if (street.geometry) {
      const geometryKey = JSON.stringify(street.geometry), previous = layers.get(street.id);
      if (previous) { if (previous.geometryKey !== geometryKey) { previous.clearLayers(); previous.addData(street.geometry); previous.geometryKey = geometryKey; previous.percentLabel = undefined; } continue; }
      const layer = L.geoJSON(street.geometry, { style: { color: colors()[street.progress.tone], ...stroke, lineCap: 'round' }, bubblingMouseEvents: false }); layer.geometryKey = geometryKey;
      layer.on('mouseover', event => hover(snapshot.streets.find(s => s.id === street.id), map.latLngToContainerPoint(event.latlng)));
      layer.on('mousemove', event => { if (highlightedId !== street.id) hover(snapshot.streets.find(s => s.id === street.id), map.latLngToContainerPoint(event.latlng)); });
      layer.on('mouseout', () => { highlight(street.id, false); if (hoverId === street.id) scheduleHide(); });
      layer.on('click', event => hover(snapshot.streets.find(s => s.id === street.id), map.latLngToContainerPoint(event.latlng), true));
      layers.set(street.id, layer); layer.addTo(map);
    }
    renderList(); paint(); renderProgress(); if (!dirty && $('detail-dialog').open) { if (networkView) showNetworkSetup(); else if (testsView) await showTestSettings(); else if (historyView) await showHistoryReview(); else renderDetail(); }
    if (hoverId && hoverPoint && !$('hover').hidden) { const street = snapshot.streets.find(s => s.id === hoverId); if (street) hover(street, hoverPoint, false, false); else hidePreview(); }
    if (snapshot.error) feedback(snapshot.error, true);
  }
  $('refresh').onclick = safe(refresh);
  $('open-browser').onclick = safe(async () => { const result = await api.openBrowser(); feedback(result.alreadyOpen ? 'Chrome V2 è già aperto. Verifica l’accesso a SISTER e Tecnocloud.' : 'Chrome V2 aperto. Accedi a SISTER e Tecnocloud prima di acquisire o confrontare.'); });
  $('detail-refresh').onclick = safe(refresh);
  $('network-setup').onclick = () => { if (dirty) return feedback('Salva o annulla le modifiche prima di aprire la rete.', true); networkView = true; historyView = false; testsView = false; openDialog('Rete del territorio'); showNetworkSetup(); };
  function showNetworkSetup() {
    const streets = snapshot.streets, paths = streets.filter(s => s.geometry), unworked = paths.filter(s => s.status === 'unseen');
    $('inspector').innerHTML = `<header class="detail-header"><span class="eyebrow">Setup del territorio</span><h2>La rete esiste già.</h2><p class="explanation">Le schede nascono dalla rete di vie, prima delle acquisizioni. Passa sul tracciato per illuminarlo, clicca per aprire il dossier e registra il lavoro da lì.</p></header><div class="detail-content"><dl class="network-summary"><dt>Vie ufficiali censite</dt><dd>${snapshot.network.official}</dd><dt>Tracciati apribili sulla mappa</dt><dd>${paths.length}</dd><dt>Tracciati ancora da lavorare</dt><dd>${unworked.length}</dd><dt>Associazioni alla via confermate</dt><dd>${snapshot.network.linked}</dd></dl><div class="actions"><button class="primary" data-network-scope="unseen">Apri vie da lavorare</button><button data-network-scope="network">Tracciati da associare</button><button data-network-scope="official">Inventario ufficiale</button><button data-network-scope="all">Tutta la rete</button></div><p class="explanation">Ogni voce ha già una scheda privata. I tratti senza nome conservano il proprio identificativo e possono essere collegati esplicitamente alla via ufficiale. Gli omonimi restano distinti.</p><p class="explanation">${streets.filter(s => !s.geometry).length} voci ufficiali attendono ancora un tracciato verificato. La loro scheda si apre dalla ricerca anche senza geometria.</p></div>`;
    $('inspector').querySelectorAll('[data-network-scope]').forEach(button => { button.onclick = () => {
      const scope = button.dataset.networkScope; $('catalog-kind').value = ['network', 'official'].includes(scope) ? scope : ''; $('status').value = scope === 'unseen' ? 'unseen' : ''; $('search').value = ''; $('locality').value = ''; renderList(); closeDialog(); $('catalog').classList.add('open'); $('search').focus();
    }; });
  }
  $('cloud-memory').onclick = () => { if (dirty) return feedback('Salva o annulla le modifiche prima di sincronizzare.', true); $('memory-dialog').showModal(); };
  $('memory-close').onclick = () => { if (!syncBusy) $('memory-dialog').close(); };
  $('memory-dialog').addEventListener('cancel', event => { if (syncBusy) event.preventDefault(); });
  for (const [id, direction] of [['memory-push', 'push'], ['memory-pull', 'pull']]) $(id).onclick = async () => {
    if (syncBusy || snapshot.activeRun) return feedback('Attendi la fine dell’operazione in corso.', true);
    syncBusy = true; $('memory-result').textContent = 'Sincronizzazione in corso…';
    for (const button of $('memory-dialog').querySelectorAll('button')) button.disabled = true;
    try { const result = await api.sync(direction); $('memory-result').textContent = result.changed ? (direction === 'push' ? 'Memoria condivisa aggiornata.' : 'Memoria recuperata. La copia locale precedente è conservata.') : 'Gli archivi coincidono già.'; await refresh(); }
    catch (error) { $('memory-result').textContent = error.message || 'Sincronizzazione non riuscita. Archivio locale conservato.'; }
    finally { syncBusy = false; for (const button of $('memory-dialog').querySelectorAll('button')) button.disabled = false; }
  };
  $('test-settings').onclick = safe(async () => { if (dirty) return feedback('Salva o annulla le modifiche prima di scegliere le prove.', true); networkView = false; testsView = true; historyView = false; openDialog('Schede di prova'); await showTestSettings(); });
  async function showTestSettings() {
    const next = await api.testSettings(); if (!testsView || dirty || !next.live) return;
    testConfig = next; testSelected.clear(); next.selected.forEach(key => testSelected.add(key));
    $('inspector').innerHTML = `<header class="detail-header"><span class="eyebrow">Profilo separato</span><h2>Le schede per il collaudo.</h2><p class="explanation">Scegli gli immobili su cui autorizzi la prova. Solo questi immobili e i loro intestatari potranno essere scritti. Il salvataggio di questa scelta non modifica il gestionale.</p><label class="sr-only" for="test-search">Cerca schede di prova</label><input id="test-search" type="search" placeholder="Indirizzo, catasto o intestatario…" value="${escape(testFilter)}"></header><div class="detail-content"><form id="tests-form"><p id="test-count" class="meta"></p><div id="test-records"></div><label class="check-label"><input id="test-create" type="checkbox" ${next.allowCreate ? 'checked' : ''}>Consenti anche nuove schede</label><p class="explanation">Se non selezionato, sono ammessi solo gli aggiornamenti di immobili già presenti. Ogni applicazione richiede un confronto nuovo e la conferma del piano.</p><label class="check-label"><input id="test-consent" type="checkbox">Autorizzo il collaudo sulle schede selezionate e sui loro intestatari.</label><div class="actions"><button id="test-save" class="primary">Salva scelta</button><button id="test-revoke" type="button">Disabilita scritture</button><button id="test-cancel" type="button">Annulla modifiche</button></div><p class="explanation">Per acquisire e confrontare, apri il Chrome di prova sulla porta 9223 e accedi a SISTER e Tecnocloud. Il Chrome quotidiano resta separato.</p></form></div>`;
    $('test-search').oninput = event => { testFilter = event.target.value; renderTestRecords(); };
    $('tests-form').onchange = event => markDirty(event.currentTarget);
    $('test-cancel').onclick = safe(async () => { saved($('tests-form')); await showTestSettings(); });
    $('test-revoke').onclick = safe(async () => { await api.configureTests({ keys: [], allowCreate: false, confirmed: false }); saved($('tests-form')); await refresh(); feedback('Scritture disabilitate nel profilo di prova'); });
    $('tests-form').onsubmit = safe(async event => {
      event.preventDefault();
      if (testSelected.size && !$('test-consent').checked) return feedback('Conferma il collaudo sulle schede selezionate.', true);
      const result = await api.configureTests({ keys: [...testSelected], allowCreate: $('test-create').checked, confirmed: $('test-consent').checked });
      saved($('tests-form')); await refresh(); feedback(result.selected ? `${result.selected} schede di prova autorizzate` : 'Scritture disabilitate');
    });
    renderTestRecords();
  }
  function renderTestRecords() {
    const needle = testFilter.trim().toLocaleLowerCase('it');
    const rows = testConfig.records.filter(r => testSelected.has(r.key) || `${r.address} ${r.key} ${r.owners.map(o => `${o.fullName} ${o.taxCode}`).join(' ')}`.toLocaleLowerCase('it').includes(needle)).sort((a, b) => Number(testSelected.has(b.key)) - Number(testSelected.has(a.key)));
    $('test-count').textContent = `${testSelected.size} selezionate · ${testConfig.selected.length} attualmente autorizzate · ${rows.length} risultati · prime 30`;
    $('test-records').innerHTML = rows.slice(0, 30).map(r => `<article class="unit"><label class="check-label"><input type="checkbox" data-test-key="${escape(r.key)}" ${testSelected.has(r.key) ? 'checked' : ''} ${r.eligible ? '' : 'disabled'}><strong>${escape(r.address)}</strong></label><p class="identity">F ${escape(r.cadastral.sheet)} · P ${escape(r.cadastral.parcel)} · S ${escape(r.cadastral.subaltern)}</p>${r.reason ? `<p class="reason">${escape(r.reason)}</p>` : ''}<details><summary>Intestatari autorizzati con questa scheda</summary>${r.owners.map(o => `<p>${escape(o.fullName)}<br><span class="mono">${escape(o.taxCode)}</span></p>`).join('')}</details></article>`).join('') || '<p class="explanation">Nessuna scheda con questa ricerca. Acquisisci una via o correggi i dati incompleti prima di sceglierla.</p>';
    $('test-records').querySelectorAll('[data-test-key]').forEach(input => { input.onchange = () => {
      if (input.checked && testSelected.size >= 10) { input.checked = false; return feedback('Scegli al massimo dieci schede per il collaudo.', true); }
      if (input.checked) testSelected.add(input.dataset.testKey); else testSelected.delete(input.dataset.testKey);
      $('test-consent').checked = false;
      markDirty($('tests-form')); renderTestRecords();
    }; });
  }
  $('history-review').onclick = safe(async () => { if (dirty) return feedback('Salva o annulla le modifiche prima di aprire lo storico.', true); networkView = false; testsView = false; historyView = true; openDialog('Storico da associare'); await showHistoryReview(); });
  async function showHistoryReview() {
    const rows = await api.historyReview(); if (!historyView) return;
    historyRows = rows;
    $('inspector').innerHTML = `<header class="detail-header"><span class="eyebrow">Recupero dello storico</span><h2>Le associazioni da decidere.</h2><p class="explanation">${rows.filter(r => r.canAssociate).length} righe richiedono una via; ${rows.filter(r => !r.canAssociate).length} restano escluse o incomplete. Nessuna scrittura nel gestionale.</p><label class="sr-only" for="history-search">Cerca nello storico</label><input id="history-search" type="search" placeholder="Cerca indirizzo o catasto…" value="${escape(historyFilter)}"></header><div class="detail-content" id="history-items"></div>`;
    $('history-search').oninput = event => { if (dirty) { event.target.value = historyFilter; return; } historyFilter = event.target.value; renderHistoryRows(); };
    renderHistoryRows();
  }
  function renderHistoryRows() {
    const needle = historyFilter.trim().toLocaleLowerCase('it');
    const rows = historyRows.filter(r => `${r.address || ''} ${r.cadastral?.sheet || ''} ${r.cadastral?.parcel || ''} ${r.cadastral?.subaltern || ''}`.toLocaleLowerCase('it').includes(needle));
    $('history-items').innerHTML = `<p class="meta">${rows.length} righe · prime 50</p>${rows.slice(0, 50).map(r => `<article class="unit"><h3>${escape(r.address || 'Indirizzo non disponibile')}</h3>${r.cadastral ? `<p class="identity">F ${escape(r.cadastral.sheet)} · P ${escape(r.cadastral.parcel)} · S ${escape(r.cadastral.subaltern)}</p>` : ''}<p class="reason">${escape(r.reason)}</p>${r.canAssociate ? `<button data-associate="${escape(r.propertyId)}">Associa a una via</button>` : '<p class="explanation">Conservata come evidenza della raccolta originale.</p>'}</article>`).join('') || '<p class="explanation">Nessuna riga con questa ricerca.</p>'}`;
    $('history-items').querySelectorAll('[data-associate]').forEach(button => { button.onclick = () => {
      if (dirty) return feedback('Salva o annulla l’associazione aperta.', true);
      const row = historyRows.find(r => r.propertyId === button.dataset.associate);
      button.closest('article').insertAdjacentHTML('beforeend', `<form id="association-form"><div class="field"><label for="history-street">Via dell'inventario<input id="history-street" list="history-street-options" required placeholder="Nome della via e Codvia"></label><datalist id="history-street-options">${snapshot.streets.filter(s => s.catalogKind !== 'network' && !s.needsReview).map(s => `<option value="${escape(`${s.name} · Codvia ${s.id}`)}"></option>`).join('')}</datalist></div><p class="explanation">La scelta associa questa riga alla via selezionata. Controlla il Codvia quando più vie hanno lo stesso nome.</p><div class="actions"><button class="primary">Conferma associazione</button><button type="button" id="cancel-association">Annulla</button></div></form>`);
      dirty = true;
      $('history-search').disabled = true;
      $('cancel-association').onclick = () => { dirty = false; $('history-search').disabled = false; renderHistoryRows(); };
      $('association-form').onsubmit = safe(async event => {
        event.preventDefault(); const chosen = snapshot.streets.find(s => `${s.name} · Codvia ${s.id}` === $('history-street').value);
        if (!chosen) return feedback('Scegli una voce completa dell’inventario, con Codvia.', true);
        await api.associate({ propertyId: row.propertyId, streetId: chosen.id }); dirty = false; await refresh(); feedback('Associazione conservata nel laboratorio');
      });
      $('history-street').focus();
    }; });
  }
  $('home').onclick = () => map.setView([41.11, 16.69], 15);
  $('toggle-list').onclick = () => document.querySelector('.catalog').classList.toggle('open');
  for (const id of ['search', 'status', 'locality', 'catalog-kind']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { if (snapshot) renderList(); });
  let refreshTimer;
  api.onChange(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { refresh().catch(error => feedback(error.message, true)); }, 80); });
  setInterval(() => { if (document.visibilityState === 'visible' && !syncBusy) refresh().catch(error => feedback(error.message, true)); }, 60000);
  window.addEventListener('focus', () => { if (snapshot && !syncBusy) refresh().catch(error => feedback(error.message, true)); });
  refresh().catch(error => feedback(`Archivio non disponibile: ${error.message}`, true));
})();
