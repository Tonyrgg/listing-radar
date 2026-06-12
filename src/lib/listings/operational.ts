import type { Listing } from "@/types";

export function getOperationalSuggestion(listing: Pick<
  Listing,
  "sellerType" | "minimumDaysOnline" | "isPriceDropped" | "priorityScore"
>) {
  if (listing.sellerType === "private" && listing.minimumDaysOnline <= 7) {
    return "Privato fresco: verificare subito coerenza foto, prezzo e recapito. Se i dati reggono, conviene procedere rapidamente con un contatto manuale.";
  }

  if (listing.isPriceDropped) {
    return "Ribasso rilevato: verificare il nuovo posizionamento e preparare una chiamata manuale orientata alla flessibilità sul prezzo.";
  }

  if (listing.sellerType === "private" && listing.minimumDaysOnline >= 60) {
    return "Privato datato: probabile stanchezza del venditore. Valutare ricontrollo dell'annuncio e contatto manuale con proposta ben calibrata.";
  }

  if (listing.sellerType === "agency" && listing.minimumDaysOnline >= 60) {
    return "Agenzia con incarico maturo: utile per leggere il mercato locale e capire se si sta aprendo una finestra negoziale.";
  }

  return "Monitorare nuovi segnali su tempi online, ribassi e modifiche testuali prima di pianificare il prossimo passaggio manuale.";
}
