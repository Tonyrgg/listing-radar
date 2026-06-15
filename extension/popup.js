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
  editFields: document.querySelector("#edit-fields"),
  editTitle: document.querySelector("#edit-title"),
  editPrice: document.querySelector("#edit-price"),
  editSqm: document.querySelector("#edit-sqm"),
  editRooms: document.querySelector("#edit-rooms"),
  editFloor: document.querySelector("#edit-floor"),
  editZone: document.querySelector("#edit-zone"),
  editAddress: document.querySelector("#edit-address"),
  editSellerType: document.querySelector("#edit-seller-type"),
  editSellerName: document.querySelector("#edit-seller-name"),
  editDescription: document.querySelector("#edit-description"),
  editImages: document.querySelector("#edit-images"),
  importListing: document.querySelector("#import-listing"),
  result: document.querySelector("#result"),
  resultMessage: document.querySelector("#result-message"),
  openListing: document.querySelector("#open-listing"),
  status: document.querySelector("#status"),
};

function setStatus(message) {
  elements.status.textContent = message;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function numberOrNull(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function imageLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setInputValue(element, value) {
  element.value = value == null ? "" : String(value);
}

function renderEditor(listing) {
  setInputValue(elements.editTitle, listing.title);
  setInputValue(elements.editPrice, listing.price);
  setInputValue(elements.editSqm, listing.sqm);
  setInputValue(elements.editRooms, listing.rooms);
  setInputValue(elements.editFloor, listing.floor);
  setInputValue(elements.editZone, listing.zone);
  setInputValue(elements.editAddress, listing.addressRaw);
  elements.editSellerType.value = listing.sellerType || "unknown";
  setInputValue(elements.editSellerName, listing.sellerName);
  setInputValue(elements.editDescription, listing.description);
  elements.editImages.value = (listing.imageUrls || []).join("\n");
}

function readEditorListing() {
  return {
    ...state.listing,
    title: textOrNull(elements.editTitle.value),
    price: numberOrNull(elements.editPrice.value),
    sqm: numberOrNull(elements.editSqm.value),
    rooms: numberOrNull(elements.editRooms.value),
    floor: textOrNull(elements.editFloor.value),
    zone: textOrNull(elements.editZone.value),
    addressRaw: textOrNull(elements.editAddress.value),
    sellerType: elements.editSellerType.value || "unknown",
    sellerName: textOrNull(elements.editSellerName.value),
    description: textOrNull(elements.editDescription.value),
    imageUrls: imageLines(elements.editImages.value),
  };
}

function renderQuality(listing) {
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

  elements.source.textContent = listing.source || "browser";
  elements.fieldCount.textContent = `${fields} campi`;
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
}

function renderPreview(listing) {
  state.listing = listing;
  renderQuality(listing);
  renderEditor(listing);
  elements.preview.classList.remove("hidden");
  setStatus("");
}

async function requestOriginPermission(baseUrl) {
  const origin = `${new URL(baseUrl).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function saveConnection() {
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
  elements.importListing.disabled = true;
  setStatus("Importazione...");
  try {
    state.listing = readEditorListing();
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
    elements.resultMessage.textContent = payload.inserted
      ? "Annuncio creato."
      : "Annuncio aggiornato.";
    elements.result.classList.remove("hidden");
    elements.openListing.classList.remove("hidden");
    elements.preview.classList.add("hidden");
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.importListing.disabled = false;
  }
}

async function openListing() {
  if (state.detailUrl) await chrome.tabs.create({ url: state.detailUrl });
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
elements.editFields.addEventListener("input", () => {
  if (!state.listing) return;
  state.listing = readEditorListing();
  renderQuality(state.listing);
});
initialize();
