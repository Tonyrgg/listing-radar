export const WORKFLOW_STEPS = [
  "ready",
  "sister_results_acquired",
  "properties_extracted",
  "owners_extracted",
  "data_normalized",
  "person_searched",
  "person_created_or_updated",
  "property_searched",
  "property_created_or_updated",
  "activity_created",
  "contacts_matched",
  "owners_linked",
  "verified",
  "completed",
] as const;

export const ERROR_STATUSES = [
  "needs_review",
  "session_expired",
  "portal_error",
  "data_incomplete",
  "failed",
  "paused",
] as const;

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];
export type ErrorStatus = (typeof ERROR_STATUSES)[number];
export type WorkerMode = "assisted" | "automatic";

export interface SearchContext {
  municipality: string;
  street: string | null;
  civicNumber: string | null;
  sourceUrl: string;
}

export interface CadastralKey {
  municipality: string;
  sheet: string;
  parcel: string;
  subaltern: string;
}

export interface CadastralProperty extends CadastralKey {
  address: string | null;
  censusZone: string | null;
  category: string;
  class: string | null;
  consistency: string | null;
  cadastralIncome: number | null;
  sourceRef?: string;
  rawPayload: Record<string, unknown>;
}

export interface CadastralOwner {
  fullName: string;
  birthPlace: string | null;
  birthProvince: string | null;
  birthDate: string | null;
  taxCode: string | null;
  rightType: string;
  shareOriginal: string;
  shareNumerator: number | null;
  shareDenominator: number | null;
  sharePercentage: number | null;
  rawPayload: Record<string, unknown>;
}

export interface ContactMatchResult {
  taxCode: string;
  matchedRows: number;
  mobiles: string[];
  landlines: string[];
  emails: string[];
  whatsapp: string[];
  overflowPhones: string[];
  notes: string[];
}

export interface NormalizedPerson extends CadastralOwner {
  mobiles: string[];
  landlines: string[];
  emails: string[];
  whatsapp: string[];
}

export type NormalizedProperty = CadastralProperty;

export interface PersonSearchInput {
  taxCode: string;
  phones: string[];
  fullName: string;
  birthDate: string | null;
}

export type MatchConfidence = "certain" | "possible" | "none";

export interface PersonMatchResult {
  matches: Array<{ id: string; label: string; confidence: MatchConfidence; data: Record<string, unknown> }>;
}

export interface PropertyMatchResult {
  match: { id: string; data: Record<string, unknown> } | null;
}

export interface CrmActivityInput {
  personId: string;
  propertyId: string;
  description: string;
  status: "Da eseguire";
}

export interface SisterAdapter {
  detectPage(): Promise<boolean>;
  extractSearchContext(): Promise<SearchContext>;
  extractProperties(): Promise<CadastralProperty[]>;
  extractOwners(property: CadastralProperty): Promise<CadastralOwner[]>;
}

export interface CrmAdapter {
  detectPage(): Promise<boolean>;
  findPerson(input: PersonSearchInput): Promise<PersonMatchResult>;
  createPerson(person: NormalizedPerson): Promise<string>;
  updatePerson(id: string, person: NormalizedPerson): Promise<void>;
  findPropertyForPerson(personId: string, key: CadastralKey): Promise<PropertyMatchResult>;
  createProperty(property: NormalizedProperty): Promise<string>;
  updateProperty(id: string, property: NormalizedProperty): Promise<void>;
  createActivity(input: CrmActivityInput): Promise<string>;
  findLinkedOwnerIds(propertyId: string): Promise<string[]>;
  linkOwner(propertyId: string, personId: string, share: number): Promise<string>;
}

export interface ContactsAdapter {
  load(): Promise<void>;
  findByTaxCode(taxCode: string): ContactMatchResult;
}
