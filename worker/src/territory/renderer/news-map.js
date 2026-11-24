const layerInfo = {
  mercato: { label: "Mercato", symbol: "M", color: "#195e86" },
  opportunita: { label: "Opportunità", symbol: "O", color: "#984702" },
  privati: { label: "Radar privati", symbol: "P", color: "#08705b" },
  notizie: { label: "Notizie", symbol: "N", color: "#6639a0" },
};
const precisionLabels = {
  published: "Pin pubblicato dalla fonte",
  address: "Posizione associata all’indirizzo",
  building: "Posizione dell’edificio",
  street: "Punto indicativo lungo la via",
  area: "Posizione indicativa",
};
const prices = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const sources = { immobiliare: "Immobiliare.it", idealista: "Idealista", casa: "Casa.it", subito: "Subito", casadaprivato: "CasaDaPrivato" };

export function createNewsMap({ L, map, api, escape, feedback, openCivic }) {
  const $ = id => document.getElementById(id);
  const opener = $("territory-news"), dialog = $("territory-news-dialog"), status = $("territory-news-status");
  const submit = $("territory-news-apply");
  const outlines = L.layerGroup().addTo(map), markers = L.layerGroup().addTo(map);
  let areas = [];
  let settings = { outlines: new Set(), pins: new Set(), layers: new Set(Object.keys(layerInfo)) };
  let loaded = false;

  function applyMarkers(pins) {
    markers.clearLayers();
    const groups = new Map();
    for (const pin of pins) {
      if (!(pin.zoneIds ?? []).some(id => settings.pins.has(id))) continue;
      const enabledLayers = (pin.layers ?? ["notizie"]).filter(layer => settings.layers.has(layer));
      if (!enabledLayers.length) continue;
      const key = `${pin.latitude}|${pin.longitude}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...pin, enabledLayers });
    }
    for (const group of groups.values()) {
      const [first] = group;
      const allLayers = [...new Set(group.flatMap(pin => pin.enabledLayers))];
      const content = document.createElement("div");
      content.className = "territory-news-popup";
      for (const pin of group) {
        const article = document.createElement("article");
        const category = document.createElement("p");
        category.className = "territory-map-pin-categories";
        category.textContent = pin.enabledLayers.map(layer => layerInfo[layer].label).join(" · ");
        const heading = document.createElement("strong");
        heading.textContent = pin.title;
        const details = document.createElement("p");
        details.textContent = [
          pin.source ? sources[pin.source] ?? pin.source : null,
          pin.price != null ? prices.format(pin.price) : null,
          pin.civics.length ? `Civico ${pin.civics.join(", ")}` : pin.propertyId ? "Civico non disponibile" : null,
          precisionLabels[pin.precision],
        ].filter(Boolean).join(" · ");
        article.append(category, heading, details);
        if (pin.propertyId) {
          const link = document.createElement("button");
          link.textContent = "Apri scheda su Listing Radar";
          link.onclick = () => api.newsOpenProperty(pin.propertyId).catch(error => feedback(error.message, true));
          article.append(link);
        }
        for (const match of pin.matches ?? []) {
          if (!match.count || !pin.streetId) continue;
          const button = document.createElement("button");
          button.textContent = `Civico ${match.civic} · ${match.count} unità SISTER`;
          button.onclick = () => { map.closePopup(); Promise.resolve(openCivic(pin.streetId, match.civic)).catch(error => feedback(error.message, true)); };
          article.append(button);
        }
        content.append(article);
      }
      const chips = allLayers.map(layer => `<span style="background:${layerInfo[layer].color}">${layerInfo[layer].symbol}</span>`).join("");
      L.marker([first.latitude, first.longitude], {
        title: allLayers.map(layer => layerInfo[layer].label).join(", "),
        icon: L.divIcon({ className: "territory-map-pin", html: chips, iconSize: [38,24], iconAnchor: [19,12] }),
      }).bindPopup(content).addTo(markers);
    }
    return groups.size;
  }

  function render() {
    const checkbox = (key, id, label) => `<input type="checkbox" name="${key}" value="${escape(id)}" aria-label="${escape(label)}" ${settings[key].has(id) ? "checked" : ""}>`;
    $("territory-news-layers").innerHTML = Object.entries(layerInfo).map(([id, entry]) =>
      `<label>${checkbox("layers", id, entry.label)}<span style="color:${entry.color}">${entry.symbol}</span> ${entry.label}</label>`).join("");
    $("territory-news-zones").innerHTML = areas.length ? `<table><thead><tr><th scope="col">Zona</th><th scope="col">Evidenzia</th><th scope="col">Mostra pin</th></tr></thead><tbody>${areas.map(area =>
      `<tr><th scope="row">${escape(area.name)}</th><td>${checkbox("outlines", area.id, "Evidenzia " + area.name)}</td><td>${checkbox("pins", area.id, "Mostra pin in " + area.name)}</td></tr>`).join("")}</tbody></table>` : "";
  }

  opener.onclick = async () => {
    dialog.showModal();
    status.textContent = "Caricamento zone…";
    submit.disabled = true;
    try {
      const result = await api.newsAreas();
      if (!dialog.open) return;
      areas = result.areas;
      if (!loaded) {
        settings.pins = new Set(areas.filter(area => area.agentName?.toLowerCase() === "tony").map(area => area.id));
        loaded = true;
      }
      render();
      status.textContent = areas.length ? (result.stale ? "Zone dalla copia locale." : "") : "Nessuna zona salvata.";
      submit.disabled = false;
    } catch (error) { status.textContent = error.message; }
  };
  $("territory-news-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => opener.focus());
  $("territory-news-form").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = Object.fromEntries(Object.keys(settings).map(key => [key, new Set(form.getAll(key))]));
    submit.disabled = true;
    status.textContent = "Caricamento pin…";
    try {
      const pins = next.pins.size && next.layers.size ? await api.newsPins() : [];
      if (!dialog.open) return;
      settings = next;
      outlines.clearLayers();
      for (const area of areas) {
        if (!settings.outlines.has(area.id)) continue;
        L.geoJSON(area.geometry, { pane: "work-areas", interactive: false,
          style: { color: area.color, weight: 2, fillOpacity: 0.10 },
        }).addTo(outlines);
      }
      const count = applyMarkers(pins);
      if (settings.pins.size && settings.layers.size) feedback(count ? `${count} punti sulla mappa` : "Nessun pin per le zone e i livelli selezionati.");
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  };
}
