import type { Listing, NormalizedListing, SellerType } from "@/types";
import {
  getScoringConfig,
  type ScoringConfig,
} from "@/lib/listings/scoring-config";

const DAY = 24 * 60 * 60 * 1000;

export const HIGH_PRIORITY_THRESHOLD = 80;

export function getHighPriorityThreshold() {
  return getScoringConfig().highPriorityThreshold;
}

export function getHighPriorityThresholdFromConfig(config: ScoringConfig) {
  return config.highPriorityThreshold;
}

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
  price?: number | null;
  sqm?: number | null;
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
  scoringConfig?: ScoringConfig,
): PriorityScoreBreakdown {
  const description = (input.description ?? "").toLowerCase();
  const config = scoringConfig ?? getScoringConfig();
  const onlinePoints =
    input.minimumDaysOnline >= 120
      ? config.online120Days
      : input.minimumDaysOnline >= 60
        ? config.online60Days
        : 0;
  const factors: PriorityScoreFactor[] = [
    {
      id: "private-seller",
      label: "Venditore privato",
      explanation: "Il contatto sembra diretto, senza agenzia.",
      points: config.privateSeller,
      active: input.sellerType === "private",
    },
    {
      id: "new-today",
      label: "Nuovo arrivo",
      explanation: "L'annuncio e stato rilevato oggi.",
      points: config.newToday,
      active: input.isNewToday,
    },
    {
      id: "phone-visible",
      label: "Telefono disponibile",
      explanation: "E presente un recapito utilizzabile.",
      points: config.visiblePhone,
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
      points: onlinePoints || config.online60Days,
      active: onlinePoints > 0,
    },
    {
      id: "price-drop",
      label: "Prezzo ridotto",
      explanation: "Il prezzo attuale e inferiore a una rilevazione precedente.",
      points: config.priceDrop,
      active: input.isPriceDropped,
    },
    {
      id: "negotiable-price",
      label: "Prezzo trattabile",
      explanation: "La descrizione dichiara esplicitamente una trattativa possibile.",
      points: config.negotiablePrice,
      active: description.includes("prezzo trattabile"),
    },
    {
      id: "no-agencies",
      label: "Nessuna agenzia richiesta",
      explanation: "La descrizione contiene l'indicazione no agenzie.",
      points: config.noAgencies,
      active: description.includes("no agenzie"),
    },
    {
      id: "seller-to-verify",
      label: "Venditore non identificato",
      explanation: "Non e ancora chiaro se il venditore sia un privato o un'agenzia.",
      points: config.unknownSeller,
      active: input.sellerType === "unknown",
    },
    {
      id: "agency-seller",
      label: "Annuncio di agenzia",
      explanation: "Il contatto non sembra diretto con il proprietario.",
      points: config.agencySeller,
      active: input.sellerType === "agency",
    },
    {
      id: "missing-price",
      label: "Prezzo non rilevato",
      explanation: "Senza prezzo e piu difficile confrontare l'opportunita.",
      points: config.missingPrice,
      active: input.price == null,
    },
    {
      id: "missing-sqm",
      label: "Superficie non rilevata",
      explanation: "Manca il dato necessario per calcolare il prezzo al mq.",
      points: config.missingSqm,
      active: input.sqm == null,
    },
    {
      id: "missing-description",
      label: "Descrizione insufficiente",
      explanation: "La scheda contiene poche informazioni utili.",
      points: config.missingDescription,
      active: description.length < 40,
    },
    {
      id: "auction",
      label: "Vendita all'asta",
      explanation: "L'annuncio richiede un processo diverso dalla normale acquisizione.",
      points: config.auction,
      active: /\b(?:asta|tribunale|procedura esecutiva)\b/i.test(description),
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
    notAwarded: factors.filter((factor) => !factor.active && factor.points > 0),
  };
}

export function calculatePriorityScore(
  input: PriorityScoreInput,
  scoringConfig?: ScoringConfig,
) {
  return getPriorityScoreBreakdown(input, scoringConfig).total;
}

export function getPriorityScoreLevel(score: number, scoringConfig?: ScoringConfig) {
  if (score >= 120) {
    return "Molto alta";
  }

  if (score >= (scoringConfig?.highPriorityThreshold ?? getHighPriorityThreshold())) {
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
  return listing.minimumDaysOnline >= 60 && listing.priorityScore >= getHighPriorityThreshold();
}

export function isHotOldListingWithConfig(
  listing: Pick<Listing, "minimumDaysOnline" | "priorityScore">,
  scoringConfig: ScoringConfig,
) {
  return (
    listing.minimumDaysOnline >= 60 &&
    listing.priorityScore >= scoringConfig.highPriorityThreshold
  );
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
>, scoringConfig?: ScoringConfig) {
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
    priorityScore: calculatePriorityScore(
      {
        sellerType: input.sellerType,
        isNewToday,
        hasPhone: Boolean(input.phone),
        minimumDaysOnline,
        isPriceDropped,
        description: input.description,
        price: input.price,
        sqm: input.sqm,
      },
      scoringConfig,
    ),
    sellerFatigueScore: calculateSellerFatigueScore({
      minimumDaysOnline,
      isPriceDropped,
      description: input.description,
      isRepublishedSuspected: input.isRepublishedSuspected,
    }),
  };
}
