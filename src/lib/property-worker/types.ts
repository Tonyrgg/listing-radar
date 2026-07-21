export type PropertyWorkerMode = "assisted" | "automatic";

export type PropertyWorkerJob = {
  id: string;
  mode: PropertyWorkerMode;
  status: string;
  currentStep: string;
  lastCompletedStep: string | null;
  municipality: string | null;
  street: string | null;
  civicNumber: string | null;
  sisterSourceUrl: string | null;
  totalProperties: number;
  processedProperties: number;
  totalPeople: number;
  processedPeople: number;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type PropertyWorkerProperty = {
  id: string;
  cadastralKey: string;
  address: string | null;
  category: string | null;
  class: string | null;
  consistency: string | null;
  cadastralIncome: number | null;
  processingStatus: string;
  crmRecordId: string | null;
};

export type PropertyWorkerPerson = {
  id: string;
  fullName: string;
  taxCode: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  rightType: string | null;
  sharePercentage: number | null;
  mobiles: string[];
  landlines: string[];
  emails: string[];
  processingStatus: string;
  crmRecordId: string | null;
};

export type PropertyWorkerOwnership = {
  id: string;
  propertyId: string;
  personId: string;
  rightType: string;
  sharePercentage: number | null;
  processingStatus: string;
};

export type PropertyWorkerStep = {
  id: string;
  stepName: string;
  status: string;
  errorMessage: string | null;
  screenshotPath: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type PropertyWorkerChangeLog = {
  id: string;
  entityType: string;
  entityIdentifier: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  source: string;
  createdAt: string;
};

export type PropertyWorkerDashboardData = {
  available: boolean;
  errorMessage: string | null;
  jobs: PropertyWorkerJob[];
  selectedJob: PropertyWorkerJob | null;
  properties: PropertyWorkerProperty[];
  people: PropertyWorkerPerson[];
  ownerships: PropertyWorkerOwnership[];
  steps: PropertyWorkerStep[];
  changeLogs: PropertyWorkerChangeLog[];
};

