export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
  [key: string]: unknown;
};

export type MapStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "to_recheck"
  | "not_useful";

export type AreaStatus = Exclude<MapStatus, "not_useful">;

export type PinCategory =
  | "sale_lead"
  | "empty_house"
  | "follow_up"
  | "useful_doorman"
  | "useful_administrator"
  | "owner_met"
  | "door_knocked"
  | "interesting_building"
  | "not_interested"
  | "recheck"
  | "rental_lead"
  | "future_sale"
  | "other";

export type PinStatus =
  | "new"
  | "to_verify"
  | "hot"
  | "contacted"
  | "follow_up"
  | "closed"
  | "discarded";

export type PinPriority = "low" | "medium" | "high" | "urgent";

export interface Agent {
  id: string;
  name: string;
  color: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MapArea {
  id: string;
  name: string;
  agentId: string | null;
  color: string | null;
  geometry: GeoJsonGeometry;
  status: AreaStatus;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MapStreet {
  id: string;
  name: string;
  agentId: string | null;
  areaId: string | null;
  geometry: GeoJsonGeometry | null;
  status: MapStatus;
  lastCompletedAt: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MapPin {
  id: string;
  title: string;
  category: PinCategory;
  status: PinStatus;
  priority: PinPriority;
  agentId: string | null;
  areaId: string | null;
  streetId: string | null;
  listingId: string | null;
  latitude: number;
  longitude: number;
  addressRaw: string | null;
  notes: string | null;
  followUpAt: string | null;
  lastContactedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MapActivityLog {
  id: string;
  agentId: string | null;
  areaId: string | null;
  streetId: string | null;
  pinId: string | null;
  actionType: string;
  notes: string | null;
  createdAt: string | null;
}

export type CreateMapAreaInput = {
  name: string;
  agentId: string | null;
  color: string | null;
  geometry: GeoJsonGeometry;
  status: AreaStatus;
  notes: string | null;
};

export type UpdateMapAreaInput = Partial<CreateMapAreaInput>;

export type CreateMapStreetInput = {
  name: string;
  agentId: string | null;
  areaId: string | null;
  geometry: GeoJsonGeometry | null;
  status: MapStatus;
  lastCompletedAt?: string | null;
  notes: string | null;
};

export type UpdateMapStreetInput = Partial<CreateMapStreetInput>;

export type CreateMapPinInput = {
  title: string;
  category: PinCategory;
  status: PinStatus;
  priority: PinPriority;
  agentId: string | null;
  areaId: string | null;
  streetId: string | null;
  listingId: string | null;
  latitude: number;
  longitude: number;
  addressRaw: string | null;
  notes: string | null;
  followUpAt: string | null;
  lastContactedAt?: string | null;
};

export type UpdateMapPinInput = Partial<CreateMapPinInput>;

export type CreateMapActivityLogInput = {
  agentId?: string | null;
  areaId?: string | null;
  streetId?: string | null;
  pinId?: string | null;
  actionType: string;
  notes?: string | null;
};

export type MapElementType = "pin" | "area" | "street";

export type MapDrawMode = "select" | "pin" | "area" | "street";

export type SelectedMapElement =
  | { type: "pin"; id: string }
  | { type: "area"; id: string }
  | { type: "street"; id: string }
  | null;

export type FollowUpFilter = "all" | "overdue" | "next7";

export type MapFiltersState = {
  agentId: "all" | string;
  showAreas: boolean;
  showStreets: boolean;
  showPins: boolean;
  areaStatus: "all" | AreaStatus;
  streetStatus: "all" | MapStatus;
  pinCategory: "all" | PinCategory;
  pinStatus: "all" | PinStatus;
  pinPriority: "all" | PinPriority;
  followUp: FollowUpFilter;
};

export type MapStats = {
  totalAreas: number;
  completedAreas: number;
  totalStreets: number;
  completedStreets: number;
  totalPins: number;
  hotPins: number;
  followUpPins: number;
  overdueFollowUps: number;
  upcomingFollowUps: number;
};
