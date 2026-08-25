import type { SellerType } from "@/types";

/**
 * Cosa accettiamo dai portali.
 *
 * Property Lifecycle legge le agenzie dai loro stessi siti, con timeline, prove
 * ed età reale di mercato. Quello che i portali possono aggiungere è una cosa
 * sola: i privati. Sui dati del 25 agosto 2026 i portali portavano dentro 254
 * annunci di agenzia e un solo privato — tutto lavoro doppio.
 *
 * La regola NON è «accetta solo i privati»: il riconoscimento è forte sulle
 * agenzie e debole sui privati, che quasi mai si dichiarano tali. Su 258
 * annunci da portale, 254 erano riconosciuti come agenzia e 3 restavano
 * incerti. Quindi si scarta ciò che è certamente un'agenzia e si tiene tutto
 * il resto: un privato non riconosciuto entra lo stesso, un'agenzia
 * riconosciuta no.
 */

/** Le fonti che pubblicano annunci di chiunque, agenzie comprese. */
const PORTALI = new Set([
  "immobiliare",
  "idealista",
  "casa",
  "wikicasa",
  "subito",
  "casadaprivato",
  "import",
  "feed",
]);

export function isPortalSource(source: string): boolean {
  return PORTALI.has(source.trim().toLowerCase());
}

export type PortalIntakeDecision =
  | { accepted: true }
  | { accepted: false; reason: string };

export function decidePortalIntake(input: {
  source: string;
  sellerType: SellerType | null | undefined;
  sellerName?: string | null;
}): PortalIntakeDecision {
  if (!isPortalSource(input.source)) {
    return { accepted: true };
  }

  if (input.sellerType !== "agency") {
    return { accepted: true };
  }

  return {
    accepted: false,
    reason: input.sellerName
      ? `Questo annuncio è di ${input.sellerName}. Le agenzie le seguiamo già dai loro siti: dai portali servono solo i privati.`
      : "Questo annuncio è di un'agenzia. Le agenzie le seguiamo già dai loro siti: dai portali servono solo i privati.",
  };
}
