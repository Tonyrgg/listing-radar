import type { Listing, NormalizedListing, SellerType } from "@/types";

const DAY = 24 * 60 * 60 * 1000;

export const HIGH_PRIORITY_THRESHOLD = 80;

export interface PriorityScoreFactor {
  id: string;
  label: string;
  explanation: string;
  points: number;
  active: boolean;
}

export interface PriorityScoreBreakdown {
  total: number;
  awarded: PriorityScoreFactor[];
  deductions: PriorityScoreFactor[];
  notAwarded: PriorityScoreFactor[];
}

type PriorityScoreInput = {
  sellerType: SellerType;
  isNewToday: boolean;
  hasPhone: boolean;
  minimumDaysOnline: number;
  isPriceDropped: boolean;
  description?: string | null;
};

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calculatePricePerSqm(
  price: number | null | undefined,
  sqm: number | null | undefined,
) {
  if (!price || !sqm) {
    return null;
  }

  return Math.round(price / sqm);
}

export function getMinimumDaysOnline(input: {
  firstSeenAt?: string | null;
  portalDeclaredDate?: string | null;
  metadataDatePublished?: string | null;
}) {
  const candidates = [
    parseDate(input.firstSeenAt),
    parseDate(input.portalDeclaredDate),
    parseDate(input.metadataDatePublished),
  ].filter((value): value is Date => value instanceof Date);

  if (!candidates.length) {
    return 0;
  }

  const oldestDate = candidates.reduce((oldest, current) =>
    current.getTime() < oldest.getTime() ? current : oldest,
  );

  return Math.max(0, Math.floor((Date.now() - oldestDate.getTime()) / DAY));
}

export function isToday(value: string | null | undefined) {
  const date = parseDate(value);

  if (!date) {
    return false;
  }

  const now = new Date();
  return date.toDateString() === now.toDateString();
}

export function getPriorityScoreBreakdown(
  input: PriorityScoreInput,
): PriorityScoreBreakdown {
  const description = (input.description ?? "").toLowerCase();
  const onlinePoints =
    input.minimumDaysOnline >= 120
      ? 35
      : input.minimumDaysOnline >= 60
        ? 20
        : 0;
  const factors: PriorityScoreFactor[] = [
    {
      id: "private-seller",
      label: "Venditore privato",
      explanation: "Il contatto sembra diretto, senza agenzia.",
      points: 40,
      active: input.sellerType === "private",
    },
    {
      id: "new-today",
      label: "Nuovo arrivo",
      explanation: "L'annuncio e stato rilevato oggi.",
      points: 25,
      active: input.isNewToday,
    },
    {
      id: "phone-visible",
      label: "Telefono disponibile",
      explanation: "E presente un recapito utilizzabile.",
      points: 20,
      active: input.hasPhone,
    },
    {
      id: "days-online",
      label:
        input.minimumDaysOnline >= 120
          ? "Online da almeno 120 giorni"
          : "Online da almeno 60 giorni",
      explanation:
        onlinePoints > 0
          ? "La permanenza prolungata puo indicare maggiore apertura alla trattativa."
          : "Servono almeno 60 giorni online per ottenere questo punteggio.",
      points: onlinePoints || 20,
      active: onlinePoints > 0,
    },
    {
      id: "price-drop",
      label: "Prezzo ridotto",
      explanation: "Il prezzo attuale e inferiore a una rilevazione precedente.",
      points: 20,
      active: input.isPriceDropped,
    },
    {
      id: "negotiable-price",
      label: "Prezzo trattabile",
      explanation: "La descrizione dichiara esplicitamente una trattativa possibile.",
      points: 10,
      active: description.includes("prezzo trattabile"),
    },
    {
      id: "no-agencies",
      label: "Nessuna agenzia richiesta",
      explanation: "La descrizione contiene l'indicazione no agenzie.",
      points: 10,
      active: description.includes("no agenzie"),
    },
    {
      id: "seller-to-verify",
      label: "Venditore da verificare",
      explanation: "Il tipo di venditore non e chiaro e richiede un controllo.",
      points: 10,
      active: input.sellerType === "unknown",
    },
  ];
  const awarded = factors.filter((factor) => factor.active && factor.points > 0);
  const deductions = factors.filter(
    (factor) => factor.active && factor.points < 0,
  );

  return {
    total: [...awarded, ...deductions].reduce(
      (score, factor) => score + factor.points,
      0,
    ),
    awarded,
    deductions,
    notAwarded: factors.filter((factor) => !factor.active),
  };
}

export function calculatePriorityScore(input: PriorityScoreInput) {
  return getPriorityScoreBreakdown(input).total;
}

export function getPriorityScoreLevel(score: number) {
  if (score >= 120) {
    return "Molto alta";
  }

  if (score >= HIGH_PRIORITY_THRESHOLD) {
    return "Alta";
  }

  if (score >= 50) {
    return "Media";
  }

  return "Bassa";
}

export function calculateSellerFatigueScore(input: {
  minimumDaysOnline: number;
  isPriceDropped: boolean;
  description?: string | null;
  isRepublishedSuspected?: boolean;
}) {
  let score = 0;
  const description = (input.description ?? "").toLowerCase();

  if (input.minimumDaysOnline >= 120) {
    score += 40;
  } else if (input.minimumDaysOnline >= 60) {
    score += 20;
  }

  if (input.isPriceDropped) {
    score += 20;
  }

  if (description.includes("prezzo trattabile")) {
    score += 10;
  }

  if (input.isRepublishedSuspected) {
    score += 10;
  }

  return score;
}

export function isHotOldListing(listing: Pick<Listing, "minimumDaysOnline" | "priorityScore">) {
  return listing.minimumDaysOnline >= 60 && listing.priorityScore >= HIGH_PRIORITY_THRESHOLD;
}

export function createDerivedListingValues(input: Pick<
  NormalizedListing,
  | "sellerType"
  | "firstSeenAt"
  | "portalDeclaredDate"
  | "metadataDatePublished"
  | "phone"
  | "description"
  | "price"
  | "sqm"
  | "previousPrice"
  | "isRepublishedSuspected"
>) {
  const minimumDaysOnline = getMinimumDaysOnline({
    firstSeenAt: input.firstSeenAt,
    portalDeclaredDate: input.portalDeclaredDate,
    metadataDatePublished: input.metadataDatePublished,
  });
  const isNewToday = isToday(input.firstSeenAt);
  const isPriceDropped =
    input.previousPrice != null &&
    input.price != null &&
    input.price < input.previousPrice;

  return {
    pricePerSqm: calculatePricePerSqm(input.price, input.sqm),
    minimumDaysOnline,
    isNewToday,
    isPriceDropped,
    priorityScore: calculatePriorityScore({
      sellerType: input.sellerType,
      isNewToday,
      hasPhone: Boolean(input.phone),
      minimumDaysOnline,
      isPriceDropped,
      description: input.description,
    }),
    sellerFatigueScore: calculateSellerFatigueScore({
      minimumDaysOnline,
      isPriceDropped,
      description: input.description,
      isRepublishedSuspected: input.isRepublishedSuspected,
    }),
  };
}
