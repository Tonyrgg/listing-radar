export interface LifecycleAgencyRef {
  id: string;
  slug: string;
  name: string;
  listingId: string;
  state: string;
  reference: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LifecyclePropertySummary {
  id: string;
  title: string;
  address: string | null;
  locality: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  currentPrice: number | null;
  propertyState: string;
  saleStatus: string;
  identityStatus: string;
  trueMarketStartLowerBound: string | null;
  trueMarketStartUpperBound: string | null;
  trueMarketStartMethod: string | null;
  trueMarketStartConfidence: number | null;
  relaunchCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  representativeImagePaths: string[];
  agencies: LifecycleAgencyRef[];
  activePrivateCount: number;
}

export interface LifecycleEventItem {
  id: string;
  propertyId: string;
  eventType: string;
  occurredAt: string;
  confidence: number;
  actorType: string;
  payload: Record<string, unknown>;
  property: LifecyclePropertySummary;
}

export interface LifecycleOpportunityItem {
  id: string;
  propertyId: string;
  level: string;
  status: string;
  score: number | null;
  detectedAt: string;
  reasons: string[];
  evidenceSummary: Record<string, unknown>;
  property: LifecyclePropertySummary;
}

export interface LifecycleDashboard {
  metrics: {
    totalProperties: number;
    activeProperties: number;
    hotOpportunities: number;
    openReviews: number;
    activePrivate: number;
  };
  recentEvents: LifecycleEventItem[];
  priorityOpportunities: LifecycleOpportunityItem[];
  generatedAt: string;
}

export interface LifecycleAgencySummary {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  enabled: boolean;
  activeCount: number;
  exitedCount: number;
  soldCount: number;
  latestHealth: string | null;
  latestHealthAt: string | null;
  latestSyncStatus: string | null;
  latestSyncAt: string | null;
  latestSyncCounts: {
    discovered: number;
    inScope: number;
    excluded: number;
    errors: number;
  } | null;
}

export interface LifecycleAgencyDetail {
  agency: LifecycleAgencySummary;
  inventory: LifecyclePropertySummary[];
  priceReducedPropertyIds: string[];
  newPropertyIds: string[];
  recentRuns: Array<{
    id: string;
    mode: string;
    status: string;
    healthState: string | null;
    startedAt: string;
    finishedAt: string | null;
    discoveredCount: number;
    inScopeCount: number;
    excludedCount: number;
    errorCount: number;
    transitionedCount: number;
  }>;
}

export interface LifecycleReviewItem {
  id: string;
  reviewType: string;
  status: string;
  priority: number;
  title: string;
  details: Record<string, unknown>;
  createdAt: string;
  property: LifecyclePropertySummary | null;
  agencyName: string | null;
  automaticExclusions: {
    count: number;
    reasons: Record<string, number>;
  };
  candidates: Array<{
    property: LifecyclePropertySummary;
    score: number | null;
    contradictions: string[];
  }>;
}

export interface LifecyclePrivatePublication {
  id: string;
  legacyListingId: string;
  source: string;
  canonicalUrl: string;
  state: string;
  identityOutcome: string;
  identityScore: number;
  title: string;
  price: number | null;
  surfaceSqm: number | null;
  rooms: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  property: LifecyclePropertySummary;
}

export interface LifecyclePropertyDetail {
  property: LifecyclePropertySummary;
  location: {
    rawText: string | null;
    municipality: string | null;
    locality: string | null;
    streetName: string | null;
    streetNumber: string | null;
    latitude: number | null;
    longitude: number | null;
    precision: string;
    confidence: number | null;
    manuallyVerified: boolean;
  } | null;
  building: { id: string; displayName: string | null } | null;
  publications: Array<{
    id: string;
    agencyName: string;
    sourceKey: string;
    canonicalUrl: string;
    state: string;
    sourceStatus: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  privatePublications: LifecyclePrivatePublication[];
  events: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    confidence: number;
    actorType: string;
    payload: Record<string, unknown>;
  }>;
  evidence: Array<{
    id: string;
    kind: string;
    claimKey: string;
    extractionMethod: string;
    confidence: number;
    observedAt: string;
    sourceRecordedAt: string | null;
  }>;
  priceHistory: Array<{
    eventType: string;
    occurredAt: string;
    oldPrice: number | null;
    newPrice: number | null;
  }>;
  opportunity: LifecycleOpportunityItem | null;
  manualOverrides: Array<{
    id: string;
    targetType: string;
    targetId: string;
    key: string;
    value: unknown;
    previousValue: unknown;
    reason: string;
    source: string;
    effectiveAt: string;
  }>;
  imageUrls: string[];
}
