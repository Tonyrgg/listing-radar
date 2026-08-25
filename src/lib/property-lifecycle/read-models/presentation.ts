const EVENT_LABELS: Record<string, string> = {
  NEW_LISTING: "Nuovo annuncio",
  PROPERTY_DISCOVERED: "Proprietà rilevata",
  PUBLICATION_DISCOVERED: "Nuova pubblicazione",
  PUBLICATION_CONTENT_CHANGED: "Contenuto annuncio aggiornato",
  PRICE_DROP: "Riduzione di prezzo",
  PRICE_INCREASE: "Aumento di prezzo",
  PUBLICATION_MISSING_PENDING: "Assenza da verificare",
  PUBLICATION_REMOVED: "Uscita confermata",
  DISAPPEARED_CONFIRMED: "Uscita confermata",
  PUBLICATION_REAPPEARED: "Annuncio ricomparso",
  PRIVATE_PUBLICATION_REAPPEARED: "Privato ricomparso",
  PRIVATE_PUBLICATION_REMOVED: "Annuncio privato rimosso",
  SOURCE_MARKED_SOLD: "Segnale di vendita",
  AGENCY_SWITCH_DETECTED: "Possibile cambio agenzia",
  AGENCY_TO_PRIVATE: "Da agenzia a privato",
  PRIVATE_RELIST: "Pubblicazione privata simultanea",
  PRIVATE_RELIST_CONFLICT: "Conflitto sul privato",
  PUBLICATION_RELAUNCHED: "Rilancio commerciale",
  POST_EXIT_CLASSIFIED: "Esito post-uscita",
  PRICE_CHANGED: "Prezzo aggiornato",
  MANUAL_OVERRIDE_RECORDED: "Correzione registrata da una persona",
  PROPERTY_SALE_STATUS_OVERRIDDEN: "Stato di vendita corretto a mano",
  AGENCY_OUTCOME_OVERRIDDEN: "Esito dell'agenzia corretto a mano",
};

const PROPERTY_STATE_LABELS: Record<string, string> = {
  ACTIVE_AGENCY: "Attivo in agenzia",
  ACTIVE_PRIVATE: "Attivo da privato",
  ACTIVE_MULTI_AGENCY: "Attivo multi-agenzia",
  ACTIVE_AGENCY_AND_PRIVATE: "Agenzia e privato",
  OFF_MARKET_UNKNOWN: "Fuori mercato, esito ignoto",
  SOLD: "Venduto",
};

const AGENCY_STATE_LABELS: Record<string, string> = {
  ACTIVE: "Attivo",
  EXIT_PENDING: "Uscita da verificare",
  CLOSED_SOLD: "Chiuso: venduto",
  CLOSED_SWITCHED: "Chiuso: cambio agenzia",
  CLOSED_TO_PRIVATE: "Chiuso: passato a privato",
  CLOSED_WITHDRAWN: "Chiuso: ritirato",
  OFF_MARKET_NO_SALE_EVIDENCE: "Fuori mercato senza prova di vendita",
};

/**
 * `sale_status` finiva a schermo com'è scritto nel database: una pillola con
 * dentro «UNKNOWN». Vendere o non vendere è la domanda del mestiere; merita
 * parole che si leggono.
 */
const SALE_STATUS_LABELS: Record<string, string> = {
  UNKNOWN: "Non sappiamo se è stata venduta",
  PROBABLE_SOLD: "Probabilmente venduta",
  SOLD_CONFIRMED: "Venduta, confermato",
  NOT_SOLD_CONFIRMED: "Non venduta, confermato",
};

const REASON_LABELS: Record<string, string> = {
  agency_to_private_confirmed: "Passaggio da agenzia a privato confermato",
  agency_exit_confirmed: "Uscita dall'agenzia confermata",
  no_sale_evidence: "Nessuna prova sufficiente di vendita",
  no_new_agency_evidence: "Nessuna nuova agenzia rilevata",
  agency_switch_confirmed: "Cambio agenzia confermato",
  agency_exit_under_review: "Uscita in verifica",
  sold_confirmed: "Vendita confermata",
  no_current_opportunity_signal: "Nessun segnale commerciale attuale",
};

