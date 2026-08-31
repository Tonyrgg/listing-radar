import type { PropertyRequest } from "./types";

/**
 * Che cosa cerca davvero il cliente, quando il campo strutturato tace.
 *
 * Nel gestionale la tipologia sta in due campi: «Tipologia Immobile», che il
 * worker traduce in `property_types`, e «Sottotipologia Immobile», che e' la
 * dizione precisa — «Villa singola», non «Villa». Il secondo e' quello che
 * l'agente compila davvero, ed e' anche quello che la scheda mostra.
 *
 * Quando il primo resta vuoto, `property_types` arriva come lista vuota e il
 * punteggio della tipologia diventa pieno per chiunque: a chi cerca una villa
 * si proponevano appartamenti, con la spunta «tipologia» a certificarlo. La
 * sottotipologia c'era, scritta nella stessa scheda, e nessuno la leggeva.
 *
 * Qui si legge. Non e' un'inferenza sul testo libero: e' un campo del CRM con
 * un vocabolario chiuso, tradotto nelle stesse chiavi del campo strutturato.
 */

/**
 * L'ordine conta: «villetta a schiera» contiene «villett», e chi cerca una
 * schiera non cerca una villa. Le voci piu' specifiche vanno lette per prime.
 */
const SUBTYPE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/schiera|bifamiliar|trifamiliar/, "townhouse"],
  [/villa|villett/, "villa"],
  [/attico|mansard/, "penthouse"],
  [/piano\s*terra/, "ground_floor"],
  [/indipendent|singol[ao]\b|casa\s*singola/, "independent_house"],
  [/appartament|bilocal|trilocal|quadrilocal|monolocal/, "apartment"],
  [/negozio|commercial|local[ei]\s*commercial/, "commercial_space"],
  [/ufficio|studio\s*professional/, "office"],
  [/deposito|magazzin|capannon|laboratorio/, "warehouse"],
  [/palazz|stabile|intero\s*edificio/, "entire_building"],
  [/box|garage|autorimess|posto\s*auto/, "garage"],
  [/terren|suolo|lotto/, "land"],
];

/** Traduce una dizione del gestionale nella chiave di tipologia corrispondente. */
export function propertyTypeFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("it");
  if (!normalized) return null;
  for (const [pattern, key] of SUBTYPE_PATTERNS) {
    if (pattern.test(normalized)) return key;
  }
  return null;
}

function crmSubtype(request: PropertyRequest) {
  const payload = request.raw_payload;
  if (!payload || typeof payload !== "object") return null;
  const value = payload.fields?.["Sottotipologia Immobile"]
    ?? payload.headerFields?.["Sottotipologia Immobile"];
  return propertyTypeFromText(value);
}

/**
 * Le tipologie su cui il match va giudicato.
 *
 * Il campo strutturato vince quando c'e': e' quello che l'operatore puo'
 * correggere dall'interfaccia. La sottotipologia interviene solo a colmare il
 * vuoto, mai a contraddire una scelta esplicita.
 */
export function resolveRequestPropertyTypes(request: PropertyRequest): string[] {
  const declared = (request.property_types ?? []).filter((value) => typeof value === "string" && value.trim());
  if (declared.length) return declared;
  const fromSubtype = crmSubtype(request);
  return fromSubtype ? [fromSubtype] : [];
}
