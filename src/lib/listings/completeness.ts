import type { Listing, NormalizedListing } from "@/types";

export type ListingCompletenessField = {
  key: string;
  label: string;
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
  isMissing: (listing: CompletenessInput) => boolean;
}> = [
  {
    key: "title",
    label: "Titolo",
    isMissing: (listing) => !hasText(listing.title),
  },
  {
    key: "price",
    label: "Prezzo",
    isMissing: (listing) => listing.price == null,
  },
  {
    key: "sqm",
    label: "Superficie",
    isMissing: (listing) => listing.sqm == null,
  },
  {
    key: "rooms",
    label: "Locali",
    isMissing: (listing) => listing.rooms == null,
  },
  {
    key: "zone",
    label: "Zona",
    isMissing: (listing) => !hasText(listing.zone),
  },
  {
    key: "description",
    label: "Descrizione",
    isMissing: (listing) => !hasText(listing.description, 80),
  },
];

const recommendedFields: Array<{
  key: keyof CompletenessInput;
  label: string;
  isMissing: (listing: CompletenessInput) => boolean;
}> = [
  {
    key: "imageUrls",
    label: "Fotografie",
    isMissing: (listing) => !listing.imageUrls?.length,
  },
  {
    key: "sellerType",
    label: "Tipo venditore",
    isMissing: (listing) => listing.sellerType === "unknown",
  },
  {
    key: "sellerName",
    label: "Nome venditore",
    isMissing: (listing) => !hasText(listing.sellerName),
  },
  {
    key: "addressRaw",
    label: "Indirizzo",
    isMissing: (listing) => !hasText(listing.addressRaw),
  },
  {
    key: "phone",
    label: "Telefono",
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
        severity: "required" as const,
      })),
    ...recommendedFields
      .filter((field) => field.isMissing(listing))
      .map((field) => ({
        key: String(field.key),
        label: field.label,
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