export function lifecycleEventLabel(value: string): string {
  return EVENT_LABELS[value] ?? humanize(value);
}

export function saleStatusLabel(value: string): string {
  return SALE_STATUS_LABELS[value] ?? humanize(value);
}

export function propertyStateLabel(value: string): string {
  return PROPERTY_STATE_LABELS[value] ?? humanize(value);
}

export function agencyListingStateLabel(value: string): string {
  return AGENCY_STATE_LABELS[value] ?? humanize(value);
}

export function opportunityReasonLabel(value: string): string {
  if (value.startsWith("price_drops:")) {
    return `Riduzioni di prezzo: ${value.split(":")[1]}`;
  }
  if (value.startsWith("relaunches:")) {
    return `Rilanci osservati: ${value.split(":")[1]}`;
  }
  if (value === "true_market_age_at_least_150_days") {
    return "Anzianità reale di mercato oltre 150 giorni";
  }
  return REASON_LABELS[value] ?? humanize(value);
}

export function confidenceLabel(value: number): string {
  if (value >= 0.9) return "Alta";
  if (value >= 0.65) return "Media";
  return "Bassa";
}

export function humanize(value: string): string {
  /* Le chiavi vere non sono solo MAIUSCOLE_CON_UNDERSCORE: ce ne sono di
   * puntate e in camelCase, e appiattirle dava «publication.sourcerecordcreatedat».
   * Qui si separano anche quelle, così l'ultima spiaggia resta leggibile. */
  const normalized = value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("it")
    .trim();

  return normalized.charAt(0).toLocaleUpperCase("it") + normalized.slice(1);
}

/* ---------------------------------------------------------------------------
 * Nessuna costante del database raggiunge lo schermo.
 * Se una stringa è in MAIUSCOLO_CON_UNDERSCORE, non è pronta per l'utente.
 * ------------------------------------------------------------------------- */

const OPPORTUNITY_LEVEL_LABELS: Record<string, string> = {
  ALL: "Tutte",
  HOT: "Da chiamare subito",
  HIGH: "Priorità alta",
  INTERESTING: "Da valutare",
  WATCH: "Da tenere d'occhio",
};

const REVIEW_TYPE_LABELS: Record<string, string> = {
  IDENTITY: "Stesso immobile?",
  GEOGRAPHY: "Posizione incerta",
  LIFECYCLE: "Stato incerto",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  OPEN: "Da aprire",
  IN_REVIEW: "In esame",
  RESOLVED: "Decisa",
  DISMISSED: "Archiviata",
};

const PUBLICATION_STATE_LABELS: Record<string, string> = {
  ACTIVE: "Ancora online",
  REMOVED: "Uscito dal mercato",
  PENDING: "Da verificare",
};

const IDENTITY_OUTCOME_LABELS: Record<string, string> = {
  MATCHED: "Collegato con certezza",
  REVIEW_REQUIRED: "Da confermare a mano",
  NEW_PROPERTY: "Proprietà nuova",
  NO_MATCH: "Nessun collegamento",
};

/* I valori sono quelli che il database contiene davvero: `EXACT`, `STREET` e
 * `ZONE` non sono mai esistiti, e la scheda finiva per scrivere «Street only». */
const PRECISION_LABELS: Record<string, string> = {
  EXACT_ADDRESS: "indirizzo esatto",
  STREET_ONLY: "solo la via, non il civico",
  APPROXIMATE_AREA: "zona approssimativa",
  UNKNOWN: "posizione ignota",
};

/**
 * Cosa dimostra una prova.
 *
 * Le chiavi vere sono puntate e in camelCase — `publication.originalMediaAvailableBy`
 * — e finivano a schermo appiattite in una parola sola. Qui ognuna dice cosa
 * afferma, non come si chiama.
 */
