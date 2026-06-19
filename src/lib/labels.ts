import type {
  ListingCrmStatus,
  IncomingListingStatus,
  ListingStatus,
  SellerType,
} from "@/types";
import { normalizeListingSource } from "@/lib/listing-sources";

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

const LISTING_CRM_STATUS_LABELS: Record<ListingCrmStatus, string> = {
  untreated: "Non trattato",
  treated: "Trattato",
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

const SOURCE_LABELS: Record<string, string> = {
  immobiliaririunite: "Immobiliari Riunite",
  admaiora: "Ad Maiora",
  puntocasa: "PuntoCasa Group",
  iconacasa: "Iconacasa Bitonto",
  ingegnericolapinto: "Ingegneri Colapinto",
  vistocasa: "Vistocasa Bitonto",
  studisanti: "Studi Santi Immobiliare",
  import: "Importato dal browser",
  feed: "Feed autorizzato",
  mock: "Dati di prova",
  immobiliare: "Immobiliare.it",
  idealista: "Idealista",
  casa: "Casa.it",
  wikicasa: "Wikicasa",
  casadaprivato: "CasaDaPrivato",
  subito: "Subito",
  bakeca: "Bakeca",
};

export function getSellerTypeLabel(value: SellerType | "all") {
  return SELLER_TYPE_LABELS[value] ?? value;
}

export function getListingStatusLabel(value: string) {
  return LISTING_STATUS_LABELS[value as ListingStatus | "all"] ?? value;
}

export function getListingCrmStatusLabel(value: ListingCrmStatus) {
  return LISTING_CRM_STATUS_LABELS[value];
}

export function getIncomingStatusLabel(value: IncomingListingStatus) {
  return INCOMING_STATUS_LABELS[value];
}

export function getRunStatusLabel(value: string) {
  return RUN_STATUS_LABELS[value] ?? value;
}

export function getSourceLabel(value: string) {
  return SOURCE_LABELS[normalizeListingSource(value)] ?? value;
}
