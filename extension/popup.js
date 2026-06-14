const state = {
  config: null,
  listing: null,
  detailUrl: null,
};

const elements = {
  connection: document.querySelector("#connection"),
  editConnection: document.querySelector("#edit-connection"),
  baseUrl: document.querySelector("#base-url"),
  token: document.querySelector("#api-token"),
  saveConnection: document.querySelector("#save-connection"),
  preview: document.querySelector("#preview"),
  source: document.querySelector("#source"),
  fieldCount: document.querySelector("#field-count"),
  title: document.querySelector("#title"),
  facts: document.querySelector("#facts"),
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

function renderPreview(listing) {
  state.listing = listing;
  const facts = [
    listing.price ? `${Number(listing.price).toLocaleString("it-IT")} €` : null,
    listing.sqm ? `${listing.sqm} mq` : null,
    listing.rooms ? `${listing.rooms} locali` : null,
    listing.zone,
    listing.imageUrls?.length ? `${listing.imageUrls.length} foto` : null,
  ].filter(Boolean);
  const fields = Object.values(listing).filter(
    (value) => value !== null && value !== "" && value !== undefined,
  ).length;

  elements.source.textContent = listing.source || "browser";
  elements.fieldCount.textContent = `${fields} campi`;
  elements.title.textContent = listing.title || "Titolo non rilevato";
  elements.facts.textContent = facts.join(" · ") || "Dati principali non rilevati";
  elements.preview.classList.remove("hidden");
  setStatus("");
}

async function requestOriginPermission(baseUrl) {
  const origin = `${new URL(baseUrl).origin}/*`;
  const alreadyGranted = await chrome.permissions.contains({ origins: [origin] });

  if (alreadyGranted) {
    return true;
  }

  return chrome.permissions.request({ origins: [origin] });
}

async function saveConnection() {
  try {
    const baseUrl = normalizeBaseUrl(elements.baseUrl.value.trim());
    const token = elements.token.value.trim();

    if (!token) {
      throw new Error("Inserisci il token dell'estensione.");
    }

    const granted = await requestOriginPermission(baseUrl);

    if (!granted) {
      throw new Error("Permesso di connessione non concesso.");
    }

    state.config = { baseUrl, token };
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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

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

    if (!response?.ok) {
      throw new Error(response?.error || "Estrazione non riuscita.");
    }

    renderPreview(response.data);
  } catch (error) {
    setStatus(error.message);
  }
}

async function importListing() {
  if (!state.config || !state.listing) {
    return;
  }

  elements.importListing.disabled = true;
  setStatus("Importazione...");

  try {
    const response = await fetch(
      `${state.config.baseUrl}/api/import/browser`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(state.listing),
      },
    );
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
  if (state.detailUrl) {
    await chrome.tabs.create({ url: state.detailUrl });
  }
}

function editConnection() {
  elements.connection.classList.toggle("hidden");
}

async function initialize() {
  const stored = await chrome.storage.local.get("listingRadarConfig");
  state.config = stored.listingRadarConfig || null;

  if (!state.config) {
    elements.baseUrl.value = "http://localhost:3000";
    setStatus("Configura la connessione.");
    return;
  }

  elements.baseUrl.value = state.config.baseUrl;
  elements.token.value = state.config.token;
  elements.connection.classList.add("hidden");
  elements.editConnection.classList.remove("hidden");
  await extractCurrentPage();
}

elements.saveConnection.addEventListener("click", saveConnection);
elements.editConnection.addEventListener("click", editConnection);
elements.importListing.addEventListener("click", importListing);
elements.openListing.addEventListener("click", openListing);

initialize();
