import type { Listing } from "@/types";

export function getOperationalSuggestion(listing: Pick<
  Listing,
  "sellerType" | "minimumDaysOnline" | "isPriceDropped" | "priorityScore"
>) {
  if (listing.sellerType === "private" && listing.minimumDaysOnline <= 7) {
    return "L'annuncio è recente e sembra pubblicato da un privato. Controlla prezzo, foto e recapito prima di decidere il prossimo passo.";
  }

  if (listing.isPriceDropped) {
    return "Il prezzo è sceso. Controlla il nuovo valore e valuta se il venditore potrebbe essere più disponibile a trattare.";
  }

  if (listing.sellerType === "private" && listing.minimumDaysOnline >= 60) {
    return "L'annuncio di un privato è online da molto tempo. Potrebbe esserci più disponibilità a trattare.";
  }

  if (listing.sellerType === "agency" && listing.minimumDaysOnline >= 60) {
    return "L'annuncio dell'agenzia è online da molto tempo. Controlla se prezzo o condizioni sono cambiati.";
  }

  return "La scheda è completa. Controlla i dati principali e tieni l'annuncio sotto osservazione.";
}

export function getListingAttentionReason(listing: Pick<
  Listing,
  "sellerType" | "minimumDaysOnline" | "isPriceDropped" | "isNewToday" | "phone"
>) {
  if (listing.isPriceDropped) {
    return "Il prezzo è sceso";
  }

  if (listing.sellerType === "private") {
    return "Sembra pubblicato da un privato";
  }

  if (listing.minimumDaysOnline >= 60) {
    return `Online da almeno ${listing.minimumDaysOnline} giorni`;
  }

  if (listing.isNewToday) {
    return "Pubblicato oggi";
  }

  if (listing.phone) {
    return "Recapito disponibile";
  }

  return "Scheda completa";
}