const CLAIM_KEY_LABELS: Record<string, string> = {
  "publication.location": "Dove si trova",
  "publication.status": "Cosa dichiara il sito",
  "publication.datePublished": "Quando l'annuncio è stato pubblicato",
  "publication.publishUp": "Quando l'annuncio è andato online",
  "publication.articlePublishedDate": "Data della pagina sul sito",
  "publication.sourceRecordCreatedAt": "Quando la scheda è nata sul sito",
  "publication.originalMediaAvailableBy": "Le foto esistevano già da",
  "publication.portalMediaAvailableBy": "Le foto sul portale esistevano già da",
  "publication.mediaUploadMonth": "Mese in cui le foto sono state caricate",
  "publication.photoBatchDate": "Data del gruppo di foto",
  "publication.firstObservedInCatalogAt": "Prima volta vista nel catalogo",
  "publication.firstObservedInInventoryAt": "Prima volta vista in inventario",
  "publication.firstPublicEvidenceAt": "Prima traccia pubblica trovata",
};

/**
 * Come lo sappiamo.
 *
 * Ogni sito lascia una traccia diversa: la data di una foto, una cartella di
 * caricamento, un campo del gestionale. Il nome tecnico serve al codice; a
 * schermo serve la frase che spiega perché ci crediamo.
 */
const METHOD_LABELS: Record<string, string> = {
  STRICT_PLACE_NAME_V1: "dal nome del posto scritto nell'annuncio",
  CRAWLER_FIRST_SEEN: "da quando l'abbiamo vista noi la prima volta",
  WORDPRESS_JSON_LD_DATE_PUBLISHED: "dalla data di pubblicazione dichiarata dal sito",
  AGESTA_ARTICLE_PUBLISHED_DATE: "dalla data della pagina sul sito dell'agenzia",
  ICONACASA_PUBLISH_UP: "dalla data di messa online dichiarata dal sito",
  FLAZIO_PROPERTY_CREATED_AT: "da quando la scheda è nata nel gestionale del sito",
  WORDPRESS_UPLOAD_PATH_YYYY_MM: "dalla cartella in cui il sito ha caricato le foto",
  MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS: "dalla data scritta nel nome del file della foto",
  FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED: "dalla data delle foto sul sito dell'agenzia",
  VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED: "dalla data delle foto sul sito dell'agenzia",
  GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED: "dalla data delle foto sul sito dell'agenzia",
  MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED: "dalla data delle foto sul sito dell'agenzia",
  FLAZIO_SOLD_FLAG: "dal segno di venduto messo dal sito",
  VISTOCASA_DEDICATED_SOLD_GRAPHIC: "dalla scritta «venduto» sulla foto",
  PUNTOCASA_DEDICATED_STATUS_TAXONOMY: "dalla categoria di stato usata dal sito",
};

export function opportunityLevelLabel(value: string): string {
  return OPPORTUNITY_LEVEL_LABELS[value] ?? humanize(value);
}

export function reviewTypeLabel(value: string): string {
  return REVIEW_TYPE_LABELS[value] ?? humanize(value);
}

export function reviewStatusLabel(value: string): string {
  return REVIEW_STATUS_LABELS[value] ?? humanize(value);
}

export function publicationStateLabel(value: string): string {
  return PUBLICATION_STATE_LABELS[value] ?? humanize(value);
}

export function identityOutcomeLabel(value: string): string {
  return IDENTITY_OUTCOME_LABELS[value] ?? humanize(value);
}

export function locationPrecisionLabel(value: string): string {
  return PRECISION_LABELS[value] ?? humanize(value);
}

export function claimKeyLabel(value: string): string {
  return CLAIM_KEY_LABELS[value] ?? humanize(value);
}

export function extractionMethodLabel(value: string): string {
  return METHOD_LABELS[value] ?? humanize(value).toLocaleLowerCase("it");
}
