/* Native disclosures and checkboxes: searchable multiple selection, no Ctrl-click. */
export function createFilterPicker(root, { label, allLabel, rows, escape, onChange, emptyLabel = "Nessuna voce disponibile" }) {
  let chosen = new Set(), items = rows;
  root.innerHTML = `<details class="filter-picker" name="query-filter"><summary><span>${escape(label)}</span><strong class="picker-value"></strong></summary><div class="picker-body"><input type="search" aria-label="Cerca ${escape(label.toLocaleLowerCase("it"))}" placeholder="Cerca ${escape(label.toLocaleLowerCase("it"))}"><div class="picker-tools"><span class="meta picker-count"></span><button type="button" class="quiet picker-clear">Azzera</button></div><div class="picker-chips"></div><div class="picker-options"></div></div></details>`;
  const details = root.querySelector("details"), search = root.querySelector('input[type="search"]');
  const available = () => [...items, ...[...chosen].filter(value => !items.some(row => String(row.value) === value)).map(value => ({ value, label: `Non più in archivio: ${value}` }))];
  function summary() {
    const selected = available().filter(row => chosen.has(String(row.value)));
    root.querySelector(".picker-value").textContent = selected.length === 1 ? selected[0].label + (selected[0].identity ? " · " + selected[0].identity : "") : selected.length ? `${selected.length} selezionati` : allLabel;
    root.querySelector("summary").title = selected.map(row => row.label + (row.meta ? " · " + row.meta : "")).join("; ");
    root.querySelector(".picker-clear").disabled = !chosen.size;
    root.querySelector(".picker-chips").innerHTML = selected.slice(0, 4).map(row => `<button type="button" class="filter-chip" data-remove="${escape(row.value)}" aria-label="Rimuovi ${escape(row.label)}"><span>${escape(row.label)}</span><span aria-hidden="true">×</span></button>`).join("") + (selected.length > 4 ? `<span class="meta">+${selected.length - 4}</span>` : "");
  }
  function list() {
    const text = search.value.trim().toLocaleUpperCase("it");
    const matches = available().filter(row => `${row.label} ${row.meta ?? ""}`.toLocaleUpperCase("it").includes(text));
    root.querySelector(".picker-count").textContent = `${chosen.size} selezionati · ${matches.length} disponibili`;
    root.querySelector(".picker-options").innerHTML = matches.slice(0, 80).map(row => `<label class="picker-option"><input type="checkbox" value="${escape(row.value)}" ${chosen.has(String(row.value)) ? "checked" : ""}><span><strong>${escape(row.label)}</strong>${row.meta ? `<small>${escape(row.meta)}</small>` : ""}</span></label>`).join("") + (matches.length > 80 ? '<p class="meta">Cerca per restringere la lista alle altre voci.</p>' : !matches.length ? `<p class="meta">${escape(items.length ? "Nessun risultato con questa ricerca" : emptyLabel)}</p>` : "");
  }
  function changed() { summary(); onChange(); }
  search.oninput = list;
  search.onkeydown = event => { if (event.key === "Enter") event.preventDefault(); };
  root.querySelector(".picker-options").onchange = event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    event.target.checked ? chosen.add(event.target.value) : chosen.delete(event.target.value);
    changed();
    root.querySelector(".picker-count").textContent = `${chosen.size} selezionati`;
  };
  root.querySelector(".picker-clear").onclick = () => { chosen.clear(); list(); changed(); };
  root.querySelector(".picker-chips").onclick = event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    chosen.delete(button.dataset.remove); list(); changed();
    root.querySelector("summary").focus();
  };
  root.onkeydown = event => { if (event.key === "Escape" && details.open) { event.preventDefault(); event.stopPropagation(); details.open = false; root.querySelector("summary").focus(); } };
  summary(); list();
  return {
    values: () => [...chosen],
    fill(values = []) { chosen = new Set(values.map(String)); summary(); list(); },
    setRows(next) { items = next; summary(); list(); },
    close() { details.open = false; },
  };
}
