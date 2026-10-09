import { createFilterPicker } from "./filter-picker.js";
import { labelIcons } from "./icons.js";
import { isBrowserWarning } from "./toast.js";
import { unitHeadingHtml, ownerListHtml, comparisonHtml } from "./unit-card.js";
/* Explicit combinations over acquired records. The main process revalidates every selection. */
export function createQueryPanel(context) {
  const { api, escape, feedback } = context, $ = id => document.getElementById(id);
  let pickers = {}, catalog, result = null, query = {}, selected = new Set(), limit = 100, generation = 0, loading = false;
  const options = (rows, chosen = []) => rows.map(([id, label]) => `<option value="${escape(id)}" ${chosen.includes(id) ? "selected" : ""}>${escape(label)}</option>`).join("");
  const values = id => pickers[id].values();
  const safely = action => async event => { try { await action(event); } catch (error) { feedback(error.message, true); } };
  const active = () => Boolean($("detail-dialog").open && $("query-form"));
  function read() { return { zoneIds: values("q-zones"), streetIds: values("q-streets"), ownerTaxCodes: values("q-owners"), localities: values("q-localities"), categories: values("q-categories"), floors: values("q-floors").map(Number), imports: $("q-imports").value, olderThanDays: $("q-age").value === "" ? null : Number($("q-age").value) }; }
  const signature = q => JSON.stringify(Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value].map(String).sort() : value]));
  const stale = () => Boolean(result && signature(read()) !== signature(result.query));
  function draftChanged() {
    const changed = stale();
    $("q-draft").hidden = !changed;
    $("query-results").dataset.stale = String(changed);
    if (result) renderResults();
  }
  async function preview(preserve = false) {
    if (!active()) return;
    const current = ++generation;
    if (!preserve) { query = read(); selected.clear(); limit = 100; Object.values(pickers).forEach(p => p.close()); }
    loading = true; $("q-preview").disabled = true; $("query-results").setAttribute("aria-busy", "true");
    if (result) renderResults();
    try {
      const next = await api.query({ query, limit });
      if (current !== generation || !active()) return;
      result = next; $("q-draft").hidden = !stale(); const present = new Set(result.keys);
      selected = new Set([...selected].filter(key => present.has(key)));
    } finally {
      if (current === generation && active()) {
        loading = false; $("q-preview").disabled = false; $("query-results").setAttribute("aria-busy", "false");
        if (result) renderResults();
      }
    }
  }
  function renderResults() {
    const focus = document.activeElement;
    const focusKey = focus?.dataset?.querySelect;
    const running = context.snapshot()?.activeRun, busy = Boolean(running) || loading, changed = stale(), ready = new Set(result.readyKeys), creates = new Set(result.createKeys), existingOnly = $("q-policy").value === "existing_only", canApply = selected.size && [...selected].every(key => ready.has(key) && (!existingOnly || !creates.has(key)));
    const paused = [...result.runs].reverse().find(r => ["paused", "failed"].includes(r.state));
    $("query-run").innerHTML = running?.query ? `<section class="run-item" role="status"><strong>${running.operation === "compare" ? "Confronto" : "Applicazione"} in corso</strong><p>${running.handled}/${running.total ?? "?"} immobili · ${running.selectionScope?.length ?? 1} vie</p><button id="q-pause">Metti in pausa</button></section>` : paused ? `<section class="run-item"><strong>Selezione conservata: ${paused.handled}/${paused.total} immobili</strong><p class="explanation">${escape(isBrowserWarning(paused.error || "") ? "Avanzamento conservato. Riprendi dopo aver aperto il browser di lavoro." : paused.error || "L’operazione può essere ripresa con la selezione e le opzioni iniziali.")}</p><button id="q-resume" ${busy ? "disabled" : ""}>Riprendi ${paused.operation === "compare" ? "confronto" : "applicazione"}</button></section>` : "";
    if ($("q-pause")) $("q-pause").onclick = safely(async () => { await api.pause(); await preview(true); });
    if ($("q-resume")) $("q-resume").onclick = safely(async () => { await api.start({ streetId: paused.streetId, operation: paused.operation, resumeId: paused.id, selected: [] }); await preview(true); });
    $("query-results").innerHTML = `<div class="query-results-heading"><div><h3>${result.total} ${result.total === 1 ? "immobile trovato" : "immobili trovati"}</h3><p class="meta">${selected.size} ${selected.size === 1 ? "selezionato" : "selezionati"} · ${catalog.owners.length} ${catalog.owners.length === 1 ? "proprietario distinto" : "proprietari distinti"} in archivio</p></div><div class="actions"><button id="q-select-all" ${busy || changed || !result.total ? "disabled" : ""}>Seleziona tutti (${result.total})</button><button id="q-clear" class="quiet" ${!selected.size ? "disabled" : ""}>Deseleziona</button></div></div><div class="units-grid">${result.units.map(u => `<article class="unit query-card" data-query-unit="${escape(u.key)}" data-selected="${selected.has(u.key)}"><div class="unit-head"><label class="unit-select-label"><input type="checkbox" aria-label="Seleziona ${escape(u.source.fullAddress)}" data-query-select="${escape(u.key)}" ${selected.has(u.key) ? "checked" : ""} ${busy ? "disabled" : ""}></label><div>${unitHeadingHtml(u, escape)}</div></div>${ownerListHtml(u.source.owners, escape)}${comparisonHtml(u, escape)}<p class="unit-memory-stats">${u.memory.statistics.verifiedImports} import verificati</p><button class="quiet" data-query-open="${escape(u.key)}">Apri immobile</button></article>`).join("") || '<p class="explanation">Nessun immobile corrisponde alla combinazione. Modifica i filtri oppure acquisisci le vie mancanti dalla mappa.</p>'}</div>${result.units.length < result.total ? `<button id="q-more">Mostra altri ${Math.min(100, result.total - result.units.length)}</button>` : ""}<div class="query-actions"><button id="q-compare" ${busy || changed || !selected.size ? "disabled" : ""}>Confronta selezionati (${selected.size})</button><button id="q-apply" class="primary" ${busy || changed || !canApply ? "disabled" : ""}>Applica selezionati (${selected.size})</button></div><p class="explanation">${selected.size && !canApply ? "Confronta i selezionati, autorizza le schede e rispetta la regola di import prima di applicare. " : ""}La query usa gli immobili già acquisiti. Ogni scrittura richiede una verifica attuale del CRM.</p>`;
    if (focusKey) [...document.querySelectorAll("[data-query-select]")].find(input => input.dataset.querySelect === focusKey && !input.disabled)?.focus({ preventScroll: true });
    $("q-select-all").onclick = () => { selected = new Set(result.keys); renderResults(); };
    $("q-clear").onclick = () => { selected.clear(); renderResults(); };
    document.querySelectorAll("[data-query-select]").forEach(input => { input.onchange = () => { input.checked ? selected.add(input.dataset.querySelect) : selected.delete(input.dataset.querySelect); renderResults(); }; });
    document.querySelectorAll("[data-query-unit]").forEach(card => { card.onclick = event => { if (!event.target.closest("input,label,button,a,summary,details") && !window.getSelection()?.toString()) card.querySelector("input:not(:disabled)")?.click(); }; });
    document.querySelectorAll("[data-query-open]").forEach(button => { button.onclick = safely(() => context.openUnit(result.units.find(u => u.key === button.dataset.queryOpen))); });
    if ($("q-more")) $("q-more").onclick = safely(async () => { limit += 100; await preview(true); });
    for (const operation of ["compare", "apply"]) $("q-" + operation).onclick = safely(async () => {
      if (loading || stale()) return feedback("Aggiorna i risultati prima di procedere", true);
      await api.start({ query: result.query, operation, selected: [...selected], settings: operation === "apply" ? { includeCoOwners: $("q-coowners").checked, importPolicy: $("q-policy").value, activityMode: $("q-activity").checked ? "plain" : "none" } : undefined });
      feedback(`${operation === "compare" ? "Confronto" : "Applicazione"} avviato sugli immobili selezionati`); await preview(true);
    });
    labelIcons($("inspector"));
    context.notifyRunIssue(result.runs.at(-1));
  }
  function fill(next) {
    for (const [field, id] of [["zoneIds","q-zones"],["streetIds","q-streets"],["ownerTaxCodes","q-owners"],["categories","q-categories"],["floors","q-floors"],["localities","q-localities"]]) pickers[id].fill(next[field] || []);
    $("q-imports").value = next.imports || "any"; $("q-age").value = next.olderThanDays ?? "";
  }
  function renderZoneStreets(chosen = []) {
    const text = $("zone-street-search").value.trim().toLocaleUpperCase("it");
    $("zone-street-list").innerHTML = context.snapshot().streets.filter(s => !s.needsReview && (chosen.includes(s.id) || s.name.toLocaleUpperCase("it").includes(text))).map(s => `<label><input type="checkbox" value="${escape(s.id)}" ${chosen.includes(s.id) ? "checked" : ""}>${escape(s.name)} · ${escape(s.locality)}</label>`).join("");
  }
  async function open() {
    if (!await context.open()) return;
    catalog = await api.queryCatalog();
    const streets = context.snapshot().streets.filter(s => !s.needsReview);
    $("inspector").innerHTML = `<div class="query-content"><div class="query-intro"><div><span class="eyebrow">Archivio catastale</span><p>Trova gli immobili da lavorare</p><span class="meta">${catalog.owners.length} proprietari distinti per codice fiscale</span></div><label class="query-saved">Combinazioni salvate<select id="q-saved"><option value="">Nuova combinazione</option>${options(catalog.saved.map(q => [q.id,q.name]))}</select></label></div><form id="query-form"><fieldset class="query-section"><legend>Territorio</legend><div class="query-fields"><div id="q-zones"></div><div id="q-streets"></div></div><div id="q-localities" class="query-localities"></div></fieldset><fieldset class="query-section"><legend>Proprietari e immobili</legend><div id="q-owners"></div><div class="query-fields query-characteristics"><div id="q-categories"></div><div id="q-floors"></div></div></fieldset><fieldset class="query-section"><legend>Importazione</legend><div class="query-fields"><label>Stato import<select id="q-imports"><option value="any">Tutti gli immobili</option><option value="never">Mai importati</option><option value="imported">Con import verificato</option></select></label><label>Età minima dell’ultimo import (giorni)<input id="q-age" type="number" min="0" max="36500" placeholder="Nessun limite"></label></div></fieldset><div class="query-submit"><p class="meta">Più voci nello stesso filtro si sommano. I filtri diversi si combinano.</p><div class="actions"><button type="button" id="q-reset" class="quiet">Azzera filtri</button><button type="submit" id="q-preview" class="primary">Mostra immobili</button></div></div><p id="q-draft" class="query-draft" role="status" hidden>Filtri modificati. Aggiorna i risultati prima di lavorare la selezione.</p></form><div class="query-management"><details class="query-save"><summary>Salva combinazione</summary><div class="query-save-row"><label>Nome<input id="q-name" maxlength="80" placeholder="Es. primi piani zona centro"></label><button type="button" id="q-save">Salva query</button></div></details><details id="zone-manager"><summary>Gestisci zone di vie (${catalog.zones.length})</summary><form id="zone-form" class="query-zone-form"><div class="query-fields"><label>Zona<select id="zone-edit"><option value="">Nuova zona</option>${options(catalog.zones.map(z => [z.id,z.name]))}</select></label><label>Nome della zona<input id="zone-name" required maxlength="80"></label></div><label>Cerca vie<input id="zone-street-search" type="search" placeholder="Nome della via"></label><div id="zone-street-list" class="query-zone-streets"></div><div class="actions"><button>Salva gruppo di vie</button></div></form></details><details><summary>Opzioni dell’applicazione</summary><div class="query-apply-options"><label class="check-label"><input id="q-coowners" type="checkbox" checked>Tutti gli intestatari</label><label>Regola d’import<select id="q-policy"><option value="create_update">Creazioni e aggiornamenti</option><option value="existing_only">Solo schede esistenti</option></select></label><label class="check-label"><input id="q-activity" type="checkbox">Crea Telefonata da eseguire</label></div></details></div><div id="query-run"></div><div id="query-results"></div></div>`;
    const rows = (items, value, label, meta) => items.map(item => ({ value: value(item), label: label(item), meta: meta?.(item) }));
    const specs = [
      ["q-zones", "Zone", "Tutte le zone", rows(catalog.zones, z => z.id, z => z.name, z => z.streetIds.length + " vie"), "Nessuna zona: crea un gruppo da Gestisci zone di vie"],
      ["q-streets", "Vie", "Tutte le vie", rows(streets, s => s.id, s => s.name, s => s.locality)],
      ["q-owners", "Proprietari", "Tutti i proprietari", rows(catalog.owners, o => o.taxCode, o => o.name, o => o.taxCode + " · " + o.properties + " immobili").map(row => ({ ...row, identity: row.value }))],
      ["q-categories", "Categorie catastali", "Tutte le categorie", rows(catalog.categories, c => c, c => c)],
      ["q-floors", "Piani", "Tutti i piani", rows(catalog.floors, String, f => f === 0 ? "Piano terra" : f < 0 ? "Interrato " + Math.abs(f) : "Piano " + f)],
      ["q-localities", "Località", "Tutto il comune", rows(["Bitonto", "Palombaio", "Mariotto"], String, String)],
    ];
    pickers = Object.fromEntries(specs.map(([id, label, allLabel, rows, emptyLabel]) => [id, createFilterPicker($(id), { label, allLabel, rows, emptyLabel, escape, onChange: draftChanged })]));
    document.querySelector("#q-floors .picker-body").insertAdjacentHTML("beforeend", '<p class="meta">Gli immobili con piano non rilevato restano esclusi da questo filtro.</p>');
    $("q-imports").onchange = draftChanged; $("q-age").oninput = draftChanged;
    fill(query); renderZoneStreets(); $("q-policy").onchange = () => { if (result) renderResults(); };
    $("query-form").onsubmit = safely(async event => { event.preventDefault(); await preview(); });
    $("q-reset").onclick = safely(async () => { fill({}); await preview(); });
    $("q-saved").onchange = safely(async () => { const saved = catalog.saved.find(q => q.id === $("q-saved").value); if (saved) { fill(saved.query); $("q-name").value = saved.name; await preview(); } else { fill({}); $("q-name").value = ""; await preview(); } });
    $("q-save").onclick = safely(async () => { const name = $("q-name").value.trim(); if (!name) return feedback("Indica un nome per la query", true); const savedId = await api.saveQuery({ name, query: read(), ...($("q-saved").value ? { id: $("q-saved").value } : {}) }); catalog = await api.queryCatalog(); $("q-saved").innerHTML = '<option value="">Nuova combinazione</option>' + options(catalog.saved.map(q => [q.id,q.name]), [savedId]); feedback("Query conservata"); });
    let zoneChosen = new Set();
    $("zone-street-list").onchange = event => { event.target.checked ? zoneChosen.add(event.target.value) : zoneChosen.delete(event.target.value); };
    $("zone-street-search").oninput = () => renderZoneStreets([...zoneChosen]);
    $("zone-edit").onchange = () => { const zone = catalog.zones.find(z => z.id === $("zone-edit").value); zoneChosen = new Set(zone?.streetIds || []); $("zone-name").value = zone?.name || ""; renderZoneStreets([...zoneChosen]); };
    $("zone-form").onsubmit = safely(async event => { event.preventDefault(); const chosenZones = values("q-zones"), savedId = await api.saveZone({ name: $("zone-name").value, streetIds: [...zoneChosen], ...($("zone-edit").value ? { id: $("zone-edit").value } : {}) }); catalog = await api.queryCatalog(); pickers["q-zones"].setRows(rows(catalog.zones, z => z.id, z => z.name, z => z.streetIds.length + " vie")); pickers["q-zones"].fill(chosenZones); document.querySelector("#zone-manager > summary").textContent = "Gestisci zone di vie (" + catalog.zones.length + ")"; $("zone-edit").innerHTML = '<option value="">Nuova zona</option>' + options(catalog.zones.map(z => [z.id,z.name]), [savedId]); feedback("Zona conservata"); await preview(true); });
    await preview();
  }
  return { open, get active() { return active(); }, refresh: () => preview(true) };
}
