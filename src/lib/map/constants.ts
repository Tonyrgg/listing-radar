import { MAP_DATA_COLORS } from "@/lib/design/map-palette";

import type {
  AreaStatus,
  MapStatus,
  MapFiltersState,
  PinCategory,
  PinPriority,
  PinStatus,
} from "@/lib/map/types";

export const BITONTO_CENTER = {
  latitude: 41.1079,
  longitude: 16.6902,
  zoom: 14,
};

export const AREA_STATUS_OPTIONS = [
  "not_started",
  "in_progress",
  "completed",
  "to_recheck",
] as const satisfies AreaStatus[];

export const STREET_STATUS_OPTIONS = [
  "not_started",
  "in_progress",
  "completed",
  "to_recheck",
  "not_useful",
] as const satisfies MapStatus[];

export const PIN_CATEGORY_OPTIONS = [
  "sale_lead",
  "empty_house",
  "follow_up",
  "useful_doorman",
  "useful_administrator",
  "owner_met",
  "door_knocked",
  "interesting_building",
  "not_interested",
  "recheck",
  "rental_lead",
  "future_sale",
  "other",
] as const satisfies PinCategory[];

export const PIN_STATUS_OPTIONS = [
  "new",
  "to_verify",
  "hot",
  "contacted",
  "follow_up",
  "closed",
  "discarded",
] as const satisfies PinStatus[];

export const PIN_PRIORITY_OPTIONS = [
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies PinPriority[];

export const MAP_STATUS_LABELS: Record<MapStatus, string> = {
  not_started: "Non iniziato",
  in_progress: "In corso",
  completed: "Completato",
  to_recheck: "Da ripassare",
  not_useful: "Non utile",
};

export const PIN_CATEGORY_LABELS: Record<PinCategory, string> = {
  sale_lead: "Notizia vendita",
  empty_house: "Casa vuota",
  follow_up: "Richiamo",
  useful_doorman: "Portiere utile",
  useful_administrator: "Amministratore utile",
  owner_met: "Proprietario incontrato",
  door_knocked: "Citofonato",
  interesting_building: "Palazzo interessante",
  not_interested: "Non interessato",
  recheck: "Da riverificare",
  rental_lead: "Notizia affitto",
  future_sale: "Vendita futura",
  other: "Altro",
};

export const PIN_STATUS_LABELS: Record<PinStatus, string> = {
  new: "Nuovo",
  to_verify: "Da verificare",
  hot: "Caldo",
  contacted: "Contattato",
  follow_up: "Da richiamare",
  closed: "Chiuso",
  discarded: "Scartato",
};

export const PIN_PRIORITY_LABELS: Record<PinPriority, string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export const PIN_PRIORITY_COLORS: Record<PinPriority, string> = {
  low: MAP_DATA_COLORS.muted,
  medium: MAP_DATA_COLORS.positive,
  high: MAP_DATA_COLORS.attention,
  urgent: MAP_DATA_COLORS.critical,
};

export const DEFAULT_AGENT_COLORS = [MAP_DATA_COLORS.info, MAP_DATA_COLORS.accentuated];

export const FALLBACK_AREA_COLOR = MAP_DATA_COLORS.info;
export const FALLBACK_STREET_COLOR = MAP_DATA_COLORS.positive;

export const DEFAULT_MAP_FILTERS: MapFiltersState = {
  agentId: "all",
  showAreas: true,
  showStreets: true,
  showPins: true,
  areaStatus: "all",
  streetStatus: "all",
  pinCategory: "all",
  pinStatus: "all",
  pinPriority: "all",
  followUp: "all",
};
