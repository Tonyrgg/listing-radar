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
  const normalized = value.replaceAll("_", " ").toLocaleLowerCase("it");
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

const PRECISION_LABELS: Record<string, string> = {
  EXACT: "Posizione esatta",
  STREET: "Via individuata",
  ZONE: "Solo la zona",
  MUNICIPALITY: "Solo il comune",
  UNKNOWN: "Posizione ignota",
};

const CLAIM_KEY_LABELS: Record<string, string> = {
  price: "Prezzo",
  surface_sqm: "Superficie",
  rooms: "Locali",
  floor: "Piano",
  address: "Indirizzo",
  seller_type: "Tipo di venditore",
  energy_class: "Classe energetica",
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
