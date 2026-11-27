type Facts = {
  classification?: string | null; saleStatus?: string | null; priceConflict?: boolean;
  precision?: string | null; civic?: string | null; hasAgency: boolean;
  agencyStart?: string | null; verifiedPosition?: boolean; privateSellerUnknown?: boolean;
};

export function nextPropertyCheck(f: Facts) {
  if (f.saleStatus === "SOLD_CONFIRMED" || (f.classification === "SOLD_CONFIRMED" && f.saleStatus !== "NOT_SOLD_CONFIRMED"))
    return { label: "Consulta la vendita", detail: "La vendita risulta confermata. Nello storico trovi la data e le prove disponibili.", target: "storico" };
  if (["MISSING_UNCONFIRMED","UNKNOWN_EXIT","EXPIRED_POSSIBLE","SOLD_PROBABLE"].includes(f.classification ?? ""))
    return { label: "Verifica l’esito", detail: "Confronta l’ultima presenza con le pubblicazioni successive. Se hai una conferma, registrala in Correzione dati.", target: "storico" };
  if (f.classification === "WITHDRAWN" || f.saleStatus === "NOT_SOLD_CONFIRMED")
    return { label: "Rileggi l’esito registrato", detail: "Nello storico trovi l’ultimo esito e puoi controllare se è intervenuta una nuova pubblicazione.", target: "storico" };
  if (f.classification === "AGENCY_CHANGED" || f.classification === "RELISTED")
    return { label: "Confronta le pubblicazioni", detail: "Controlla chi pubblica oggi l’immobile e quale annuncio lo precedeva.", target: "pubblicazioni" };
  if (f.priceConflict) return { label: "Confronta i prezzi", detail: "Le fonti riportano importi diversi. Controlla il prezzo e la data di ciascuna pubblicazione.", target: "pubblicazioni" };
  if (f.privateSellerUnknown) return { label: "Identifica il venditore", detail: "Apri la pubblicazione e verifica come si presenta l’inserzionista.", target: "pubblicazioni" };
  if (!f.civic?.trim() || (!f.verifiedPosition && !["EXACT_ADDRESS","EXACT_COORDINATES"].includes(f.precision ?? "")))
    return { label: f.civic ? "Verifica la posizione" : "Individua il civico", detail: "Confronta indirizzo, descrizione e mappa della fonte. Un pin da solo non conferma il portone.", target: "pubblicazioni" };
  if (f.hasAgency && !f.agencyStart) return { label: "Verifica la data in agenzia", detail: "Cerca la prima pubblicazione datata della stessa agenzia. Per datare l’incarico serve una conferma specifica.", target: "pubblicazioni" };
  return { label: "Consulta lo storico", detail: "Rileggi le variazioni di prezzo, le pubblicazioni e gli esiti in ordine di data.", target: "storico" };
}
