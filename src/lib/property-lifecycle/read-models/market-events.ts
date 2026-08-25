/**
 * Quali eventi sono un movimento di mercato.
 *
 * L'archivio ne conserva di due nature. Alcuni raccontano che il mercato si è
 * mosso: un prezzo che scende, un annuncio che sparisce, una casa che torna in
 * mano al proprietario. Altri raccontano che il programma ha fatto il suo giro:
 * `PROPERTY_DISCOVERED` e `PUBLICATION_DISCOVERED` sono nati 457 volte ciascuno
 * il giorno del primo censimento.
 *
 * Senza questa distinzione le ultime sedici righe erano sedici righe di
 * censimento, e i quattro ribassi di prezzo veri non arrivavano mai a schermo.
 */
export const MARKET_EVENT_TYPES = [
  "PRICE_DROP",
  "PRICE_INCREASE",
  "PRICE_CHANGED",
  "AGENCY_TO_PRIVATE",
  "AGENCY_SWITCH_DETECTED",
  "PUBLICATION_REMOVED",
  "DISAPPEARED_CONFIRMED",
  "PUBLICATION_REAPPEARED",
  "PRIVATE_PUBLICATION_REAPPEARED",
  "PRIVATE_PUBLICATION_REMOVED",
  "PRIVATE_RELIST",
  "PRIVATE_RELIST_CONFLICT",
  "SOURCE_MARKED_SOLD",
  "PUBLICATION_RELAUNCHED",
  "POST_EXIT_CLASSIFIED",
  "NEW_LISTING",
  /* Una correzione fatta a mano è un movimento come gli altri: qualcuno ha
   * scoperto qualcosa che il programma non sapeva. */
  "MANUAL_OVERRIDE_RECORDED",
] as const;

const MARKET_EVENTS = new Set<string>(MARKET_EVENT_TYPES);

export function isMarketMove(eventType: string): boolean {
  return MARKET_EVENTS.has(eventType);
}
