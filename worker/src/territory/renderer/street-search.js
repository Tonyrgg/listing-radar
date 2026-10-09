/* Accessible combobox over the complete local street inventory. */
export function createStreetSearch({ root, getStreets, escape, onSelect }) {
  const input = root.querySelector("#search"), menu = root.querySelector("#street-search-menu"), list = root.querySelector("#streets"), status = root.querySelector("#result-count"), clear = root.querySelector("#clear-search"), more = root.querySelector("#more-streets");
  let timer = null, active = -1, rows = [], limit = 40, scope = "all", ignoreFocus = false, failure = null;
  const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").trim().replace(/\s+/g, " ");
  const scopeLabels = { all: "", unseen: "Vie da acquisire", network: "Tracciati da associare", official: "Inventario ufficiale" };
  function matches() {
    const needle = normalize(input.value), words = needle.split(" ").filter(Boolean);
    return getStreets().filter(street =>
      (scope !== "unseen" || !street.progress.acquiredAt) &&
      (scope !== "network" || street.catalogKind === "network") &&
      (scope !== "official" || street.catalogKind !== "network") &&
      words.every(word => normalize(`${street.name} ${street.id} ${street.locality}`).includes(word)),
    ).sort((a, b) => Number(normalize(b.name).startsWith(needle)) - Number(normalize(a.name).startsWith(needle)) || a.name.localeCompare(b.name, "it", { numeric: true }) || a.id.localeCompare(b.id));
  }
  function cancel() { clearTimeout(timer); timer = null; menu.removeAttribute("aria-busy"); }
  function close() { cancel(); menu.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; }
  function focus(open = false) { ignoreFocus = true; input.focus({ preventScroll: true }); ignoreFocus = false; if (open) render(); }
  function activate(index) {
    active = index;
    const options = [...list.querySelectorAll("[data-street]")];
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
    if (options[index]) { input.setAttribute("aria-activedescendant", options[index].id); options[index].scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }
  function render() {
    cancel();
    const previous = rows[active]?.id, found = matches();
    rows = found.slice(0, limit); clear.hidden = !input.value && scope === "all";
    menu.hidden = false; input.setAttribute("aria-expanded", "true");
    root.querySelector("#archive-error").hidden = !failure;
    root.querySelector("#archive-error-text").textContent = failure ?? "";
    status.textContent = failure ? "Archivio non disponibile" : `${scopeLabels[scope] ? scopeLabels[scope] + " · " : ""}${found.length} ${found.length === 1 ? "via trovata" : "vie trovate"}`;
    list.innerHTML = failure ? "" : rows.map((street, i) => `<button type="button" class="street-row" id="street-option-${i}" role="option" tabindex="-1" aria-selected="false" data-street="${escape(street.id)}"><span><strong>${escape(street.name)}</strong><span class="meta">${escape(street.locality)} · ${street.catalogKind === "network" ? "Rete propria" : "Codvia " + escape(street.id)}${street.geometry ? "" : " · senza tracciato"}</span></span></button>`).join("");
    root.querySelector("#search-empty").hidden = Boolean(rows.length) || Boolean(failure);
    more.hidden = found.length <= limit || Boolean(failure);
    more.textContent = `Mostra altre ${Math.min(40, found.length - limit)} vie`;
    activate(previous ? rows.findIndex(street => street.id === previous) : -1);
  }
  function select(id) {
    const street = getStreets().find(street => street.id === id);
    if (!street) return;
    input.value = street.name; clear.hidden = false; close(); focus(); onSelect(street);
  }
  input.onfocus = () => { if (!ignoreFocus && !input.disabled) render(); };
  input.oninput = () => {
    cancel(); limit = 40; active = -1; rows = []; list.innerHTML = "";
    clear.hidden = !input.value && scope === "all";
    menu.hidden = false; more.hidden = true; root.querySelector("#search-empty").hidden = true;
    status.textContent = "Ricerca…"; menu.setAttribute("aria-busy", "true");
    input.setAttribute("aria-expanded", "true"); input.removeAttribute("aria-activedescendant");
    timer = setTimeout(render, 250);
  };
  input.onkeydown = event => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); if (menu.hidden || timer) render();
      if (rows.length) activate(active < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1) : (active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter" && !menu.hidden) {
      event.preventDefault(); if (timer) render(); if (rows.length) select(rows[Math.max(0, active)].id);
    } else if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === "Tab") close();
  };
  list.onmousedown = event => { if (event.target.closest("[data-street]")) event.preventDefault(); };
  list.onclick = event => { const option = event.target.closest("[data-street]"); if (option) select(option.dataset.street); };
  list.onmousemove = event => { const option = event.target.closest("[data-street]"); if (option) { const index = rows.findIndex(street => street.id === option.dataset.street); if (index !== active) activate(index); } };
  more.onclick = () => { limit += 40; render(); focus(); };
  clear.onclick = () => { close(); scope = "all"; input.value = ""; clear.hidden = true; list.innerHTML = ""; rows = []; focus(); };
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) close(); });
  document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) close(); });
  return {
    close, focus,
    refresh() { input.disabled = false; failure = null; if (!menu.hidden && !timer) render(); },
    setValue(value) { scope = "all"; input.value = value; clear.hidden = !value && scope === "all"; close(); },
    showScope(value) { scope = value; input.value = ""; limit = 40; clear.hidden = scope === "all"; focus(true); },
    fail(message) { failure = message; input.disabled = false; render(); },
  };
}
