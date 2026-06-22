const DEFAULT_BASE_URL = "https://listing-radar-mu.vercel.app";

const state = { config: null, listing: null, detailUrl: null };
const elements = {
  connection: document.querySelector("#connection"),
  editConnection: document.querySelector("#edit-connection"),
  baseUrl: document.querySelector("#base-url"),
  token: document.querySelector("#api-token"),
  autoImport: document.querySelector("#auto-import"),
  saveConnection: document.querySelector("#save-connection"),
  preview: document.querySelector("#preview"),
  source: document.querySelector("#source"),
  fieldCount: document.querySelector("#field-count"),
  title: document.querySelector("#title"),
  facts: document.querySelector("#facts"),
  missingFields: document.querySelector("#missing-fields"),
  missingList: document.querySelector("#missing-list"),
  importListing: document.querySelector("#import-listing"),
  result: document.querySelector("#result"),
  resultMessage: document.querySelector("#result-message"),
  openListing: document.querySelector("#open-listing"),
  status: document.querySelector("#status"),
};

function setStatus(message) {
  elements.status.textContent = message;
}

function setButtonPending(element, pending, label) {
  if (!element) return;
  element.dataset.idleText ||= element.textContent;
  element.disabled = pending;
  element.classList.toggle("is-loading", pending);
  element.textContent = pending ? label : element.dataset.idleText;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function renderPreview(listing) {
  state.listing = listing;
  const facts = [
    listing.price ? `${Number(listing.price).toLocaleString("it-IT")} EUR` : null,
    listing.sqm ? `${listing.sqm} mq` : null,
    listing.rooms ? `${listing.rooms} locali` : null,
    listing.zone,
    listing.imageUrls?.length ? `${listing.imageUrls.length} foto` : null,
  ].filter(Boolean);
  const fields = Object.values(listing).filter(
    (value) => value !== null && value !== "" && value !== undefined,
  ).length;
  const required = [
    ["title", "Titolo"],
    ["price", "Prezzo"],
    ["sqm", "Superficie"],
    ["rooms", "Locali"],
    ["zone", "Zona"],
    ["description", "Descrizione"],
    ["sellerType", "Tipo venditore"],
    ["imageUrls", "Fotografie"],
  ];
  const missing = required.filter(([key]) => {
    const value = listing[key];
    return value == null || value === "" || value === "unknown" ||
      (Array.isArray(value) && value.length === 0);
  });
  const completeness = Math.max(
    0,
    Math.round(((required.length - missing.length) / required.length) * 100),
  );

  elements.source.textContent = listing.source || "browser";
  elements.fieldCount.textContent = `${fields} campi - ${completeness}%`;
  elements.title.textContent = listing.title || "Titolo non rilevato";
  elements.facts.textContent = facts.join(" | ") || "Dati principali non rilevati";
  elements.missingList.replaceChildren(
    ...missing.map(([, label]) => {
      const item = document.createElement("li");
      item.textContent = label;
      return item;
    }),
  );
  elements.missingFields.classList.toggle("hidden", missing.length === 0);
  elements.preview.classList.remove("hidden");
  setStatus("");
}

async function requestOriginPermission(baseUrl) {
  const origin = `${new URL(baseUrl).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function saveConnection() {
  setButtonPending(elements.saveConnection, true, "Salvataggio...");
  try {
    const baseUrl = normalizeBaseUrl(elements.baseUrl.value.trim());
    const token = elements.token.value.trim();
    if (!token) throw new Error("Inserisci il token dell'estensione.");
    if (!(await requestOriginPermission(baseUrl))) {
      throw new Error("Permesso di connessione non concesso.");
    }
    state.config = { baseUrl, token, autoImport: elements.autoImport.checked };
    await chrome.storage.local.set({ listingRadarConfig: state.config });
    elements.connection.classList.add("hidden");
    elements.editConnection.classList.remove("hidden");
    setStatus("Connessione salvata.");
    await extractCurrentPage();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setButtonPending(elements.saveConnection, false, "");
  }
}

async function extractCurrentPage() {
  setStatus("Analisi pagina...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    setStatus("Apri una pagina annuncio in una scheda web.");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "parsers/generic.js",
        "parsers/shared.js",
        "parsers/idealista.js",
        "parsers/immobiliare.js",
        "parsers/subito.js",
        "parsers/casa.js",
        "parsers/wikicasa.js",
        "parsers/casadaprivato.js",
        "parsers/portals.js",
        "content.js",
      ],
    });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "LISTING_RADAR_EXTRACT",
    });
    if (!response?.ok) throw new Error(response?.error || "Estrazione non riuscita.");
    renderPreview(response.data);
    if (state.config?.autoImport && response.data.incomingId) {
      await importListing();
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function importListing() {
  if (!state.config || !state.listing) return;
  setButtonPending(elements.importListing, true, "Importazione...");
  setStatus("Importazione...");
  try {
    if (!state.listing.title) {
      throw new Error("Inserisci un titolo prima di importare.");
    }
    const response = await fetch(`${state.config.baseUrl}/api/import/browser`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state.listing),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Errore ${response.status}`);
    }
    state.detailUrl = `${state.config.baseUrl}${payload.detailUrl}`;
    const missingLabels = Array.isArray(payload.missingFields)
      ? payload.missingFields.map((field) => field.label).filter(Boolean)
      : [];
    elements.resultMessage.textContent = payload.inserted
      ? missingLabels.length
        ? `Annuncio creato. Da completare: ${missingLabels.join(", ")}.`
        : "Annuncio creato e completo."
      : missingLabels.length
        ? `Annuncio aggiornato. Da completare: ${missingLabels.join(", ")}.`
        : "Annuncio aggiornato e completo.";
    elements.result.classList.remove("hidden");
    elements.openListing.classList.remove("hidden");
    elements.preview.classList.add("hidden");
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setButtonPending(elements.importListing, false, "");
  }
}

async function openListing() {
  if (!state.detailUrl) return;
  setButtonPending(elements.openListing, true, "Apertura...");
  try {
    await chrome.tabs.create({ url: state.detailUrl });
  } finally {
    setButtonPending(elements.openListing, false, "");
  }
}

async function initialize() {
  const stored = await chrome.storage.local.get("listingRadarConfig");
  state.config = stored.listingRadarConfig || null;
  if (!state.config) {
    elements.baseUrl.value = DEFAULT_BASE_URL;
    setStatus("Configura la connessione.");
    return;
  }
  elements.baseUrl.value = state.config.baseUrl;
  elements.token.value = state.config.token;
  elements.autoImport.checked = Boolean(state.config.autoImport);
  elements.connection.classList.add("hidden");
  elements.editConnection.classList.remove("hidden");
  await extractCurrentPage();
}

elements.saveConnection.addEventListener("click", saveConnection);
elements.editConnection.addEventListener("click", () =>
  elements.connection.classList.toggle("hidden"),
);
elements.importListing.addEventListener("click", importListing);
elements.openListing.addEventListener("click", openListing);
initialize();
