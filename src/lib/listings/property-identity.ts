import { createHash } from "node:crypto";

export type PropertyIdentityInput = {
  title: string;
  description?: string | null;
  address_raw?: string | null;
  zone?: string | null;
  price?: number | null;
  sqm?: number | null;
  rooms?: number | null;
  floor?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type PropertyIdentityMatch = {
  score: number;
  autoMerge: boolean;
  possibleDuplicate: boolean;
  identityKey: string | null;
  reasons: string[];
};

const ADDRESS_PATTERN =
  /\b(via|viale|corso|piazza|piazzale|largo|corte|strada|vicolo|vico|borgo|contrada|traversa)\s+([a-z0-9'’\s.]{2,72}?)(?:,\s*|\s+)(\d{1,4}[a-z]?(?:\s*[-/]\s*\d{1,4})?)(?=\s*(?:,|a\b|bitonto\b|\(|$))/i;

const DESCRIPTION_STOP_WORDS = new Set([
  "appartamento",
  "immobile",
  "vendita",
  "affitto",
  "bitonto",
  "agenzia",
  "immobiliare",
  "proponiamo",
  "zona",
  "composto",
  "circa",
  "euro",
  "piano",
  "locale",
  "locali",
  "vani",
]);

export function normalizeIdentityText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAddressIdentity(input: PropertyIdentityInput) {
  const candidates = [input.title, input.address_raw].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const match = normalizeIdentityText(candidate).match(ADDRESS_PATTERN);
    if (!match) continue;
    const streetType = match[1];
    const streetName = match[2].replace(/\s+/g, " ").trim();
    const civic = match[3].replace(/\s+/g, "").replace(/\//g, "-");
    if (!streetName || !civic) continue;
    return {
      street: `${streetType} ${streetName}`,
      civic,
      key: `${streetType}:${streetName}:${civic}`,
    };
  }

  return null;
}

function wordSet(value: string | null | undefined, removeStopWords = false) {
  return new Set(
    normalizeIdentityText(value)
      .split(" ")
      .filter((word) => word.length >= 4)
      .filter((word) => !removeStopWords || !DESCRIPTION_STOP_WORDS.has(word)),
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / new Set([...left, ...right]).size;
}

function relativeDifference(left?: number | null, right?: number | null) {
  if (!left || !right) return null;
  return Math.abs(left - right) / Math.max(left, right);
}

function normalizedFloor(value: string | null | undefined) {
  const text = normalizeIdentityText(value);
  if (!text) return null;
  if (/\b(?:terra|rialzato)\b/.test(text)) return "0";
  if (/\b(?:seminterrato|interrato)\b/.test(text)) return "-1";
  return text.match(/-?\d+/)?.[0] ?? text;
}

function coordinateDistanceMeters(
  left: PropertyIdentityInput,
  right: PropertyIdentityInput,
) {
  const lat1 = Number(left.latitude);
  const lon1 = Number(left.longitude);
  const lat2 = Number(right.latitude);
  const lon2 = Number(right.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildPropertyIdentityKey(input: PropertyIdentityInput) {
  const address = extractAddressIdentity(input);
  if (!address) return null;
  const sqmBucket = input.sqm ? Math.round(input.sqm / 5) * 5 : "x";
  const roomKey = input.rooms ?? "x";
  const raw = `${address.key}|sqm:${sqmBucket}|rooms:${roomKey}`;
  return `property-${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

export function comparePropertyIdentity(
  listing: PropertyIdentityInput,
  candidate: PropertyIdentityInput,
): PropertyIdentityMatch {
  const leftAddress = extractAddressIdentity(listing);
  const rightAddress = extractAddressIdentity(candidate);
  const addressExact = Boolean(
    leftAddress && rightAddress && leftAddress.key === rightAddress.key,
  );
  const differentExplicitAddress = Boolean(
    leftAddress && rightAddress && leftAddress.key !== rightAddress.key,
  );
  const sameStreetDifferentCivic = Boolean(
    leftAddress &&
      rightAddress &&
      leftAddress.street === rightAddress.street &&
      leftAddress.civic !== rightAddress.civic,
  );
  const sqmDifference = relativeDifference(listing.sqm, candidate.sqm);
  const priceDifference = relativeDifference(listing.price, candidate.price);
  const roomDifference =
    listing.rooms != null && candidate.rooms != null
      ? Math.abs(listing.rooms - candidate.rooms)
      : null;
  const leftFloor = normalizedFloor(listing.floor);
  const rightFloor = normalizedFloor(candidate.floor);
  const floorConflict = Boolean(
    leftFloor && rightFloor && leftFloor !== rightFloor,
  );
  const leftDescriptionWords = wordSet(listing.description, true);
  const rightDescriptionWords = wordSet(candidate.description, true);
  const descriptionScore = jaccard(leftDescriptionWords, rightDescriptionWords);
  const titleScore = jaccard(wordSet(listing.title), wordSet(candidate.title));
  const distance = coordinateDistanceMeters(listing, candidate);
  const reasons: string[] = [];

  if (
    differentExplicitAddress ||
    sameStreetDifferentCivic ||
    (sqmDifference != null && sqmDifference > 0.3) ||
    (roomDifference != null && roomDifference > 2)
  ) {
    return {
      score: 0,
      autoMerge: false,
      possibleDuplicate: false,
      identityKey: buildPropertyIdentityKey(listing),
      reasons: [
        differentExplicitAddress
          ? "different-explicit-address"
          : sameStreetDifferentCivic
            ? "different-civic-number"
          : sqmDifference != null && sqmDifference > 0.3
            ? "incompatible-surface"
            : "incompatible-room-count",
      ],
    };
  }

  let score = 0;
  let comparableDetails = 0;
  if (addressExact) {
    score += 0.56;
    reasons.push("same-street-and-civic");
  }
  if (distance != null && distance <= 35) {
    score += 0.2;
    reasons.push("coordinates-within-35m");
  } else if (distance != null && distance <= 80) {
    score += 0.08;
    reasons.push("coordinates-within-80m");
  }
  if (sqmDifference != null) {
    comparableDetails += 1;
    if (sqmDifference <= 0.04) {
      score += 0.16;
      reasons.push("surface-almost-identical");
    } else if (sqmDifference <= 0.1) {
      score += 0.1;
      reasons.push("surface-compatible");
    }
  }
  if (roomDifference != null) {
    comparableDetails += 1;
    if (roomDifference === 0) {
      score += 0.11;
      reasons.push("same-room-count");
    } else if (roomDifference <= 1) {
      score += 0.04;
      reasons.push("room-count-compatible");
    }
  }
  if (priceDifference != null) {
    comparableDetails += 1;
    if (priceDifference <= 0.04) {
      score += 0.1;
      reasons.push("price-almost-identical");
    } else if (priceDifference <= 0.12) {
      score += 0.04;
      reasons.push("price-compatible");
    }
  }
  if (leftFloor && rightFloor) {
    comparableDetails += 1;
    if (!floorConflict) {
      score += 0.07;
      reasons.push("same-floor");
    }
  }
  if (descriptionScore >= 0.72) {
    score += 0.34;
    reasons.push("same-distinctive-description");
  } else if (descriptionScore >= 0.52) {
    score += 0.13;
    reasons.push("similar-description");
  }
  if (titleScore >= 0.65) {
    score += 0.06;
    reasons.push("similar-title");
  }

  score = Math.min(1, Number(score.toFixed(3)));
  const hasStrongAnchor =
    (addressExact && comparableDetails >= 2 && !floorConflict) ||
    (descriptionScore >= 0.78 &&
      leftDescriptionWords.size >= 10 &&
      rightDescriptionWords.size >= 10 &&
      sqmDifference != null &&
      sqmDifference <= 0.04 &&
      priceDifference != null &&
      priceDifference <= 0.04 &&
      roomDifference === 0);

  return {
    score,
    autoMerge: hasStrongAnchor && score >= 0.82,
    possibleDuplicate: score >= 0.62,
    identityKey: buildPropertyIdentityKey(listing),
    reasons,
  };
}
