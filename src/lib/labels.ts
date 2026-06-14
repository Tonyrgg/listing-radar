import type {
  IncomingListingStatus,
  ListingStatus,
  SellerType,
} from "@/types";

const SELLER_TYPE_LABELS: Record<SellerType | "all", string> = {
  all: "Tutti",
  private: "Privato",
  agency: "Agenzia",
  unknown: "Da verificare",
};

const LISTING_STATUS_LABELS: Record<ListingStatus | "all", string> = {
  all: "Tutti",
  new: "Nuovo",
  watch: "Da osservare",
  review: "Da valutare",
  contacted: "Contattato",
  negotiating: "In trattativa",
  archived: "Archiviato",
};

const INCOMING_STATUS_LABELS: Record<IncomingListingStatus, string> = {
  pending: "Da completare",
  enriched: "Completato",
  dismissed: "Archiviato",
  error: "Da controllare",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  success: "Completato",
  completed_with_errors: "Completato con avvisi",
  error: "Non riuscito",
  running: "In corso",
};

export function getSellerTypeLabel(value: SellerType | "all") {
  return SELLER_TYPE_LABELS[value] ?? value;
}

export function getListingStatusLabel(value: string) {
  return LISTING_STATUS_LABELS[value as ListingStatus | "all"] ?? value;
}

export function getIncomingStatusLabel(value: IncomingListingStatus) {
  return INCOMING_STATUS_LABELS[value];
}

export function getRunStatusLabel(value: string) {
  return RUN_STATUS_LABELS[value] ?? value;
}

export function getSourceLabel(value: string) {
  const normalized = value.toLowerCase();

  if (normalized === "immobiliaririunite") {
    return "Immobiliari Riunite";
  }

  if (normalized === "admaiora") {
    return "Ad Maiora";
  }

  if (normalized === "import") {
    return "Importato dal browser";
  }

  if (normalized === "feed") {
    return "Feed autorizzato";
  }

  if (normalized === "mock") {
    return "Dati di prova";
  }

  return value;
}
