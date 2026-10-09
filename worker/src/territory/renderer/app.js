import { createStreetSearch } from "./street-search.js";
import { icon, labelIcons } from "./icons.js";
import { createToast, isBrowserWarning } from "./toast.js";
import { unitHeadingHtml, ownerListHtml, comparisonHtml } from "./unit-card.js";
import { unitHistoryHtml } from "./unit-history.js";
import { createQueryPanel } from "./query-panel.js";
import { gradientStops, importGradientRenderer } from "./import-gradient.js";
/* The renderer receives data and explicit commands only, never filesystem or credentials. */
(() => {
  const api = window.territory;
  api.onAppearance?.((value) => {
    document.body.classList.toggle("integrated", value.integrated);
    document.documentElement.dataset.theme = value.theme;
    if (snapshot) paint();
  });
  const $ = (id) => document.getElementById(id);
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("it-IT", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "Europe/Rome",
        })
      : "Non ancora acquisita";
  const qty = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const decisions = {
    unknown: "Confronto da eseguire o incompleto",
    create: "Da creare",
    update: "Da aggiornare",
    unchanged: "Già coerente",
    review: "Corrispondenza da chiarire",
    synced: "Allineato",
  };
  const operations = {
    scan: "Acquisizione della via",
    compare: "Confronto con il gestionale",
    apply: "Applicazione del piano",
  };
  const runStates = {
    running: "In corso",
    paused: "Da riprendere",
    completed: "Conclusa",
    failed: "Interrotta",
  };
  let snapshot = null,
    detail = null,
    selectedStreet = null,
    tab = "units",
    dirty = false,
    request = 0;
  const selected = new Set(),
    layers = new Map();
  const dirtyForms = new Set();
  const operationDrafts = new Map();
  function optionsForStreet() {
    if (!operationDrafts.has(selectedStreet)) {
      const scan = [...detail.runs].reverse().find(r => r.operation === "scan" && r.settings)?.settings;
      const apply = [...detail.runs].reverse().find(r => r.operation === "apply" && r.settings)?.settings;
      operationDrafts.set(selectedStreet, {
        filters: { residentialOnly: false, floorMode: "any", floorValue: null, minCivicNumber: null, maxCivicNumber: null, ...scan?.filters },
        includeCoOwners: apply?.includeCoOwners ?? true,
        importPolicy: apply?.importPolicy ?? "create_update",
        activityMode: apply?.activityMode ?? "none",
      });
    }
    return operationDrafts.get(selectedStreet);
  }
  function optionsSummary(run) {
    const s = run.settings;
    if (!s) return "Opzioni originali conservate nel checkpoint";
    if (run.operation === "scan") {
      const f = s.filters;
      const floors = { exact: "piano", minimum: "dal piano", maximum: "fino al piano" };
      return `${f.residentialOnly ? "Categorie A" : "Categorie A e C"}${f.floorMode !== "any" ? ` · ${floors[f.floorMode]} ${f.floorValue}` : " · tutti i piani"}${f.minCivicNumber !== null || f.maxCivicNumber !== null ? ` · civici ${f.minCivicNumber ?? "inizio"}–${f.maxCivicNumber ?? "fine"}` : " · tutti i civici"}`;
    }
    if (run.operation === "compare") return "Sola lettura del gestionale";
    return `${s.importPolicy === "existing_only" ? "Solo schede esistenti" : "Creazioni e aggiornamenti"} · ${s.includeCoOwners ? "tutti gli intestatari" : "solo principale"} · ${s.activityMode === "plain" ? "attività da eseguire" : "nessuna attività"}`;
  }
  function operationOptions(operation, disabled) {
    const settings = optionsForStreet(), f = settings.filters;
    const option = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
    const number = (id, label, value, min, max) => `<label for="${id}">${label}<input id="${id}" type="number" step="1" min="${min}" max="${max}" value="${value ?? ""}"></label>`;
    return `<details class="operation-options" data-disclosure="options-${operation}"><summary>${operation === "scan" ? "Filtri della prossima acquisizione" : "Opzioni del prossimo import"}</summary><form id="options-${operation}"><fieldset ${disabled}><legend class="sr-only">${operation === "scan" ? "Filtri SISTER" : "Regole import"}</legend><div class="operation-fields">${operation === "scan" ? `<label for="scan-category">Categorie<select id="scan-category">${option("all", "Abitazioni e categoria C (box, locali…)", f.residentialOnly ? "homes" : "all")}${option("homes", "Solo categoria A", f.residentialOnly ? "homes" : "all")}</select></label><label for="scan-floor-mode">Piano<select id="scan-floor-mode">${Object.entries({ any: "Tutti i piani", exact: "Piano esatto", minimum: "Da questo piano", maximum: "Fino a questo piano" }).map(([v,l])=>option(v,l,f.floorMode)).join("")}</select></label>${number("scan-floor", "Numero piano (0 = terra)", f.floorValue, -10, 100)}${number("scan-min-civic", "Civico iniziale (facoltativo)", f.minCivicNumber, 0, 999999)}${number("scan-max-civic", "Civico finale (facoltativo)", f.maxCivicNumber, 0, 999999)}` : `<label for="import-policy">Schede da gestire<select id="import-policy">${option("create_update", "Crea o aggiorna secondo il confronto", settings.importPolicy)}${option("existing_only", "Aggiorna soltanto schede esistenti", settings.importPolicy)}</select></label><label for="import-owners">Intestatari<select id="import-owners">${option("all", "Tutti gli intestatari acquisiti", settings.includeCoOwners ? "all" : "primary")}${option("primary", "Solo il principale", settings.includeCoOwners ? "all" : "primary")}</select></label><label for="import-activity">Attività nel gestionale<select id="import-activity">${option("none", "Nessuna attività", settings.activityMode)}${option("plain", "Telefonata da eseguire", settings.activityMode)}</select></label>`}</div><p class="explanation">${operation === "scan" ? "I filtri limitano la lettura dei proprietari. Il totale della via usa l'inventario SISTER prima dei filtri. Piani o civici non riconoscibili restano esclusi se il filtro è attivo." : "Il principale è scelto dal motore in base alle quote. Gli altri collegamenti già presenti sono conservati. L’attività, se richiesta, resta da eseguire e non registra un contatto effettuato. Gli immobili raccolti dalla rete proprietari, o con provenienza storica da verificare, non generano attività."} Le scelte si fissano all’avvio; Riprendi mantiene quelle della run originale.</p></fieldset></form></details>`;
  }
  function bindOperationOptions(operation) {
    const form = $(`options-${operation}`);
    if (!form) return;
    const settings = optionsForStreet();
    form.onsubmit = event => event.preventDefault();
    const numberValue = id => $(id).value === "" ? null : Number($(id).value);
    const update = () => {
      if (operation === "scan") {
        settings.filters = { residentialOnly: $("scan-category").value === "homes", floorMode: $("scan-floor-mode").value, floorValue: numberValue("scan-floor"), minCivicNumber: numberValue("scan-min-civic"), maxCivicNumber: numberValue("scan-max-civic") };
        $("scan-floor").disabled = settings.filters.floorMode === "any" || Boolean(snapshot.activeRun);
        $("scan-floor").required = settings.filters.floorMode !== "any";
        const f = settings.filters;
        $("scan-max-civic").setCustomValidity(f.minCivicNumber !== null && f.maxCivicNumber !== null && f.minCivicNumber > f.maxCivicNumber ? "Il civico finale deve essere maggiore o uguale a quello iniziale" : "");
      } else {
        settings.importPolicy = $("import-policy").value;
        settings.includeCoOwners = $("import-owners").value === "all";
        settings.activityMode = $("import-activity").value;
        updateSelection();
      }
    };
    form.oninput = update;
    form.onchange = update;
    update();
  }
  let hoverId = null;
  let hoverPoint = null;
  let highlightedId = null,
    highlightSource = null;
  const stroke = { weight: 4, opacity: 0.9 },
    hoverStroke = { weight: 8, opacity: 1 };
  let historyView = false,
    historyRows = [],
    historyFilter = "";
  let testsView = false,
    testConfig = null,
    testFilter = "";
  let networkView = false,
    dialogOpener = null;
  const testSelected = new Set();
  let syncBusy = false,
    testLimit = 30,
    historyLimit = 50;
  let unitSearch = "",
    unitFilter = "",
    renderedContext = null;
  // Restore reading and keyboard context across data refreshes, by record identity.
  function remember(root) {
    const active = document.activeElement;
    const locate = (element) =>
      element.id
        ? `#${CSS.escape(element.id)}`
        : element.dataset.testKey
          ? `[data-test-key="${CSS.escape(element.dataset.testKey)}"]`
          : element.closest("[data-unit]")
            ? `[data-unit="${CSS.escape(element.closest("[data-unit]").dataset.unit)}"] ${element.tagName.toLowerCase()}${element.name ? `[name="${CSS.escape(element.name)}"]` : ""}`
            : element.dataset.tab
              ? `[data-tab="${element.dataset.tab}"]`
              : null;
    const open = [...root.querySelectorAll("details[open]")]
      .map((d) => d.dataset.disclosure)
      .filter(Boolean);
    const focus = root.contains(active)
      ? active.tagName === "SUMMARY" && active.parentElement.dataset.disclosure
        ? `[data-disclosure="${CSS.escape(active.parentElement.dataset.disclosure)}"]>summary`
        : locate(active)
      : null;
    return {
      open,
      focus,
      scroll: root.scrollTop,
      dialogScroll: $("detail-dialog").scrollTop,
      bodyScroll: root.querySelector("#detail-body")?.scrollTop || 0,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  }
  function restore(root, state) {
    for (const key of state.open)
      root
        .querySelector(`[data-disclosure="${CSS.escape(key)}"]`)
        ?.setAttribute("open", "");
    const focus = state.focus ? root.querySelector(state.focus) : null;
    focus?.focus({ preventScroll: true });
    if (
      focus?.setSelectionRange &&
      typeof state.start === "number" &&
      ["text", "search"].includes(focus.type)
    )
      focus.setSelectionRange(state.start, state.end);
    root.scrollTop = state.scroll;
    $("detail-dialog").scrollTop = state.dialogScroll;
    if (root.querySelector("#detail-body"))
      root.querySelector("#detail-body").scrollTop = state.bodyScroll;
  }
  function draftStatus() {
    $("draft-status").hidden = !dirty;
  }
  const ready = (u) =>
    u.canWrite && ["create", "update", "synced"].includes(u.assessment?.kind);
  function unitRows() {
    const needle = unitSearch.trim().toLocaleLowerCase("it");
    return detail.units.filter(
      (u) =>
        (!needle ||
          `${u.source.fullAddress} ${u.source.cadastral.sheet} ${u.source.cadastral.parcel} ${u.source.cadastral.subaltern} ${u.source.owners.map((o) => `${o.fullName} ${o.taxCode}`).join(" ")}`
            .toLocaleLowerCase("it")
            .includes(needle)) &&
        (!unitFilter ||
          (unitFilter === "ready"
            ? ready(u)
            : unitFilter === "selected"
              ? selected.has(u.key)
              : unitFilter === "aligned"
                ? ["synced", "unchanged"].includes(u.assessment?.kind)
                : (u.assessment?.kind || "unknown") === unitFilter)),
    );
  }
  function switchTab(next, focus = true) {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di cambiare scheda.",
        true,
      );
    tab = next;
    renderDetail();
    $("detail-dialog").scrollTop = 0;
    if (focus) $(`tab-${tab}`).focus({ preventScroll: true });
  }
  function markDirty(form) {
    dirtyForms.add(form);
    dirty = true;
    draftStatus();
  }
  function saved(form) {
    dirtyForms.delete(form);
    dirty = Boolean(dirtyForms.size);
    draftStatus();
    for (const input of form.querySelectorAll("input,textarea")) {
      if (input.type === "checkbox") input.defaultChecked = input.checked;
      else input.defaultValue = input.value;
    }
  }
  const map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    renderer: importGradientRenderer(L, { tolerance: 5 }),
  }).setView([41.11, 16.69], 15);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const tiles = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  ).addTo(map);
  map.attributionControl.addAttribution("Inventario Bitonto: CC BY 4.0 · Rete: ODbL 1.0");
  let mapOfflineNotified = false;
  tiles.on("tileerror", () => {
    if (!mapOfflineNotified) feedback("Cartografia non raggiungibile. Vie e archivio restano disponibili.", true);
    mapOfflineNotified = true;
  });
  tiles.on("tileload", () => {
    $("map-offline").hidden = true;
  });
  const colors = () => {
    const s = getComputedStyle(document.documentElement),
      token = (name) => s.getPropertyValue(name).trim();
    return {
      never: token("--lr-data-muted"),
      recent: token("--lr-ok"),
      aging: token("--lr-warn"),
      stale: token("--lr-danger"),
    };
  };
  const messageOf = (error) =>
    String(error?.message || "Operazione non riuscita").replace(
      /Error invoking remote method ['"][^'"]+['"]: (?:Error: )?/g,
      "",
    );
  const toast = createToast($("feedback"), {
    openBrowser: () => $("open-browser").onclick(),
    canOpenBrowser: () => Boolean(snapshot?.integrated && snapshot.origin === "live"),
  });
  function feedback(text, error = false, options) {
    if (error) text = messageOf({ message: text });
    toast.show(text, error, options);
  }
  const notifiedRunErrors = new Map();
  function notifyRunIssue(run) {
    if (!run) return;
    if (run.state === "running") { notifiedRunErrors.delete(run.id); return; }
    if (!["paused", "failed"].includes(run.state) || !run.error || notifiedRunErrors.get(run.id) === run.error) return;
    notifiedRunErrors.set(run.id, run.error);
    feedback(run.error, true);
  }
  const safe = (handler) => async (event) => {
    const trigger = event?.currentTarget,
      button =
        trigger?.tagName === "BUTTON"
          ? trigger
          : trigger?.tagName === "FORM"
            ? trigger.querySelector('button[type="submit"],button:not([type])')
            : null;
    if (trigger?.getAttribute("aria-busy") === "true") return;
    const disabled = button?.disabled;
    trigger?.setAttribute("aria-busy", "true");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    trigger?.querySelector(".local-error")?.remove();
    try {
      await handler(event);
    } catch (error) {
      const message = messageOf(error);
      feedback(message, true);
      if (!isBrowserWarning(message) && trigger?.isConnected && $("detail-dialog").contains(trigger)) {
        const node = document.createElement("p");
        node.className = "local-error";
        node.setAttribute("role", "alert");
        node.textContent = message;
        (trigger.tagName === "FORM" ? trigger : trigger.parentElement).append(
          node,
        );
      }
    } finally {
      trigger?.removeAttribute("aria-busy");
      if (button?.isConnected) {
        button.disabled = disabled;
        button.removeAttribute("aria-busy");
      }
    }
  };
  const streetIdentity = (street) =>
    street.catalogKind === "network"
      ? `${escape(street.locality)} · Rete propria`
      : `${escape(street.locality)} · Codvia ${escape(street.id)}`;
  const acquisitionLabel = street => street.progress?.complete ? "Acquisizione completa" : street.progress?.acquiredAt ? "Acquisizione parziale" : "Nessuna acquisizione";
  function statusHtml(street) { return `<span class="status icon-label">${icon(street.progress.complete ? "check" : "download")}${acquisitionLabel(street)}</span>`; }
  function progressHtml(street, compact = false) {
    const p = street.progress, d = p.distribution;
    const coverage =
      d.percent !== null
        ? `${d.percent}% · ${d.imported}/${d.total} immobili già importati`
        : !p.acquisitionRunId
          ? "Da acquisire"
          : p.total === 0
            ? "Nessun immobile nell’ultima acquisizione"
            : `${d.imported} già importati · ${p.observed} letti, totale da verificare`;
    const age =
      d.ageDays !== null
        ? `Ultimo import: ${d.ageDays === 0 ? "oggi" : d.ageDays === 1 ? "1 giorno fa" : `${d.ageDays} giorni fa`}`
        : d.imported
          ? "Data import non disponibile"
          : "Nessun import verificato";
    const buckets = [["recent", "Entro 30 giorni", d.recent], ["aging", "Da 31 a 90 giorni", d.aging], ["stale", "Oltre 90 giorni", d.stale], ["never", "Mai importati", d.never], ["never", "Importati senza data", d.undated]].filter(([, , count]) => count > 0);
    const percentage = count => d.total ? `${Number((count / d.total * 100).toFixed(1)).toLocaleString("it-IT")}%` : "";
    const distribution = d.total > 0 ? `<span class="import-distribution" role="img" aria-label="${escape(buckets.map(([, label, count]) => `${label}: ${percentage(count)}, ${count} immobili`).join("; "))}">${buckets.map(([tone, , count]) => `<span class="import-band ${tone}" style="flex-grow:${count}"></span>`).join("")}</span>` : "";
    const breakdown = d.total > 0 ? `<span class="import-breakdown">${buckets.map(([tone, label, count]) => `<span><span class="dot ${tone}" aria-hidden="true"></span>${label}<strong>${percentage(count)} · ${count}</strong></span>`).join("")}</span>` : "";
    const cohort = !compact && p.acquisitionRunId ? `<span class="meta">In questa acquisizione: ${p.imported}${p.total === null ? "" : `/${p.total}`} import verificati${p.percent === null ? "" : ` (${p.percent}%)`}. Gli import precedenti restano nel gradiente.</span>` : "";
    return `<${compact ? "span" : "div"} class="import-summary ${compact ? "meta" : ""}" data-import-tone="${d.tone}"><strong>${coverage}</strong>${distribution}${p.acquisitionRunId || d.imported ? `<span>${age}</span>` : ""}${compact ? "" : `<details data-disclosure="import-evidence"><summary>Distribuzione e acquisizione</summary>${breakdown}${cohort}`}${compact || !p.acquiredAt ? "" : `<span class="meta">Inventario del ${date(p.acquiredAt)}${d.total === null ? " · incompleto, gradiente da determinare" : " · colori proporzionali, non posizioni degli immobili"}.</span>`}${compact ? "" : "</details>"}</${compact ? "span" : "div"}>`;
  }
  const streetSearch = createStreetSearch({
    root: $("street-search"), getStreets: () => snapshot?.streets ?? [], escape,
    onSelect: street => {
      hidePreview(); selectedStreet = street.id;
      const layer = layers.get(street.id);
      if (layer) {
        map.stop();
        map.fitBounds(layer.getBounds(), { paddingTopLeft: [30, 90], paddingBottomRight: [30, 70], maxZoom: 18, animate: false });
        showPreview(street, map.latLngToContainerPoint(layer.getBounds().getCenter()), false);
      } else showPreview(street, L.point(20, document.querySelector(".map-toolbar").offsetHeight + 36), false);
    },
  });
  L.DomEvent.disableClickPropagation($("street-search"));
  L.DomEvent.disableScrollPropagation($("street-search"));
  function paint() {
    const c = colors();
    for (const street of snapshot.streets) {
      const layer = layers.get(street.id);
      if (!layer) continue;
      const stops = gradientStops(street.progress.distribution, c);
      layer.setStyle({
        color: stops[0].color,
        importGradient: stops,
        ...(street.id === highlightedId ? hoverStroke : stroke),
      });
      const label =
        map.getZoom() >= 16 && street.progress.distribution.percent !== null
          ? `${street.progress.distribution.percent}%`
          : null;
      if (layer.percentLabel !== label) {
        layer.unbindTooltip();
        if (label)
          layer.bindTooltip(label, {
            permanent: true,
            direction: "center",
            className: "street-percent-label",
            opacity: 1,
          });
        layer.percentLabel = label;
      }
    }
  }
  map.on("zoomend", () => {
    if (snapshot) paint();
  });
  function highlight(id, enabled, source = "map") {
    if (enabled) {
      if (highlightedId && highlightedId !== id)
        layers.get(highlightedId)?.setStyle(stroke);
      highlightedId = id;
      highlightSource = source;
    } else if (highlightedId === id) {
      highlightedId = null;
      highlightSource = null;
    }
    layers.get(id)?.setStyle(enabled ? hoverStroke : stroke);
  }
  function hidePreview() {
    highlight(highlightedId, false);
    hoverId = null;
    $("hover").hidden = true;
  }
  function showPreview(street, point, activate = true) {
    if (!street || $("detail-dialog").open) return;
    if (activate) {
      selectedStreet = street.id;
      streetSearch.setValue(street.name);
      highlight(street.id, true);
    }
    hoverId = street.id;
    hoverPoint = point;
    $("hover").innerHTML =
      `<button class="preview-close quiet" aria-label="Chiudi riepilogo">×</button><span class="eyebrow">${streetIdentity(street)}</span><h3>${escape(street.name)}</h3>${progressHtml(street)}${street.geometry ? "" : '<p class="meta">Tracciato non disponibile. La scheda della via è comunque accessibile.</p>'}<p>${statusHtml(street)}<br>${street.count} immobili conservati · ${street.unresolved} da gestire</p><div class="actions"><button class="primary" data-open="${escape(street.id)}">Apri scheda</button></div>`;
    const width = $("map").clientWidth,
      height = $("map").clientHeight;
    $("hover").hidden = false;
    $("hover").style.left =
      `${Math.max(10, Math.min(point.x + 14, width - $("hover").offsetWidth - 10))}px`;
    $("hover").style.top =
      `${Math.max(10, Math.min(point.y + 14, height - $("hover").offsetHeight - 10))}px`;
    $("hover").querySelector("[data-open]").onclick = safe(() =>
      choose(street.id),
    );
    $("hover").querySelector(".preview-close").onclick = hidePreview;
  }
  $("hover").addEventListener("mouseenter", () => {
    highlight(highlightedId, false);
  });
  L.DomEvent.disableClickPropagation($("hover"));
  L.DomEvent.disableScrollPropagation($("hover"));
  $("map").addEventListener("mouseleave", () => {
    highlight(highlightedId, false);
  });
  // Canvas throttles hover events. Check the active trace on every pointer move
  // so a fast exit followed by a stationary cursor cannot leave a wide stroke.
  $("map").addEventListener(
    "mousemove",
    (event) => {
      if (!highlightedId || highlightSource !== "map") return;
      const geometry = snapshot.streets.find(
        (s) => s.id === highlightedId,
      )?.geometry;
      const lines =
        geometry?.type === "LineString"
          ? [geometry.coordinates]
          : geometry?.coordinates || [];
      const rect = $("map").getBoundingClientRect(),
        point = L.point(event.clientX - rect.left, event.clientY - rect.top);
      const onTrace = lines.some((line) => {
        let previous = null;
        return line.some(([lon, lat]) => {
          const next = map.latLngToContainerPoint([lat, lon]);
          const close =
            previous &&
            L.LineUtil.pointToSegmentDistance(point, previous, next) <= 8;
          previous = next;
          return close;
        });
      });
      if (!onTrace) {
        highlight(highlightedId, false);
      }
    },
    { capture: true, passive: true },
  );
  map.on("resize", () => {
    if (hoverId && hoverPoint && !$("hover").hidden) showPreview(snapshot?.streets.find(street => street.id === hoverId), hoverPoint, false);
  });
  map.on("dragstart zoomstart", hidePreview);
  map.on("click", hidePreview);
  window.addEventListener("blur", hidePreview);
  function openDialog(title) {
    $("dialog-title").textContent = title;
    if (!$("detail-dialog").open) {
      dialogOpener = document.activeElement;
      hidePreview();
      $("detail-dialog").append($("feedback"));
      $("detail-dialog").showModal();
      $("dialog-title").focus({ preventScroll: true });
    }
  }
  function closeDialog() {
    if (dirty) {
      feedback(
        "Salva le modifiche aperte o premi Annulla prima di chiudere la scheda.",
        true,
      );
      return;
    }
    $("detail-dialog").close();
  }
  $("detail-close").onclick = closeDialog;
  $("detail-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  $("detail-dialog").addEventListener("click", (event) => {
    const rect = $("detail-dialog").getBoundingClientRect();
    if (
      event.target === $("detail-dialog") &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      closeDialog();
  });
  $("detail-dialog").addEventListener("close", () => {
    networkView = testsView = historyView = false;
    document.body.append($("feedback"));
    if (dialogOpener?.isConnected && dialogOpener.getClientRects().length) dialogOpener.focus({ preventScroll: true });
    else streetSearch.focus();
  });
  async function choose(id) {
    if (dirty) {
      feedback(
        "Salva le modifiche aperte o premi Annulla prima di cambiare via.",
        true,
      );
      return;
    }
    const chosen = await api.detail(id);
    streetSearch.setValue(chosen.street.name);
    historyView = false;
    testsView = false;
    networkView = false;
    selectedStreet = chosen.street.id;
    selected.clear();
    tab = "units";
    unitSearch = "";
    unitFilter = "";
    renderedContext = null;
    hidePreview();
    $("detail-dialog").scrollTop = 0;
    detail = chosen;
    renderDetail();
    openDialog("Scheda della via");
    await refresh();
    $("inspector").scrollTop = 0;
    const layer = layers.get(selectedStreet);
    if (layer)
      map.fitBounds(layer.getBounds(), { padding: [45, 45], maxZoom: 17, animate: false });
    else
      feedback(
        "Questa via è censita ma non ha ancora una geometria. La scheda e i processi sono disponibili.",
      );
  }
  function renderProgress() {
    const run = snapshot.activeRun;
    $("run-progress").hidden = !run;
    if (!run) return;
    const street = snapshot.streets.find((s) => s.id === run.streetId);
    progressContent($("run-progress"), run, street, "pause");
  }
  function renderDetail() {
    if (!detail) return;
    const s = detail.street;
    const context = `${s.id}:${tab}`,
      state = renderedContext === context ? remember($("inspector")) : null;
    const sameContext = renderedContext === context && $("detail-body");
    renderedContext = context;
    $("inspector").classList.add("street-inspector");
    const header = `<div class="street-context"><span class="eyebrow icon-label">${icon("street")}${streetIdentity(s)}</span>${statusHtml(s)}</div><h2>${escape(s.name)}</h2>${progressHtml(s)}`;
    if (sameContext) {
      $("inspector").querySelector(".detail-header").innerHTML = header;
      $("tab-units").innerHTML = `${icon("building")}Immobili ${s.count}`;
    } else
      $("inspector").innerHTML =
        `<div id="detail-run" class="run-inline" hidden></div><header class="detail-header">${header}</header><div id="street-tools" class="street-tools"></div><nav class="tabs" role="tablist" aria-label="Dettaglio della via">${[
                    ["units", `Immobili ${s.count}`],
          ["history", "Storico"],
        ]
          .map(
            ([key, label]) =>
              `<button role="tab" id="tab-${key}" data-tab="${key}" aria-controls="detail-body" tabindex="${tab === key ? "0" : "-1"}" aria-selected="${tab === key}">${label}</button>`,
          )
          .join(
            "",
          )}</nav><div class="detail-content" id="detail-body" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0"></div>`;
    $("inspector")
      .querySelectorAll("[data-tab]")
      .forEach((button) => {
        button.onclick = () => switchTab(button.dataset.tab);
        button.onkeydown = (event) => {
          const keys = ["units", "history"],
            i = keys.indexOf(tab);
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          switchTab(
            keys[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 1
                  : (i + 1) % 2
            ],
          );
        };
      });
    const disabled = snapshot.activeRun ? "disabled" : "";
    const latest = detail.runs.at(-1),
      paused =
        latest && ["paused", "failed"].includes(latest.state) ? latest : null;
    const resume = paused
      ? `<section class="run-item"><strong>${escape(operations[paused.operation])}: da riprendere</strong><p class="explanation">${escape(isBrowserWarning(paused.error || "") ? "Avanzamento conservato. Riprendi dopo aver aperto il browser di lavoro." : paused.error || "L’avanzamento è conservato.")}</p><button id="resume" class="primary" ${disabled}>Riprendi operazione</button></section>`
      : "";
    const counts = { unknown: 0, ready: 0, planned: 0, review: 0, aligned: 0 };
    for (const u of detail.units) {
      if (ready(u)) counts.ready++;
      if (["create", "update"].includes(u.assessment?.kind)) counts.planned++;
      if (!u.assessment || u.assessment.kind === "unknown") counts.unknown++;
      if (u.assessment?.kind === "review") counts.review++;
      if (["synced", "unchanged"].includes(u.assessment?.kind))
        counts.aligned++;
    }
    const step = !s.count
      ? 0
      : counts.ready || counts.planned || counts.review
        ? 2
        : counts.unknown
          ? 1
          : 2;
    const actions = `<div class="actions"><button class="${step === 0 && !paused ? "primary" : ""}" data-operation="scan" ${disabled || s.needsReview ? "disabled" : ""}>Acquisisci via</button><button class="${step === 1 && !paused ? "primary" : ""}" data-operation="compare" ${disabled || !s.count ? "disabled" : ""}>Confronta gestionale</button></div><p class="comparison-help">Il confronto legge il CRM e prepara gli esiti. Nessuna scheda viene modificata fino all’applicazione.</p>`;
    {
      $("street-tools").innerHTML =
        `${resume}<div class="street-actions">${actions}</div><div class="street-secondary">${operationOptions("scan", disabled)}<details class="street-notes" data-disclosure="notes"><summary>Annotazioni della via</summary><form id="memory-form"><label for="street-note">Note operative</label><textarea id="street-note" rows="3" placeholder="Indicazioni utili…">${escape(detail.memory.note)}</textarea><div class="form-actions"><button>Salva note</button><button type="button" data-cancel>Annulla</button></div></form></details></div>`;
      if ($("open-units")) $("open-units").onclick = () => switchTab("units");
      $("memory-form").oninput = (event) => markDirty(event.currentTarget);
      $("memory-form").onsubmit = safe(async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await api.annotate({
          streetId: selectedStreet,
          note: $("street-note").value,
          attention: false,
        });
        saved(form);
        await refresh();
        feedback("Annotazioni conservate");
      });
      if (s.catalogKind === "network") {
        $("street-tools").insertAdjacentHTML(
          "afterbegin",
          `<details class="network-link" data-disclosure="network-link" ${s.needsReview ? "open" : ""}><summary>Collega il tracciato alla via ufficiale</summary><p class="explanation">Questa scheda appartiene alla rete propria e può conservare note e lavoro già da ora. Scegli un Codvia solo dopo aver verificato che il tracciato corrisponde alla via ufficiale. ${s.needsReview ? "Per un tratto senza nome, questa associazione abilita anche l’acquisizione." : ""}</p><form id="network-link-form"><label for="network-official">Via dell'inventario ufficiale</label><input id="network-official" list="network-official-options" required placeholder="Nome della via e Codvia"><datalist id="network-official-options">${snapshot.streets
            .filter((s) => s.catalogKind !== "network" && !s.needsReview)
            .map(
              (s) =>
                `<option value="${escape(`${s.name} · Codvia ${s.id}`)}"></option>`,
            )
            .join(
              "",
            )}</datalist><div class="actions"><button type="submit" ${disabled}>Conferma associazione</button><button type="button" data-cancel>Annulla</button></div></form><p class="explanation">L'associazione aggiunge il tracciato alla via. Letture, operazioni e annotazioni precedenti restano conservate.</p></details>`,
        );
        $("network-link-form").oninput = (event) =>
          markDirty(event.currentTarget);
        $("network-link-form").onsubmit = safe(async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (dirtyForms.size > 1)
            return feedback(
              "Salva o annulla le altre modifiche prima di associare il tracciato.",
              true,
            );
          const official = snapshot.streets.find(
            (s) =>
              s.catalogKind !== "network" &&
              `${s.name} · Codvia ${s.id}` === $("network-official").value,
          );
          if (!official)
            return feedback("Scegli una voce completa con Codvia.", true);
          await api.bindNetwork({ networkId: s.id, officialId: official.id });
          saved(form);
          await choose(official.id);
          feedback(
            "Tracciato associato. Lo storico precedente resta nella scheda.",
          );
        });
      }
      for (const memory of detail.linkedNotes || [])
        $("street-tools").insertAdjacentHTML(
          "beforeend",
          `<details data-disclosure="linked-note"><summary>Annotazioni precedenti sul tracciato</summary><p class="explanation">${escape(memory.note)}</p></details>`,
        );
    }
    if (tab === "units") {
      const rows = unitRows();
      $("detail-body").innerHTML =
        `<div class="unit-toolbar" ${detail.units.length ? "" : "hidden"}><label for="unit-search">Cerca negli immobili<input id="unit-search" type="search" placeholder="Indirizzo, catasto o intestatario…" value="${escape(unitSearch)}"></label><label for="unit-filter">Esito del confronto<select id="unit-filter"><option value="">Tutti (${detail.units.length})</option><option value="ready">Pronti ad applicare (${counts.ready})</option><option value="unknown">Confronto da eseguire o incompleto (${counts.unknown})</option><option value="review">Da verificare (${counts.review})</option><option value="aligned">Coerenti o allineati (${counts.aligned})</option><option value="selected">Solo selezionati (${selected.size})</option></select></label></div><p class="queue-summary" ${detail.units.length ? "" : "hidden"}>Ordine: civico, piano, catasto · ${rows.length} immobili visibili · ${counts.ready} pronti ad applicare · ${counts.review} da verificare</p>${detail.units.length ? operationOptions("apply", disabled) : ""}<div class="units-grid">${rows.length ? rows.map(unitHtml).join("") : `<div class="empty-state"><h3>${detail.units.length ? "Nessun immobile con questi filtri" : "Questa via non ha ancora immobili"}</h3><p>${detail.units.length ? "Cambia ricerca o esito per ritrovare le schede." : "Acquisisci la via per aggiungere immobili."}</p><button id="unit-empty-action">${detail.units.length ? "Azzera filtri immobili" : "Acquisisci via"}</button></div>`}</div><footer class="selection-bar" ${detail.units.length ? "" : "hidden"}><div><strong id="selection-count"></strong><span class="meta" id="selection-plan"></span></div><div class="actions"><button id="select-all" ${disabled}>Seleziona tutti</button><button id="clear-selection" class="quiet">Deseleziona</button><button id="apply" class="primary" ${disabled || !selected.size ? "disabled" : ""}>${snapshot.origin === "simulation" ? "Prova piano" : "Applica selezionati"} (${selected.size})</button></div><p class="explanation" id="selection-help"></p></footer>`;
      $("unit-filter").value = unitFilter;
      for (const id of ["unit-search", "unit-filter"])
        $(id).addEventListener(
          id === "unit-search" ? "input" : "change",
          (event) => {
            if (dirty) {
              event.target.value =
                id === "unit-search" ? unitSearch : unitFilter;
              return feedback(
                "Salva o annulla le correzioni prima di filtrare gli immobili.",
                true,
              );
            }
            if (id === "unit-search") unitSearch = event.target.value;
            else unitFilter = event.target.value;
            renderDetail();
          },
        );
      if ($("unit-empty-action"))
        $("unit-empty-action").onclick = () => {
          if (!detail.units.length) $("street-tools [data-operation='scan']")?.click();
          else {
            unitSearch = unitFilter = "";
            renderDetail();
          }
        };
      $("select-all").onclick = () => {
        if (dirty)
          return feedback(
            "Salva o annulla le modifiche prima di cambiare selezione.",
            true,
          );
        for (const u of rows) selected.add(u.key);
        renderDetail();
      };
      $("clear-selection").onclick = () => {
        if (dirty)
          return feedback(
            "Salva o annulla le modifiche prima di cambiare selezione.",
            true,
          );
        selected.clear();
        renderDetail();
      };
      $("apply").onclick = safe(() => operate("apply"));
      $("detail-body").querySelectorAll(".unit").forEach(card => { card.onclick = event => { if (event.target.closest("input, label, button, summary, details, a, textarea, select") || window.getSelection()?.toString()) return; const input = card.querySelector("[data-unit-select]"); if (input && !input.disabled) input.click(); }; });
      $("detail-body")
        .querySelectorAll("[data-unit-select]")
        .forEach((input) => {
          input.onchange = () => {
            if (dirty) {
              input.checked = selected.has(input.dataset.unitSelect);
              return feedback(
                "Salva o annulla le modifiche prima di cambiare selezione.",
                true,
              );
            }
            input.checked
              ? selected.add(input.dataset.unitSelect)
              : selected.delete(input.dataset.unitSelect);
            if (unitFilter === "selected") renderDetail();
            else updateSelection();
            input.closest(".unit").dataset.selected = String(input.checked);
          };
        });
      $("detail-body")
        .querySelectorAll("[data-authorize-key]")
        .forEach((button) => {
          button.onclick = () => {
            if (dirty)
              return feedback(
                "Salva o annulla le modifiche prima di scegliere il collaudo.",
                true,
              );
            testFilter = detail.units.find(
              (u) => u.key === button.dataset.authorizeKey,
            ).source.fullAddress;
            $("test-settings").click();
          };
        });
      updateSelection();
      $("detail-body")
        .querySelectorAll("[data-edit]")
        .forEach((form) => {
          form.oninput = () => markDirty(form);
          form.onsubmit = safe(async (event) => {
            event.preventDefault();
            const key = form.dataset.edit,
              unit = detail.units.find((u) => u.key === key);
            const data = new FormData(form);
            const owners = unit.source.owners.map((owner, i) => ({
              ...owner,
              fullName: String(data.get(`name-${i}`)),
              taxCode: String(data.get(`cf-${i}`)),
              sharePercentage:
                String(data.get(`share-${i}`)).trim() === ""
                  ? null
                  : Number(data.get(`share-${i}`)),
            }));
            await api.correct({
              key,
              note: String(data.get("note")),
              correction: {
                address: String(data.get("address")),
                category: String(data.get("category")),
                owners,
              },
            });
            saved(form);
            selected.delete(key);
            await refresh();
            feedback("Correzione conservata. Serve un nuovo confronto.");
          });
        });
    } else {
      $("detail-body").innerHTML =
        `<h3>Operazioni della via</h3><ul class="runs-list">${
          [...detail.runs]
            .reverse()
            .map(
              (run) =>
                `<li class="run-item"><strong>${escape(operations[run.operation])}</strong><p>${escape(runStates[run.state])} · ${run.handled} immobili</p><p class="meta">${date(run.startedAt)}${run.endedAt ? ` → ${date(run.endedAt)}` : ""}</p><p class="meta">${escape(optionsSummary(run))}</p>${run.error ? `<p class="explanation">${escape(run.error)}</p>` : ""}</li>`,
            )
            .join("") ||
          '<li class="explanation">Nessuna operazione su questa via.</li>'
        }</ul><h3>Diario</h3><ul class="timeline">${
          [...detail.events]
            .reverse()
            .map(
              (e) =>
                `<li><p>${escape(e.text)}</p><span class="meta">${date(e.at)}</span></li>`,
            )
            .join("") ||
          '<li class="explanation">Il diario conserva operazioni e annotazioni.</li>'
        }</ul>`;
      if (detail.history?.length)
        $("detail-body").insertAdjacentHTML(
          "beforeend",
          `<details class="archive-details" data-disclosure="legacy-history"><summary>Lavorazioni precedenti (${detail.history.length})</summary><p class="explanation">Prove recuperate dal worker precedente. I vecchi checkpoint restano nel loro archivio; la presenza attuale richiede un nuovo confronto.</p><ul class="runs-list">${detail.history.map((h) => `<li class="run-item"><strong>${escape(h.street || "Acquisizione precedente")}</strong><p>${escape({ completed: "Conclusa", paused: "Sospesa", saved: "Acquisizione conservata", needs_review: "Da verificare" }[h.status] || "Stato precedente da verificare")}</p><p class="meta">${date(h.at)} · ${h.acquired} righe nella lavorazione<br>${h.imported} import precedenti conclusi · ${h.issues.length} righe da verificare</p></li>`).join("")}</ul></details>`,
        );
    }
    $("inspector").querySelectorAll("[data-cancel]")
      .forEach((button) => {
        button.onclick = () => {
          const form = button.closest("form");
          form.reset();
          form.querySelector(".local-error")?.remove();
          dirtyForms.delete(form);
          dirty = Boolean(dirtyForms.size);
          draftStatus();
          if (!dirty) renderDetail();
        };
      });
    $("inspector").querySelectorAll("[data-operation]")
      .forEach((button) => {
        button.onclick = safe(() => operate(button.dataset.operation));
      });
    if ($("resume"))
      $("resume").onclick = safe(async () => {
        if (dirty)
          return feedback(
            "Salva o annulla le modifiche prima di riprendere il processo.",
            true,
          );
        await api.start({
          streetId: selectedStreet,
          operation: paused.operation,
          selected: paused.itemKeys,
          resumeId: paused.id,
        });
        await refresh();
      });
    bindOperationOptions("scan");
    bindOperationOptions("apply");
    modalProgress();
    draftStatus();
    labelIcons($("inspector"));
    notifyRunIssue(detail.runs.at(-1));
    if (state) restore($("inspector"), state);
  }
  function unitHtml(u) {
    const s = u.source,
      decision = u.assessment?.kind || "unknown";
    const enabled = !snapshot.activeRun;
    return `<article class="unit" data-unit="${escape(u.key)}" data-selected="${selected.has(u.key)}"><div class="unit-head"><label class="unit-select-label"><input type="checkbox" aria-label="Seleziona ${escape(s.fullAddress)}" data-unit-select="${escape(u.key)}" ${selected.has(u.key) ? "checked" : ""} ${enabled ? "" : "disabled"}></label><div>${unitHeadingHtml(u, escape)}</div></div>${ownerListHtml(s.owners, escape)}${comparisonHtml(u, escape)}${!u.canWrite && ["create", "update"].includes(decision) ? '<p class="meta">Scheda non autorizzata al collaudo</p><button class="quiet" data-authorize-key="' + escape(u.key) + '">Scegli per il collaudo</button>' : ""}<details data-disclosure="${escape(u.key)}:record"><summary>Dati immobile e acquisizioni</summary><div class="unit-detail-body"><table><tr><th scope="row">Categoria</th><td>${escape(s.category)}</td></tr><tr><th scope="row">Consistenza</th><td>${escape(s.consistency)}</td></tr><tr><th scope="row">Ultima acquisizione</th><td>${date(u.observations.at(-1)?.at)}</td></tr>${u.crmId ? `<tr><th scope="row">Scheda gestionale</th><td>${escape(u.crmId)}</td></tr><tr><th scope="row">Ultimo import concluso</th><td>${u.importedAt ? date(u.importedAt) : "Data non disponibile"}</td></tr>` : ""}</table><p>${escape(u.note)}</p><details data-disclosure="${escape(u.key)}:observations"><summary>Acquisizioni precedenti (${u.observations.length})</summary>${[
      ...u.observations,
    ]
      .reverse()
      .map(
        (o) =>
          `<p class="explanation">${date(o.at)} · ${escape(o.source.fullAddress)} · ${o.source.owners.length} intestatari</p>`,
      )
      .join(
        "",
      )}</details></div></details>${unitHistoryHtml(u, escape, date)}<details data-disclosure="${escape(u.key)}:edit"><summary>Correggi i dati conservati</summary><div class="unit-detail-body"><p class="explanation">La lettura originale resta nello storico. Le correzioni manuali saranno conservate anche alla prossima acquisizione.</p><form class="edit-form" data-edit="${escape(u.key)}"><div class="field"><label>Indirizzo<input name="address" required value="${escape(s.fullAddress)}"></label></div><div class="field"><label>Categoria<input name="category" required value="${escape(s.category)}"></label></div>${s.owners.map((owner, i) => `<div class="owner-edit"><label>Nome intestatario<input name="name-${i}" aria-label="Nome intestatario ${i + 1}" required value="${escape(owner.fullName)}"></label><label>Codice fiscale<input name="cf-${i}" aria-label="Codice fiscale intestatario ${i + 1}" value="${escape(owner.taxCode)}"></label><label>Quota (%)<input name="share-${i}" type="number" min="0" max="100" step="0.001" aria-label="Quota intestatario ${i + 1}" value="${owner.sharePercentage ?? ""}"></label></div>`).join("")}<div class="field"><label>Annotazioni<textarea name="note" rows="2">${escape(u.note)}</textarea></label></div><div class="form-actions"><button ${snapshot.activeRun ? "disabled" : ""}>Salva correzioni</button><button type="button" data-cancel>Annulla</button></div></form></div></details></article>`;
  }
  function updateSelection() {
    if (!$("apply")) return;
    const records = detail.units.filter((u) => selected.has(u.key)),
      visible = new Set(unitRows().map((u) => u.key)),
      hidden = records.filter((u) => !visible.has(u.key)).length;
    const settings = optionsForStreet();
    const blockedCreation = settings.importPolicy === "existing_only" && records.some(u => u.assessment?.kind === "create");
    $("selection-count").textContent = qty(
      selected.size,
      "immobile selezionato",
      "immobili selezionati",
    );
    $("selection-plan").textContent =
      `${qty(records.filter((u) => u.assessment?.kind === "create").length, "nuova scheda", "nuove schede")} · ${qty(records.filter((u) => u.assessment?.kind === "update").length, "aggiornamento", "aggiornamenti")}${hidden ? ` · ${hidden} fuori dai filtri` : ""}`;
    $("apply").disabled = !selected.size || Boolean(snapshot.activeRun) || blockedCreation || records.some(u => !ready(u));
    $("apply").textContent =
      `${snapshot.origin === "simulation" ? "Prova piano" : "Applica selezionati"} (${selected.size})`;
    $("clear-selection").disabled = !selected.size;
    $("unit-filter").querySelector('[value="selected"]').textContent =
      `Solo selezionati (${selected.size})`;
    $("selection-help").textContent = snapshot.activeRun
      ? "Attendi o sospendi l’operazione in corso."
      : blockedCreation ? "Hai scelto solo schede esistenti: deseleziona gli immobili da creare, oppure cambia la regola d’import."
      : records.some(u => !ready(u)) ? "Confronta i selezionati e autorizza le schede prima di applicare."
      : selected.size
        ? `${snapshot.origin === "simulation" ? "Piano simulato" : "Solo schede autorizzate"}: ${optionsSummary({ operation: "apply", settings })}. Ogni immobile verrà verificato prima del salvataggio.${hidden ? " La selezione include anche gli immobili fuori dai filtri." : ""}`
        : "Seleziona gli immobili pronti. I casi dubbi restano esclusi.";
  }
  function modalProgress() {
    if (!$("detail-run")) return;
    const run = snapshot.activeRun;
    $("detail-run").hidden = !run;
    if (!run) return;
    const street = snapshot.streets.find((s) => s.id === run.streetId);
    progressContent($("detail-run"), run, street, "detail-pause");
  }
  function progressContent(root, run, street, id) {
    if (root.dataset.run !== run.id) {
      root.dataset.run = run.id;
      root.innerHTML = `<div><strong></strong><p></p><progress aria-label="Avanzamento dell’operazione"></progress></div><button id="${id}">Pausa</button>`;
      $(id).onclick = safe(async () => {
        await api.pause();
        feedback(
          "Pausa richiesta. L’avanzamento viene conservato al prossimo punto sicuro.",
        );
      });
    }
    root.querySelector("strong").textContent = operations[run.operation];
    root.querySelector("p").textContent =
      `${street?.name || "Via in lavorazione"} · ${run.handled}${run.total === null ? "" : ` / ${run.total}`} immobili`;
    const progress = root.querySelector("progress");
    if (run.total) {
      progress.max = run.total;
      progress.value = run.handled;
    } else progress.removeAttribute("value");
  }
  async function operate(operation) {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di avviare il processo.",
        true,
      );
    const form = $(`options-${operation}`);
    if (form && !form.checkValidity()) {
      form.closest("details").open = true;
      form.reportValidity();
      return;
    }
    const runId = await api.start({
      settings: operation === "scan" ? { filters: optionsForStreet().filters } : operation === "apply" ? { includeCoOwners: optionsForStreet().includeCoOwners, importPolicy: optionsForStreet().importPolicy, activityMode: optionsForStreet().activityMode } : undefined,
      streetId: selectedStreet,
      operation,
      selected: operation === "scan" ? [] : [...selected],
    });
    if (runId && operation === "apply") selected.clear();
    await refresh();
  }
  async function refresh() {
    const currentRequest = ++request;
    const next = await api.snapshot();
    const nextDetail = selectedStreet ? await api.detail(selectedStreet) : null;
    const memory = await api.syncStatus();
    if (currentRequest !== request) return;
    snapshot = next;
    detail = nextDetail;
    notifyRunIssue(detail?.runs.at(-1));
    $("archive-error").hidden = true;
    if (detail)
      for (const key of selected)
        if (!detail.units.some((u) => u.key === key))
          selected.delete(key);
    document.body.classList.toggle("integrated", Boolean(snapshot.integrated));
    $("open-browser").hidden =
      !snapshot.integrated || snapshot.origin !== "live";
    $("test-settings").hidden = snapshot.origin !== "live";
    $("cloud-memory").hidden = !memory.configured;
    const online = memory.environment === "online";
    $("cloud-memory").textContent = online
      ? memory.error
        ? "Sincronizzazione da verificare"
        : memory.syncing
          ? "Salvataggio…"
          : memory.pending
            ? "Modifiche in attesa"
            : "Archivio sincronizzato"
      : "Sincronizzazione";
    $("cloud-memory").title =
      memory.error ||
      (online
        ? "Vie, immobili, note e storico sincronizzati su Supabase"
        : "Memoria condivisa locale");
    $("memory-pull").textContent = online
      ? "Recupera archivio online"
      : "Recupera archivio condiviso";
    $("memory-title").textContent = online
      ? "Memoria online"
      : "Memoria condivisa di prova";
    $("memory-description").textContent = online
      ? "Vie, immobili, note e storico vengono sincronizzati automaticamente dopo le modifiche e al termine delle lavorazioni. Una copia locale permette di conservare il lavoro anche senza rete. I conflitti richiedono un confronto."
      : "Archivio nell'ambiente locale separato. Un conflitto conserva le tue modifiche e richiede un confronto.";
    if (memory.configured)
      $("memory-date").textContent =
        memory.error ||
        (memory.syncing
          ? "Salvataggio in corso…"
          : memory.pending
            ? "Modifiche locali in attesa di sincronizzazione."
            : memory.syncedAt
              ? `Ultima sincronizzazione: ${date(memory.syncedAt)}`
              : "Non ancora sincronizzata");
    $("history-review").hidden = !snapshot.historyIssues;
    $("history-review").textContent =
      `Storico da associare (${snapshot.historyIssues || 0})`;
    $("environment").textContent =
      snapshot.origin === "simulation"
        ? "Laboratorio locale · simulazione"
        : snapshot.integrated
          ? "Worker V2 · collaudo reale"
          : "Worker V2 · collaudo reale";
    $("notice").textContent =
      snapshot.origin === "simulation"
        ? "Le vie sono reali. Immobili e gestionale sono simulati; il lavoro di prova resta conservato in questo laboratorio."
        : "Profilo di prova separato. Le scritture sono limitate alle identità catastali concordate; consulta il piano prima di applicare.";
    const present = new Set(
      snapshot.streets.filter((s) => s.geometry).map((s) => s.id),
    );
    for (const [id, layer] of layers)
      if (!present.has(id)) {
        layer.remove();
        layers.delete(id);
      }
    for (const street of snapshot.streets)
      if (street.geometry) {
        const geometryKey = JSON.stringify(street.geometry),
          previous = layers.get(street.id);
        if (previous) {
          if (previous.geometryKey !== geometryKey) {
            previous.clearLayers();
            previous.addData(street.geometry);
            previous.geometryKey = geometryKey;
            previous.percentLabel = undefined;
          }
          continue;
        }
        const layer = L.geoJSON(street.geometry, {
          style: {
            color: colors()[street.progress.tone],
            ...stroke,
            lineCap: "round",
          },
          bubblingMouseEvents: false,
        });
        layer.geometryKey = geometryKey;
        layer.on("mouseover", () => {
          if (!$("detail-dialog").open) highlight(street.id, true);
        });
        layer.on("mousemove", () => {
          if (highlightedId !== street.id)
            if (!$("detail-dialog").open) highlight(street.id, true);
        });
        layer.on("mouseout", () => {
          highlight(street.id, false);
        });
        layer.on("click", (event) =>
          showPreview(
            snapshot.streets.find((s) => s.id === street.id),
            map.latLngToContainerPoint(event.latlng),
          ),
        );
        layers.set(street.id, layer);
        layer.addTo(map);
      }
    streetSearch.refresh();
    paint();
    renderProgress();
    modalProgress();
    if (!dirty && $("detail-dialog").open) {
      if (networkView) showNetworkSetup();
      else if (testsView) await showTestSettings();
      else if (historyView) await showHistoryReview();
      else if (queryPanel.active) await queryPanel.refresh();
      else renderDetail();
    }
    if (hoverId && hoverPoint && !$("hover").hidden) {
      const street = snapshot.streets.find((s) => s.id === hoverId);
      if (street) showPreview(street, hoverPoint, false);
      else hidePreview();
    }
    labelIcons(document);
    if (snapshot.error) feedback(snapshot.error, true, { deduplicate: true });
    else toast.reset();
    map.invalidateSize();
  }
  $("refresh").onclick = safe(async () => {
    $("tools").open = false;
    await refresh();
  });
  $("open-browser").onclick = safe(async () => {
    const result = await api.openBrowser();
    feedback(
      result.alreadyOpen
        ? "Chrome di lavoro è già aperto. Verifica l’accesso a SISTER e Tecnocloud."
        : "Chrome di lavoro aperto. Accedi a SISTER e Tecnocloud prima di acquisire o confrontare.",
    );
  });
  $("detail-refresh").onclick = safe(refresh);
  $("network-setup").onclick = () => {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di aprire la rete.",
        true,
      );
    networkView = true;
    historyView = false;
    testsView = false;
    $("tools").open = false;
    openDialog("Rete del territorio");
    showNetworkSetup();
  };
  function showNetworkSetup() {
    $("inspector").classList.remove("street-inspector");
    renderedContext = null;
    const streets = snapshot.streets,
      paths = streets.filter((s) => s.geometry),
      unworked = paths.filter((s) => s.status === "unseen");
    $("inspector").innerHTML =
      `<header class="detail-header"><span class="eyebrow">Setup del territorio</span><h2>Rete delle vie</h2><p class="explanation">Le schede nascono dalla rete di vie, prima delle acquisizioni. Passa sul tracciato per illuminarlo, clicca e scegli Apri scheda per aprire il dossier e registra il lavoro da lì.</p></header><div class="detail-content"><dl class="network-summary"><dt>Vie ufficiali censite</dt><dd>${snapshot.network.official}</dd><dt>Tracciati apribili sulla mappa</dt><dd>${paths.length}</dd><dt>Tracciati ancora da lavorare</dt><dd>${unworked.length}</dd><dt>Associazioni alla via confermate</dt><dd>${snapshot.network.linked}</dd></dl><div class="actions"><button class="primary" data-network-scope="unseen">Apri vie da lavorare</button><button data-network-scope="network">Tracciati da associare</button><button data-network-scope="official">Inventario ufficiale</button><button data-network-scope="all">Tutta la rete</button></div><p class="explanation">Ogni voce ha già una scheda privata. I tratti senza nome conservano il proprio identificativo e possono essere collegati esplicitamente alla via ufficiale. Gli omonimi restano distinti.</p><p class="explanation">${streets.filter((s) => !s.geometry).length} voci ufficiali attendono ancora un tracciato verificato. La loro scheda si apre dalla ricerca anche senza geometria.</p></div>`;
    $("inspector")
      .querySelectorAll("[data-network-scope]")
      .forEach((button) => {
        button.onclick = () => {
          const scope = button.dataset.networkScope;
          closeDialog();
          streetSearch.showScope(scope);
        };
      });
  }
  $("cloud-memory").onclick = () => {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di sincronizzare.",
        true,
      );
    $("memory-result").textContent = "";
    $("memory-dialog").showModal();
  };
  $("memory-close").onclick = () => {
    if (!syncBusy) $("memory-dialog").close();
  };
  $("memory-dialog").addEventListener("cancel", (event) => {
    if (syncBusy) event.preventDefault();
  });
  for (const [id, direction] of [
    ["memory-push", "push"],
    ["memory-pull", "pull"],
  ])
    $(id).onclick = async () => {
      if (syncBusy || snapshot.activeRun) {
        $("memory-result").textContent =
          "Attendi la fine dell’operazione in corso prima di sincronizzare manualmente.";
        return;
      }
      syncBusy = true;
      $("memory-result").textContent = "Sincronizzazione in corso…";
      for (const button of $("memory-dialog").querySelectorAll("button"))
        button.disabled = true;
      try {
        const result = await api.sync(direction);
        $("memory-result").textContent = result.changed
          ? direction === "push"
            ? "Memoria condivisa aggiornata."
            : "Memoria recuperata. La copia locale precedente è conservata."
          : "Gli archivi coincidono già.";
        await refresh();
      } catch (error) {
        $("memory-result").textContent = messageOf(error);
      } finally {
        syncBusy = false;
        for (const button of $("memory-dialog").querySelectorAll("button"))
          button.disabled = false;
      }
    };
  $("test-settings").onclick = safe(async () => {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di scegliere le prove.",
        true,
      );
    networkView = false;
    testsView = true;
    historyView = false;
    $("tools").open = false;
    openDialog("Schede di prova");
    await showTestSettings();
  });
  async function showTestSettings() {
    $("inspector").classList.remove("street-inspector");
    renderedContext = null;
    const next = await api.testSettings();
    if (!testsView || dirty || !next.live) return;
    const state = remember($("inspector"));
    testConfig = next;
    testSelected.clear();
    next.selected.forEach((key) => testSelected.add(key));
    $("inspector").innerHTML =
      `<header class="detail-header"><span class="eyebrow">Profilo separato</span><h2>Autorizzazioni al collaudo</h2><p class="explanation">Scegli gli immobili su cui autorizzi la prova. Solo questi immobili e i loro intestatari potranno essere scritti. Il salvataggio di questa scelta non modifica il gestionale.</p><label class="sr-only" for="test-search">Cerca schede di prova</label><input id="test-search" type="search" placeholder="Indirizzo, catasto o intestatario…" value="${escape(testFilter)}"></header><div class="detail-content tests-content"><form id="tests-form"><p id="test-count" class="meta"></p><div id="test-records"></div><div class="tests-controls"><label class="check-label"><input id="test-create" type="checkbox" ${next.allowCreate ? "checked" : ""}>Consenti anche nuove schede</label><p class="explanation">Se non selezionato, sono ammessi solo gli aggiornamenti di immobili già presenti. Ogni applicazione richiede un confronto nuovo e la conferma del piano.</p><label class="check-label"><input id="test-consent" type="checkbox">Autorizzo il collaudo sulle schede selezionate e sui loro intestatari.</label><div class="actions"><button id="test-save" class="primary">Salva scelta</button><button id="test-revoke" type="button">Disabilita scritture</button><button id="test-cancel" type="button">Annulla modifiche</button></div><p class="explanation">Per acquisire e confrontare, apri Chrome di lavoro e accedi a SISTER e Tecnocloud.</p></div></form></div>`;
    $("test-search").oninput = (event) => {
      testFilter = event.target.value;
      testLimit = 30;
      renderTestRecords();
    };
    $("tests-form").onchange = (event) => markDirty(event.currentTarget);
    $("test-cancel").onclick = safe(async () => {
      saved($("tests-form"));
      await showTestSettings();
    });
    $("test-revoke").onclick = safe(async () => {
      await api.configureTests({
        keys: [],
        allowCreate: false,
        confirmed: false,
      });
      saved($("tests-form"));
      await refresh();
      feedback("Scritture disabilitate nel profilo di prova");
    });
    $("tests-form").onsubmit = safe(async (event) => {
      event.preventDefault();
      if (testSelected.size && !$("test-consent").checked)
        return feedback("Conferma il collaudo sulle schede selezionate.", true);
      const result = await api.configureTests({
        keys: [...testSelected],
        allowCreate: $("test-create").checked,
        confirmed: $("test-consent").checked,
      });
      saved($("tests-form"));
      await refresh();
      feedback(
        result.selected
          ? `${result.selected} schede di prova autorizzate`
          : "Scritture disabilitate",
      );
    });
    renderTestRecords();
    restore($("inspector"), state);
  }
  function renderTestRecords() {
    const state = remember($("test-records"));
    const needle = testFilter.trim().toLocaleLowerCase("it");
    const rows = testConfig.records
      .filter(
        (r) =>
          testSelected.has(r.key) ||
          `${r.address} ${r.key} ${r.owners.map((o) => `${o.fullName} ${o.taxCode}`).join(" ")}`
            .toLocaleLowerCase("it")
            .includes(needle),
      )
      .sort(
        (a, b) =>
          Number(testSelected.has(b.key)) - Number(testSelected.has(a.key)),
      );
    $("test-count").textContent =
      `${qty(testSelected.size, "scheda selezionata", "schede selezionate")} · ${qty(testConfig.selected.length, "autorizzata", "autorizzate")} · ${Math.min(rows.length, testLimit)} visibili su ${rows.length} risultati · massimo 10 schede autorizzabili`;
    $("test-records").innerHTML =
      rows
        .slice(0, testLimit)
        .map(
          (r) =>
            `<article class="unit"><label class="check-label"><input type="checkbox" data-test-key="${escape(r.key)}" ${testSelected.has(r.key) ? "checked" : ""} ${r.eligible ? "" : "disabled"}><strong>${escape(r.address)}</strong></label><p class="identity">F ${escape(r.cadastral.sheet)} · P ${escape(r.cadastral.parcel)} · S ${escape(r.cadastral.subaltern)}</p>${r.reason ? `<p class="reason">${escape(r.reason)}</p>` : ""}<details data-disclosure="test:${escape(r.key)}"><summary>Intestatari autorizzati con questa scheda</summary>${r.owners.map((o) => `<p>${escape(o.fullName)}<br><span class="mono">${escape(o.taxCode)}</span></p>`).join("")}</details></article>`,
        )
        .join("") ||
      '<p class="explanation">Nessuna scheda con questa ricerca. Acquisisci una via o correggi i dati incompleti prima di sceglierla.</p>';
    if (rows.length > testLimit) {
      $("test-records").insertAdjacentHTML(
        "beforeend",
        '<button type="button" class="load-more" id="more-tests">Mostra altre schede</button>',
      );
      $("more-tests").onclick = () => {
        testLimit += 30;
        renderTestRecords();
      };
    }
    restore($("test-records"), state);
    $("test-records")
      .querySelectorAll("[data-test-key]")
      .forEach((input) => {
        input.onchange = () => {
          if (input.checked && testSelected.size >= 10) {
            input.checked = false;
            return feedback(
              "Scegli al massimo dieci schede per il collaudo.",
              true,
            );
          }
          if (input.checked) testSelected.add(input.dataset.testKey);
          else testSelected.delete(input.dataset.testKey);
          $("test-consent").checked = false;
          markDirty($("tests-form"));
          renderTestRecords();
        };
      });
  }
  $("history-review").onclick = safe(async () => {
    if (dirty)
      return feedback(
        "Salva o annulla le modifiche prima di aprire lo storico.",
        true,
      );
    networkView = false;
    testsView = false;
    historyView = true;
    $("tools").open = false;
    openDialog("Storico da associare");
    await showHistoryReview();
  });
  async function showHistoryReview() {
    $("inspector").classList.remove("street-inspector");
    renderedContext = null;
    const rows = await api.historyReview();
    if (!historyView) return;
    const state = remember($("inspector"));
    historyRows = rows;
    $("inspector").innerHTML =
      `<header class="detail-header"><span class="eyebrow">Recupero dello storico</span><h2>Associazioni dello storico</h2><p class="explanation">${rows.filter((r) => r.canAssociate).length} righe richiedono una via; ${rows.filter((r) => !r.canAssociate).length} restano escluse o incomplete. Nessuna scrittura nel gestionale.</p><label class="sr-only" for="history-search">Cerca nello storico</label><input id="history-search" type="search" placeholder="Cerca indirizzo o catasto…" value="${escape(historyFilter)}"></header><div class="detail-content" id="history-items"></div>`;
    $("history-search").oninput = (event) => {
      if (dirty) {
        event.target.value = historyFilter;
        return;
      }
      historyFilter = event.target.value;
      historyLimit = 50;
      renderHistoryRows();
    };
    renderHistoryRows();
    restore($("inspector"), state);
  }
  function renderHistoryRows() {
    const needle = historyFilter.trim().toLocaleLowerCase("it");
    const rows = historyRows.filter((r) =>
      `${r.address || ""} ${r.cadastral?.sheet || ""} ${r.cadastral?.parcel || ""} ${r.cadastral?.subaltern || ""}`
        .toLocaleLowerCase("it")
        .includes(needle),
    );
    $("history-items").innerHTML =
      `<p class="meta">${rows.length} righe da controllare</p>${
        rows
          .slice(0, historyLimit)
          .map(
            (r) =>
              `<article class="unit"><h3>${escape(r.address || "Indirizzo non disponibile")}</h3>${r.cadastral ? `<p class="identity">F ${escape(r.cadastral.sheet)} · P ${escape(r.cadastral.parcel)} · S ${escape(r.cadastral.subaltern)}</p>` : ""}<p class="reason">${escape(r.reason)}</p>${r.canAssociate ? `<button data-associate="${escape(r.propertyId)}">Associa a una via</button>` : '<p class="explanation">Conservata come evidenza della raccolta originale.</p>'}</article>`,
          )
          .join("") ||
        '<p class="explanation">Nessuna riga con questa ricerca.</p>'
      }`;
    if (rows.length > historyLimit) {
      $("history-items").insertAdjacentHTML(
        "beforeend",
        '<button class="load-more" id="more-history">Mostra altre righe</button>',
      );
      $("more-history").onclick = () => {
        if (dirty)
          return feedback("Salva o annulla l’associazione aperta.", true);
        historyLimit += 50;
        renderHistoryRows();
      };
    }
    $("history-items")
      .querySelectorAll("[data-associate]")
      .forEach((button) => {
        button.onclick = () => {
          if (dirty)
            return feedback("Salva o annulla l’associazione aperta.", true);
          const row = historyRows.find(
            (r) => r.propertyId === button.dataset.associate,
          );
          button.closest("article").insertAdjacentHTML(
            "beforeend",
            `<form id="association-form"><div class="field"><label for="history-street">Via dell'inventario<input id="history-street" list="history-street-options" required placeholder="Nome della via e Codvia"></label><datalist id="history-street-options">${snapshot.streets
              .filter((s) => s.catalogKind !== "network" && !s.needsReview)
              .map(
                (s) =>
                  `<option value="${escape(`${s.name} · Codvia ${s.id}`)}"></option>`,
              )
              .join(
                "",
              )}</datalist></div><p class="explanation">La scelta associa questa riga alla via selezionata. Controlla il Codvia quando più vie hanno lo stesso nome.</p><div class="actions"><button class="primary">Conferma associazione</button><button type="button" id="cancel-association">Annulla</button></div></form>`,
          );
          dirty = true;
          draftStatus();
          $("history-search").disabled = true;
          $("cancel-association").onclick = () => {
            dirty = false;
            draftStatus();
            $("history-search").disabled = false;
            renderHistoryRows();
          };
          $("association-form").onsubmit = safe(async (event) => {
            event.preventDefault();
            const chosen = snapshot.streets.find(
              (s) => `${s.name} · Codvia ${s.id}` === $("history-street").value,
            );
            if (!chosen)
              return feedback(
                "Scegli una voce completa dell’inventario, con Codvia.",
                true,
              );
            await api.associate({
              propertyId: row.propertyId,
              streetId: chosen.id,
            });
            dirty = false;
            draftStatus();
            await refresh();
            feedback("Associazione conservata nel laboratorio");
          });
          $("history-street").focus();
        };
      });
  }
  $("home").onclick = () => map.setView([41.11, 16.69], 15);
  let refreshTimer;
  api.onChange(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refresh().catch((error) => feedback(error.message, true));
    }, 80);
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && !syncBusy)
      refresh().catch((error) => feedback(error.message, true));
  }, 60000);
  window.addEventListener("focus", () => {
    if (snapshot && !syncBusy)
      refresh().catch((error) => feedback(error.message, true));
  });
  function archiveFailure(error) {
    streetSearch.fail(messageOf(error));
  }
  $("retry-archive").onclick = safe(async () => {
    try {
      await refresh();
    } catch (error) {
      archiveFailure(error);
    }
  });
  document.addEventListener("click", (event) => {
    if (!$("tools").contains(event.target)) $("tools").open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("tools").open) {
      $("tools").open = false;
      $("tools").querySelector("summary").focus();
    }
  });
  const queryPanel = createQueryPanel({ api, escape, feedback, notifyRunIssue, snapshot: () => snapshot,
    open: async () => { if (dirty) { feedback("Salva o annulla le modifiche prima di aprire le query.", true); return false; } selectedStreet = null; detail = null; renderedContext = null; networkView = historyView = testsView = false; $("inspector").classList.remove("street-inspector"); openDialog("Query immobili"); return true; },
    openUnit: async unit => { if (!unit.streetIds.length) return feedback("Associa questo immobile a una via dallo storico prima di lavorarlo.", true); await choose(unit.streetIds[0]); const card = [...$("inspector").querySelectorAll("[data-unit]")].find(c => c.dataset.unit === unit.key); if (card) { card.querySelector('[data-disclosure$=":record"]').open = true; card.scrollIntoView({ block: "start", behavior: "smooth" }); } }
  });
  $("query-manager").onclick = safe(() => queryPanel.open());
  refresh().catch(archiveFailure);
})();
