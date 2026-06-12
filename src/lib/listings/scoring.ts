import type { Listing, NormalizedListing, SellerType } from "@/types";

const DAY = 24 * 60 * 60 * 1000;

export const HIGH_PRIORITY_THRESHOLD = 80;

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

export function calculatePriorityScore(input: {
  sellerType: SellerType;
  isNewToday: boolean;
  hasPhone: boolean;
  minimumDaysOnline: number;
  isPriceDropped: boolean;
  description?: string | null;
}) {
  let score = 0;
  const description = (input.description ?? "").toLowerCase();

  if (input.sellerType === "private") {
    score += 40;
  }

  if (input.isNewToday) {
    score += 25;
  }

  if (input.hasPhone) {
    score += 20;
  }

  if (input.minimumDaysOnline >= 120) {
    score += 35;
  } else if (input.minimumDaysOnline >= 60) {
    score += 20;
  }

  if (input.isPriceDropped) {
    score += 20;
  }

  if (description.includes("prezzo trattabile")) {
    score += 10;
  }

  if (description.includes("no agenzie")) {
    score += 10;
  }

  if (input.sellerType === "unknown") {
    score += 10;
  }

  return score;
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
