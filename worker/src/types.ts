export const WORKFLOW_STEPS = [
  "ready",
  "sister_results_acquired",
  "properties_extracted",
  "owners_extracted",
  "data_normalized",
  "acquisition_reviewed",
  "properties_processed",
  "verified",
  "completed",
] as const;

export const LEGACY_WORKFLOW_STEPS = [
  "person_searched",
  "person_created_or_updated",
  "person_merge_reviewed",
  "property_searched",
  "property_created_or_updated",
  "activity_created",
  "contacts_matched",
  "owners_linked",
] as const;

export const ERROR_STATUSES = [
  "needs_review",
  "session_expired",
  "portal_error",
  "data_incomplete",
  "failed",
  "paused",
] as const;

export type ActiveWorkflowStep = (typeof WORKFLOW_STEPS)[number];
export type WorkflowStep = ActiveWorkflowStep | (typeof LEGACY_WORKFLOW_STEPS)[number];
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

export interface AcquisitionReview {
  municipality: string | null;
  street: string | null;
  civicNumber: string | null;
  properties: Array<{
    id: string;
    cadastralKey: string;
    address: string | null;
    category: string | null;
    class: string | null;
    consistency: string | null;
    cadastralIncome: number | null;
    owners: Array<{
      id: string;
      fullName: string;
      taxCode: string | null;
      birthPlace: string | null;
      birthDate: string | null;
      sharePercentage: number | null;
    }>;
  }>;
}

export type PersonMergeStatus = "not_required" | "pending" | "ready" | "blocked" | "completed" | "simulated";

export interface PersonCreationResult {
  personId: string | null;
  mergeStatus: PersonMergeStatus;
  details: Record<string, unknown>;
}

export interface PersonMergeResult {
  status: PersonMergeStatus;
  personId: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface CrmActivityInput {
  propertyId: string;
  propertyAddress: string | null;
  fallbackPersonId?: string;
  description: string;
  status: "Da eseguire";
}

export interface CrmActivityResult {
  outcome: "created" | "existing" | "simulated";
  crmActivityId: string | null;
  correlatedProperty: string;
  attempts: number;
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
  createPerson(person: NormalizedPerson, duplicateCandidateIds?: string[], onBeforeSave?: () => Promise<void>): Promise<PersonCreationResult>;
  updatePerson(id: string, person: NormalizedPerson): Promise<void>;
  inspectPersonMerge(): Promise<PersonMergeResult>;
  confirmPersonMerge(): Promise<PersonMergeResult>;
  findPropertyForPerson(personId: string, property: NormalizedProperty): Promise<PropertyMatchResult>;
  createProperty(property: NormalizedProperty): Promise<string>;
  updateProperty(id: string, property: NormalizedProperty): Promise<void>;
  createPropertyActivity(input: CrmActivityInput): Promise<CrmActivityResult>;
  findLinkedOwnerIds(propertyId: string): Promise<string[]>;
  linkOwner(propertyId: string, personId: string, share: number): Promise<string>;
}

export interface ContactsAdapter {
  load(): Promise<void>;
  findByTaxCode(taxCode: string): ContactMatchResult;
}
