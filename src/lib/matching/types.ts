export type ContractType = "sale" | "rent";
export type RequestStatus =
  | "draft" | "active" | "urgent" | "suspended" | "satisfied"
  | "cancelled" | "archived";
export type RequestPriority = "low" | "normal" | "high" | "urgent";
export type RequestDestination =
  | "first_home" | "investment" | "exchange" | "temporary" | "other";
export type FinancingMethod =
  | "cash" | "cash_and_mortgage" | "full_mortgage" | "exchange" | "other";
export type CreditStatus = "unknown" | "in_progress" | "positive" | "negative";
export type RequestedFloorBand = "any" | "low" | "medium" | "high" | "top";
export type PreferenceLevel = "required" | "preferred" | "indifferent" | "avoid";
export type ZonePreferenceLevel = "required" | "preferred" | "accepted" | "excluded";
export type MatchClassification =
  | "compatible" | "almost_compatible" | "weak" | "not_relevant";

export type CrmFieldValue = string | number | boolean | null;

export interface CrmRelatedSection {
  heading: string;
  text: string;
}

export interface CrmRequestActivity {
  externalId: string | null;
  subject: string | null;
  mode: string | null;
  type: string | null;
  status: string | null;
  date: string | null;
  assignedTo: string | null;
  agency: string | null;
  description: string | null;
}

export interface CrmRequestRawPayload {
  url?: string;
  title?: string;
  status?: string | null;
  capturedAt?: string;
  externalId?: string;
  clientExternalId?: string | null;
  headerFields?: Record<string, CrmFieldValue>;
  fields?: Record<string, CrmFieldValue>;
  evolutionText?: string | null;
  relatedSections?: CrmRelatedSection[];
  activities?: CrmRequestActivity[];
  activityCaptureError?: string | null;
  _zone_inference?: Array<{
    zone_id: string;
    zone_number: number | null;
    zone_name: string;
    preference_level: "preferred" | "excluded";
    matched_phrase: string;
    evidence: string;
  }>;
}

export interface Client {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  external_crm_id: string | null;
  raw_payload?: Record<string, unknown> | null;
}

export interface InternalZone {
  id: string;
  zone_number?: number | null;
  name: string;
  description: string | null;
  landmarks: string[];
  aliases: string[];
  associated_streets: string[];
  geometry: import("@/lib/map/types").GeoJsonGeometry | null;
  color: string | null;
  is_active: boolean;
}

export interface PropertyRequest {
  id: string;
  client_id: string | null;
  title: string | null;
  contract_type: ContractType;
  property_types: string[];
  municipality: string | null;
  status: RequestStatus;
  priority: RequestPriority;
  destination?: RequestDestination | null;
  financing_method?: FinancingMethod | null;
  credit_status?: CreditStatus | null;
  requested_floor_band?: RequestedFloorBand | null;
  from_own_listing?: boolean;
  budget_ideal: number | null;
  budget_max: number | null;
  monthly_rent_ideal: number | null;
  monthly_rent_max: number | null;
  internal_sqm_min: number | null;
  internal_sqm_ideal: number | null;
  internal_sqm_max: number | null;
  commercial_sqm_estimated_min: number | null;
  commercial_sqm_estimated_max: number | null;
  rooms_min: number | null;
  rooms_ideal: number | null;
  rooms_max: number | null;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  floor_min: number | null;
  floor_max: number | null;
  building_floors_max: number | null;
  accepted_conditions: string[];
  availability_requirement: string | null;
  available_by: string | null;
  notes: string | null;
  external_crm_id?: string | null;
  source?: string | null;
  last_imported_at?: string | null;
  raw_payload?: CrmRequestRawPayload | null;
  created_at?: string;
  updated_at?: string;
}

export interface PortfolioProperty {
  id: string;
  title: string;
  contract_type: ContractType;
  property_type: string;
  municipality: string | null;
  address: string | null;
  internal_zone_id: string | null;
  latitude?: number | null;
  longitude?: number | null;
  price: number | null;
  monthly_rent: number | null;
  internal_sqm: number | null;
  commercial_sqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  building_floors: number | null;
  condition: string | null;
  availability_status: string | null;
  available_from: string | null;
  description: string | null;
  notes: string | null;
  external_crm_id?: string | null;
  external_mandate_id?: string | null;
  source?: string | null;
  last_imported_at?: string | null;
  image_urls?: string[] | null;
  raw_payload?: Record<string, unknown> | null;
  mandate_status: string;
  created_at?: string;
  updated_at?: string;
  zone?: {
    id?: string;
    name: string;
    geometry?: import("@/lib/map/types").GeoJsonGeometry | null;
  } | null;
}

export interface FeatureDefinition {
  id: string;
  key: string;
  label: string;
  category: string;
  field_type: "boolean" | "number" | "range" | "select" | "multiselect" | "text";
  applies_to: "request" | "property" | "both";
  default_weight: number;
  is_active: boolean;
  sort_order: number;
}

export interface RequestFeaturePreference {
  feature_definition_id: string;
  feature?: FeatureDefinition;
  preference_level: PreferenceLevel;
  desired_value: unknown;
  custom_weight: number | null;
}

export interface PropertyFeatureValue {
  feature_definition_id: string;
  feature?: FeatureDefinition;
  value: unknown;
}

export interface RequestZone {
  zone_id: string;
  preference_level: ZonePreferenceLevel;
  zone?: InternalZone;
}

export interface RequestPropertyMatch {
  id?: string;
  request_id: string;
  property_id: string;
  score: number;
  classification: MatchClassification;
  matched_criteria: string[];
  missing_preferences: string[];
  conflicting_criteria: string[];
  explanation: string;
  last_calculated_at?: string;
}

export interface ScoreBand {
  upTo: number;
  score: number;
}

export interface MatchingConfig {
  thresholds: { compatible: number; almostCompatible: number; weak: number };
  budgetTolerance: { near: number; weak: number };
  commercialSqm: { minimumFactor: number; maximumFactor: number };
  weights: {
    propertyType: number; zone: number; budget: number; internalSqm: number;
    rooms: number; floor: number; condition: number; availability: number;
  };
  budgetBands: { floorRatio: number; halfRatio: number; sweetRatio: number; overRatio: number };
  sqmBands: ScoreBand[];
  sqmBeyondScore: number;
  roomsBands: ScoreBand[];
  roomsBeyondScore: number;
  declaredRangeFloor: number;
  propertyTypeFamilyRatio: number;
}

export interface MatchingContext {
  request: PropertyRequest;
  property: PortfolioProperty;
  requestZones?: RequestZone[];
  requestFeatures?: RequestFeaturePreference[];
  propertyFeatures?: PropertyFeatureValue[];
  config?: MatchingConfig;
}

export interface MatchResult extends Omit<RequestPropertyMatch, "request_id" | "property_id"> {
  warnings: string[];
}
