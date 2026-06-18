import type { Listing, NormalizedListing } from "@/types";

export type ListingCompletenessField = {
  key: string;
  label: string;
  reason: string;
  severity: "required" | "recommended";
};

type CompletenessInput = Pick<
  Listing | NormalizedListing,
  | "title"
  | "description"
  | "price"
  | "sqm"
  | "rooms"
  | "zone"
  | "addressRaw"
  | "sellerType"
  | "sellerName"
  | "phone"
  | "imageUrls"
>;

const requiredFields: Array<{
  key: keyof CompletenessInput;
  label: string;
  reason: string;
  isMissing: (listing: CompletenessInput) => boolean;
}> = [
  {
    key: "title",
    label: "Titolo",
    reason:
      "Il titolo e vuoto o non acquisito. Serve per riconoscere subito la scheda in archivio.",
    isMissing: (listing) => !hasText(listing.title),
  },
  {
    key: "price",
    label: "Prezzo",
    reason:
      "Il prezzo e assente o non acquisito. Serve per confrontare valore, prezzo al mq e ribassi.",
    isMissing: (listing) => listing.price == null,
  },
  {
    key: "sqm",
    label: "Superficie",
    reason:
      "La superficie e assente. Serve per calcolare il prezzo al mq e confrontare immobili simili.",
    isMissing: (listing) => listing.sqm == null,
  },
  {
    key: "rooms",
    label: "Locali",
    reason:
      "Il numero di locali e assente. Serve per confrontare correttamente taglio e distribuzione.",
    isMissing: (listing) => listing.rooms == null,
  },
  {
    key: "zone",
    label: "Zona",
    reason:
      "La zona e vuota o non acquisita. Serve per localizzare l'immobile e raggruppare annunci vicini.",
    isMissing: (listing) => !hasText(listing.zone),
  },
  {
    key: "description",
    label: "Descrizione",
    reason:
      "La descrizione e assente o troppo breve. Serve per valutare condizioni, lavori e segnali operativi.",
    isMissing: (listing) => !hasText(listing.description, 80),
  },
];

const recommendedFields: Array<{
  key: keyof CompletenessInput;
  label: string;
  reason: string;
  isMissing: (listing: CompletenessInput) => boolean;
}> = [
  {
    key: "imageUrls",
    label: "Fotografie",
    reason:
      "Non ci sono foto acquisite. Le immagini aiutano a verificare stato, qualita e coerenza dell'annuncio.",
    isMissing: (listing) => !listing.imageUrls?.length,
  },
  {
    key: "sellerType",
    label: "Tipo venditore",
    reason:
      "Il venditore e ancora da verificare. Incide sulla priorita e sul flusso di controllo.",
    isMissing: (listing) => listing.sellerType === "unknown",
  },
  {
    key: "sellerName",
    label: "Nome venditore",
    reason:
      "Il nome venditore e vuoto o non acquisito. Aiuta a riconoscere duplicati e contatti gia trattati.",
    isMissing: (listing) => !hasText(listing.sellerName),
  },
  {
    key: "addressRaw",
    label: "Indirizzo",
    reason:
      "L'indirizzo rilevato e vuoto. Serve per localizzare meglio l'immobile e riconoscere possibili duplicati.",
    isMissing: (listing) => !hasText(listing.addressRaw),
  },
  {
    key: "phone",
    label: "Telefono",
    reason:
      "Il recapito e vuoto o non acquisito. Serve per capire se il venditore e contattabile senza passaggi aggiuntivi.",
    isMissing: (listing) => !hasText(listing.phone),
  },
];

function hasText(value: string | null | undefined, minimumLength = 1) {
  return typeof value === "string" && value.trim().length >= minimumLength;
}

export function getMissingListingFields(
  listing: CompletenessInput,
): ListingCompletenessField[] {
  return [
    ...requiredFields
      .filter((field) => field.isMissing(listing))
      .map((field) => ({
        key: String(field.key),
        label: field.label,
        reason: field.reason,
        severity: "required" as const,
      })),
    ...recommendedFields
      .filter((field) => field.isMissing(listing))
      .map((field) => ({
        key: String(field.key),
        label: field.label,
        reason: field.reason,
        severity: "recommended" as const,
      })),
  ];
}

export function getListingCompletenessScore(listing: CompletenessInput) {
  const totalWeight = requiredFields.length * 2 + recommendedFields.length;
  const missingWeight = getMissingListingFields(listing).reduce(
    (sum, field) => sum + (field.severity === "required" ? 2 : 1),
    0,
  );

  return Math.max(0, Math.round(((totalWeight - missingWeight) / totalWeight) * 100));
}

export function hasRequiredListingGaps(listing: CompletenessInput) {
  return getMissingListingFields(listing).some(
    (field) => field.severity === "required",
  );
}
