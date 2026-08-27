import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  LifecycleAgencyDetail,
  LifecycleAgencyRef,
  LifecycleAgencySummary,
  LifecycleDashboard,
  LifecycleEventItem,
  LifecycleOpportunityItem,
  LifecyclePrivatePublication,
  LifecyclePropertyDetail,
  LifecyclePropertySummary,
  LifecycleReviewItem,
} from "@/lib/property-lifecycle/read-models/types";
import { evaluateIdentityReviewCandidates } from "./identity-review";
import { MARKET_EVENT_TYPES } from "./market-events";

interface DatabaseError {
  message: string;
}

interface PropertyRow {
  id: string;
  building_id: string | null;
  primary_location_id: string | null;
  property_type: string | null;
  identity_status: string;
  sale_status: string;
  property_state: string;
  true_market_start_lower_bound: string | null;
  true_market_start_upper_bound: string | null;
  true_market_start_method: string | null;
  true_market_start_confidence: number | string | null;
  relaunch_count: number;
  first_seen_at: string;
  last_seen_at: string;
  representative_image_paths: string[];
  canonical_attributes: Record<string, unknown>;
}

interface AgencyListingRow {
  id: string;
  agency_id: string;
  property_id: string;
  agency_reference: string | null;
  state: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface AgencyRow {
  id: string;
  slug: string;
  name: string;
  website_url: string;
  enabled: boolean;
}

interface PrivatePublicationRow {
  id: string;
  legacy_listing_id: string;
  property_id: string;
  source: string;
  canonical_url: string;
  state: string;
  identity_outcome: string;
  identity_score: number | string;
  title: string;
  price_amount: number | null;
  surface_sqm: number | string | null;
  rooms: number | string | null;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
}

interface SnapshotRow {
  publication_id: string;
  title: string | null;
  price_amount: number | null;
  surface_sqm: number | string | null;
  rooms: number | string | null;
  observed_at: string;
}

function throwIfError(error: DatabaseError | null): void {
  if (error) throw new Error(error.message);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

const POSTGREST_ID_BATCH_SIZE = 75;

async function rowsByIdBatches<T>(
  ids: string[],
  fetchBatch: (
    batch: string[],
  ) => Promise<{ data: T[] | null; error: DatabaseError | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += POSTGREST_ID_BATCH_SIZE) {
    batches.push(ids.slice(index, index + POSTGREST_ID_BATCH_SIZE));
  }
  const results = await Promise.all(batches.map((batch) => fetchBatch(batch)));
  results.forEach((result) => throwIfError(result.error));
  return results.flatMap((result) => result.data ?? []);
}

interface ReviewCandidateDescriptor {
  propertyId: string;
  score: number | null;
  contradictions: string[];
}

function reviewCandidateDescriptors(
  details: Record<string, unknown>,
): ReviewCandidateDescriptor[] {
  if (!Array.isArray(details.candidates)) return [];
  return details.candidates.slice(0, 10).flatMap((candidate) => {
    if (typeof candidate === "string" && candidate) {
      return [{ propertyId: candidate, score: null, contradictions: [] }];
    }
    const candidateRecord = record(candidate);
    const propertyId = stringValue(candidateRecord.propertyId);
    return propertyId
      ? [
          {
            propertyId,
            score: numberValue(candidateRecord.score),
            contradictions: stringList(candidateRecord.contradictions),
          },
        ]
      : [];
  });
}

function newest<T>(
  values: T[],
  timestamp: (value: T) => string,
): T | null {
  return (
    [...values].sort(
      (left, right) =>
        new Date(timestamp(right)).getTime() - new Date(timestamp(left)).getTime(),
    )[0] ?? null
  );
}

export class PropertyLifecycleReadRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async propertiesByIds(ids: string[]): Promise<PropertyRow[]> {
    return rowsByIdBatches<PropertyRow>(ids, async (batch) => {
      const { data, error } = await this.db
        .from("properties")
        .select(
          "id,building_id,primary_location_id,property_type,identity_status,sale_status,property_state,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,relaunch_count,first_seen_at,last_seen_at,representative_image_paths,canonical_attributes",
        )
        .in("id", batch);
      return { data: data as PropertyRow[] | null, error };
    });
  }

  private async hydrateProperties(
    properties: PropertyRow[],
  ): Promise<LifecyclePropertySummary[]> {
    if (properties.length === 0) return [];
    const propertyIds = properties.map((property) => property.id);
    const [agencyListings, privatePublications] = await Promise.all([
      rowsByIdBatches<AgencyListingRow>(propertyIds, async (batch) => {
        const { data, error } = await this.db
          .from("agency_listings")
          .select(
            "id,agency_id,property_id,agency_reference,state,first_seen_at,last_seen_at",
          )
          .in("property_id", batch);
        return { data: data as AgencyListingRow[] | null, error };
      }),
      rowsByIdBatches<PrivatePublicationRow>(propertyIds, async (batch) => {
        const { data, error } = await this.db
          .from("private_publications")
          .select(
            "id,legacy_listing_id,property_id,source,canonical_url,state,identity_outcome,identity_score,title,price_amount,surface_sqm,rooms,first_seen_at,last_seen_at,removed_at",
          )
          .in("property_id", batch);
        return { data: data as PrivatePublicationRow[] | null, error };
      }),
    ]);
    const agencyIds = unique(agencyListings.map((listing) => listing.agency_id));
    const agencyListingIds = agencyListings.map((listing) => listing.id);
    const [agencyResult, publicationRows] = await Promise.all([
      agencyIds.length
        ? this.db
            .from("agencies")
            .select("id,slug,name,website_url,enabled")
            .in("id", agencyIds)
        : Promise.resolve({ data: [], error: null }),
      rowsByIdBatches<{ id: string; agency_listing_id: string }>(
        agencyListingIds,
        async (batch) => {
          const { data, error } = await this.db
            .from("publications")
            .select("id,agency_listing_id")
            .in("agency_listing_id", batch);
          return {
            data: data as Array<{ id: string; agency_listing_id: string }> | null,
            error,
          };
        },
      ),
    ]);
    throwIfError(agencyResult.error);
    const agencies = (agencyResult.data ?? []) as AgencyRow[];
    const publicationIds = publicationRows.map((publication) => publication.id);
    const snapshots = await rowsByIdBatches<SnapshotRow>(
      publicationIds,
      async (batch) => {
        const { data, error } = await this.db
          .from("snapshots")
          .select("publication_id,title,price_amount,surface_sqm,rooms,observed_at")
          .in("publication_id", batch)
          .order("observed_at", { ascending: false })
          .limit(2_000);
        return { data: data as SnapshotRow[] | null, error };
      },
    );
    const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));
    const propertyByListing = new Map(
      agencyListings.map((listing) => [listing.id, listing.property_id]),
    );
    const propertyByPublication = new Map(
      publicationRows.map((publication) => [
        publication.id,
        propertyByListing.get(publication.agency_listing_id),
      ]),
    );

    return properties.map((property) => {
      const attributes = record(property.canonical_attributes);
      const propertyListings = agencyListings.filter(
        (listing) => listing.property_id === property.id,
      );
      const agencyRefs: LifecycleAgencyRef[] = propertyListings.flatMap((listing) => {
        const agency = agencyById.get(listing.agency_id);
        return agency
          ? [
              {
                id: agency.id,
                slug: agency.slug,
                name: agency.name,
                listingId: listing.id,
                state: listing.state,
                reference: listing.agency_reference,
                firstSeenAt: listing.first_seen_at,
                lastSeenAt: listing.last_seen_at,
              },
            ]
          : [];
      });
      const propertySnapshots = snapshots.filter(
        (snapshot) => propertyByPublication.get(snapshot.publication_id) === property.id,
      );
      const propertyPrivate = privatePublications.filter(
        (publication) => publication.property_id === property.id,
      );
      const latestSnapshot = newest(propertySnapshots, (snapshot) => snapshot.observed_at);
      const latestPrivate = newest(
        propertyPrivate,
        (publication) => publication.last_seen_at,
      );
      const snapshotIsNewest =
        latestSnapshot &&
        (!latestPrivate ||
          new Date(latestSnapshot.observed_at).getTime() >=
            new Date(latestPrivate.last_seen_at).getTime());
      const current = snapshotIsNewest ? latestSnapshot : latestPrivate;
      const address = stringValue(attributes.address);
      const locality = stringValue(attributes.locality);
      const fallbackTitle = [property.property_type, address ?? locality]
        .filter(Boolean)
        .join(" · ");
      return {
        id: property.id,
        title:
          (current && "title" in current ? current.title : null) ||
          fallbackTitle ||
          "Immobile da identificare",
        address,
        locality,
        propertyType:
          property.property_type ?? stringValue(attributes.propertyType),
        surfaceSqm:
          (current && "surface_sqm" in current
            ? numberValue(current.surface_sqm)
            : null) ?? numberValue(attributes.surfaceSqm),
        rooms:
          (current && "rooms" in current ? numberValue(current.rooms) : null) ??
          numberValue(attributes.rooms),
        currentPrice:
          current && "price_amount" in current
            ? numberValue(current.price_amount)
            : null,
        propertyState: property.property_state,
        saleStatus: property.sale_status,
        identityStatus: property.identity_status,
        trueMarketStartLowerBound: property.true_market_start_lower_bound,
        trueMarketStartUpperBound: property.true_market_start_upper_bound,
        trueMarketStartMethod: property.true_market_start_method,
        trueMarketStartConfidence: numberValue(
          property.true_market_start_confidence,
        ),
        relaunchCount: property.relaunch_count,
        firstSeenAt: property.first_seen_at,
        lastSeenAt: property.last_seen_at,
        representativeImagePaths: property.representative_image_paths ?? [],
        agencies: agencyRefs,
        activePrivateCount: propertyPrivate.filter(
          (publication) => publication.state === "ACTIVE",
        ).length,
      };
    });
  }

  private async opportunityItems(
    rows: Array<{
      id: string;
      property_id: string;
      level: string;
      status: string;
      score: number | string | null;
      detected_at: string;
      reasons: unknown;
      evidence_summary: unknown;
    }>,
  ): Promise<LifecycleOpportunityItem[]> {
    const properties = await this.hydrateProperties(
      await this.propertiesByIds(unique(rows.map((row) => row.property_id))),
    );
    const byId = new Map(properties.map((property) => [property.id, property]));
    return rows.flatMap((row) => {
      const property = byId.get(row.property_id);
      return property
        ? [
            {
              id: row.id,
              propertyId: row.property_id,
              level: row.level,
              status: row.status,
              score: numberValue(row.score),
              detectedAt: row.detected_at,
              reasons: stringList(row.reasons),
              evidenceSummary: record(row.evidence_summary),
              property,
            },
          ]
        : [];
    });
  }

  async dashboard(): Promise<LifecycleDashboard> {
    const activeStates = [
      "ACTIVE_AGENCY",
      "ACTIVE_PRIVATE",
      "ACTIVE_MULTI_AGENCY",
      "ACTIVE_AGENCY_AND_PRIVATE",
    ];
    const [total, active, hot, reviews, privateCount, events, opportunities] =
      await Promise.all([
        this.db.from("properties").select("id", { count: "exact", head: true }),
        this.db
          .from("properties")
          .select("id", { count: "exact", head: true })
          .in("property_state", activeStates),
        this.db
          .from("opportunities")
          .select("id", { count: "exact", head: true })
          .eq("status", "OPEN")
          .in("level", ["HOT", "HIGH"]),
        this.db
          .from("review_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["OPEN", "IN_REVIEW"]),
        this.db
          .from("private_publications")
          .select("id", { count: "exact", head: true })
          .eq("state", "ACTIVE"),
        this.db
          .from("events")
          .select("id,property_id,event_type,occurred_at,confidence,actor_type,payload")
          /* Solo i movimenti veri: senza questo filtro le ultime righe erano
           * tutte del primo censimento e i ribassi non si vedevano mai. */
          .in("event_type", MARKET_EVENT_TYPES)
          .order("occurred_at", { ascending: false })
          .limit(24),
        this.db
          .from("opportunities")
          .select(
            "id,property_id,level,status,score,detected_at,reasons,evidence_summary",
          )
          .eq("status", "OPEN")
          .in("level", ["HOT", "HIGH", "INTERESTING"])
          .order("score", { ascending: false })
          .limit(8),
      ]);
    [total, active, hot, reviews, privateCount, events, opportunities].forEach(
      (result) => throwIfError(result.error),
    );
    const eventRows = (events.data ?? []) as Array<{
      id: string;
      property_id: string;
      event_type: string;
      occurred_at: string;
      confidence: number | string;
      actor_type: string;
      payload: unknown;
    }>;
    const eventProperties = await this.hydrateProperties(
      await this.propertiesByIds(unique(eventRows.map((row) => row.property_id))),
    );
    const propertyById = new Map(
      eventProperties.map((property) => [property.id, property]),
    );
    const recentEvents: LifecycleEventItem[] = eventRows.flatMap((row) => {
      const property = propertyById.get(row.property_id);
      return property
        ? [
            {
              id: row.id,
              propertyId: row.property_id,
              eventType: row.event_type,
              occurredAt: row.occurred_at,
              confidence: numberValue(row.confidence) ?? 0,
              actorType: row.actor_type,
              payload: record(row.payload),
              property,
            },
          ]
        : [];
    });
    return {
      metrics: {
        totalProperties: total.count ?? 0,
        activeProperties: active.count ?? 0,
        hotOpportunities: hot.count ?? 0,
        openReviews: reviews.count ?? 0,
        activePrivate: privateCount.count ?? 0,
      },
      recentEvents,
      priorityOpportunities: await this.opportunityItems(
        (opportunities.data ?? []) as Parameters<
          PropertyLifecycleReadRepository["opportunityItems"]
        >[0],
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  async opportunities(): Promise<LifecycleOpportunityItem[]> {
    const { data, error } = await this.db
      .from("opportunities")
      .select("id,property_id,level,status,score,detected_at,reasons,evidence_summary")
      .eq("status", "OPEN")
      .order("score", { ascending: false })
      .limit(200);
    throwIfError(error);
    return this.opportunityItems(
      (data ?? []) as Parameters<
        PropertyLifecycleReadRepository["opportunityItems"]
      >[0],
    );
  }

  async agencies(): Promise<LifecycleAgencySummary[]> {
    const [agencyResult, listingResult, healthResult, syncResult] = await Promise.all([
      this.db
        .from("agencies")
        .select("id,slug,name,website_url,enabled")
        .order("name"),
      this.db.from("agency_listings").select("id,agency_id,state"),
      this.db
        .from("adapter_health")
        .select("agency_id,state,checked_at")
        .order("checked_at", { ascending: false })
        .limit(1_000),
      this.db
        .from("sync_runs")
        .select(
          "agency_id,status,started_at,finished_at,discovered_count,in_scope_count,excluded_count,error_count",
        )
        .order("started_at", { ascending: false })
        .limit(1_000),
    ]);
    [agencyResult, listingResult, healthResult, syncResult].forEach((result) =>
      throwIfError(result.error),
    );
    const agencies = (agencyResult.data ?? []) as AgencyRow[];
    const listings = (listingResult.data ?? []) as Array<{
      agency_id: string;
      state: string;
    }>;
    const health = (healthResult.data ?? []) as Array<{
      agency_id: string;
      state: string;
      checked_at: string;
    }>;
    const runs = (syncResult.data ?? []) as Array<{
      agency_id: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      discovered_count: number;
      in_scope_count: number;
      excluded_count: number;
      error_count: number;
    }>;
    return agencies.map((agency) => {
      const agencyListings = listings.filter((row) => row.agency_id === agency.id);
      const latestHealth = health.find((row) => row.agency_id === agency.id);
      const latestRun = runs.find((row) => row.agency_id === agency.id);
      return {
        id: agency.id,
        slug: agency.slug,
        name: agency.name,
        websiteUrl: agency.website_url,
        enabled: agency.enabled,
        activeCount: agencyListings.filter((row) => row.state === "ACTIVE").length,
        exitedCount: agencyListings.filter((row) =>
          [
            "EXIT_PENDING",
            "CLOSED_SWITCHED",
            "CLOSED_TO_PRIVATE",
            "CLOSED_WITHDRAWN",
            "OFF_MARKET_NO_SALE_EVIDENCE",
          ].includes(row.state),
        ).length,
        soldCount: agencyListings.filter((row) => row.state === "CLOSED_SOLD").length,
        latestHealth: latestHealth?.state ?? null,
        latestHealthAt: latestHealth?.checked_at ?? null,
        latestSyncStatus: latestRun?.status ?? null,
        latestSyncAt: latestRun?.finished_at ?? latestRun?.started_at ?? null,
        latestSyncCounts: latestRun
          ? {
              discovered: latestRun.discovered_count,
              inScope: latestRun.in_scope_count,
              excluded: latestRun.excluded_count,
              errors: latestRun.error_count,
            }
          : null,
      };
    });
  }

  async agency(slug: string): Promise<LifecycleAgencyDetail | null> {
    const agencies = await this.agencies();
    const agency = agencies.find((item) => item.slug === slug);
    if (!agency) return null;
    const [listingResult, runResult] = await Promise.all([
      this.db
        .from("agency_listings")
        .select(
          "id,agency_id,property_id,agency_reference,state,first_seen_at,last_seen_at",
        )
        .eq("agency_id", agency.id)
        .order("last_seen_at", { ascending: false }),
      this.db
        .from("sync_runs")
        .select(
          "id,mode,status,health_state,started_at,finished_at,discovered_count,in_scope_count,excluded_count,error_count,transitioned_count",
        )
        .eq("agency_id", agency.id)
        .order("started_at", { ascending: false })
        .limit(12),
    ]);
    throwIfError(listingResult.error);
    throwIfError(runResult.error);
    const listings = (listingResult.data ?? []) as AgencyListingRow[];
    const propertyIds = unique(listings.map((listing) => listing.property_id));
    const inventory = await this.hydrateProperties(await this.propertiesByIds(propertyIds));
    const eventResult = propertyIds.length
      ? await this.db
          .from("events")
          .select("property_id,event_type")
          .in("property_id", propertyIds)
          .in("event_type", ["NEW_LISTING", "PRICE_DROP"])
      : { data: [], error: null };
    throwIfError(eventResult.error);
    const events = (eventResult.data ?? []) as Array<{
      property_id: string;
      event_type: string;
    }>;
    return {
      agency,
      inventory,
      priceReducedPropertyIds: unique(
        events
          .filter((event) => event.event_type === "PRICE_DROP")
          .map((event) => event.property_id),
      ),
      newPropertyIds: unique(
        events
          .filter((event) => event.event_type === "NEW_LISTING")
          .map((event) => event.property_id),
      ),
      recentRuns: ((runResult.data ?? []) as Array<Record<string, unknown>>).map(
        (run) => ({
          id: String(run.id),
          mode: String(run.mode),
          status: String(run.status),
          healthState: stringValue(run.health_state),
          startedAt: String(run.started_at),
          finishedAt: stringValue(run.finished_at),
          discoveredCount: numberValue(run.discovered_count) ?? 0,
          inScopeCount: numberValue(run.in_scope_count) ?? 0,
          excludedCount: numberValue(run.excluded_count) ?? 0,
          errorCount: numberValue(run.error_count) ?? 0,
          transitionedCount: numberValue(run.transitioned_count) ?? 0,
        }),
      ),
    };
  }

  async archive(): Promise<LifecyclePropertySummary[]> {
    const { data, error } = await this.db
      .from("properties")
      .select(
        "id,building_id,primary_location_id,property_type,identity_status,sale_status,property_state,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,relaunch_count,first_seen_at,last_seen_at,representative_image_paths,canonical_attributes",
      )
      .neq("identity_status", "MERGED")
      .order("last_seen_at", { ascending: false })
      /* 575 proprietà osservate: con 300 l'archivio ne nascondeva metà. */
      .limit(1000);
    throwIfError(error);
    return this.hydrateProperties((data ?? []) as PropertyRow[]);
  }

  /**
   * Le case che corrispondono a una parola.
   *
   * L'indirizzo del mercato non è affidabile — spesso è il titolone
   * dell'annuncio — quindi si cerca su due lati: quello che il portale ha
   * scritto come indirizzo, e quello che la risoluzione della posizione ha
   * capito. Le due liste si uniscono per id.
   */
  async searchProperties(term: string, limit = 12): Promise<LifecyclePropertySummary[]> {
    const parola = term.trim();
    if (parola.length < 2) return [];

    const modello = `%${parola}%`;

    const [perIndirizzo, posizioni] = await Promise.all([
      this.db
        .from("properties")
        .select("id")
        .neq("identity_status", "MERGED")
        .ilike("canonical_attributes->>address", modello)
        .limit(limit),
      this.db
        .from("locations")
        .select("id")
        .or(`raw_text.ilike.${modello},street_name.ilike.${modello},locality.ilike.${modello}`)
        .limit(limit * 3),
    ]);

    throwIfError(perIndirizzo.error);
    throwIfError(posizioni.error);

    const idPosizioni = ((posizioni.data ?? []) as Array<{ id: string }>).map((riga) => riga.id);
    let perPosizione: string[] = [];

    if (idPosizioni.length) {
      const { data, error } = await this.db
        .from("properties")
        .select("id")
        .neq("identity_status", "MERGED")
        .in("primary_location_id", idPosizioni)
        .limit(limit);
      throwIfError(error);
      perPosizione = ((data ?? []) as Array<{ id: string }>).map((riga) => riga.id);
    }

    const ids = unique([
      ...((perIndirizzo.data ?? []) as Array<{ id: string }>).map((riga) => riga.id),
      ...perPosizione,
    ]).slice(0, limit);

    if (!ids.length) return [];

    return this.hydrateProperties(await this.propertiesByIds(ids));
  }

  /**
   * I movimenti di mercato, indietro nel tempo.
   *
   * `dashboard()` ne restituisce gli ultimi ventiquattro, che bastano a dire
   * cosa è successo oggi. Per il giorno-per-giorno serve la storia.
   */
  async marketEvents(limit = 300): Promise<LifecycleEventItem[]> {
    const { data, error } = await this.db
      .from("events")
      .select("id,property_id,event_type,occurred_at,confidence,actor_type,payload")
      .in("event_type", MARKET_EVENT_TYPES)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    throwIfError(error);

    const rows = (data ?? []) as Array<{
      id: string;
      property_id: string;
      event_type: string;
      occurred_at: string;
      confidence: number | string;
      actor_type: string;
      payload: unknown;
    }>;

    const properties = await this.hydrateProperties(
      await this.propertiesByIds(unique(rows.map((row) => row.property_id))),
    );
    const byId = new Map(properties.map((property) => [property.id, property]));

    return rows.flatMap((row) => {
      const property = byId.get(row.property_id);
      if (!property) return [];

      return [
        {
          id: row.id,
          propertyId: row.property_id,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          confidence: numberValue(row.confidence) ?? 0,
          actorType: row.actor_type,
          payload: record(row.payload),
          property,
        },
      ];
    });
  }

  async reviews(): Promise<LifecycleReviewItem[]> {
    const { data, error } = await this.db
      .from("review_queue")
      .select(
        "id,review_type,status,priority,title,details,created_at,property_id,agency_id",
      )
      .in("status", ["OPEN", "IN_REVIEW"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(200);
    throwIfError(error);
    const rows = (data ?? []) as Array<{
      id: string;
      review_type: string;
      status: string;
      priority: number;
      title: string;
      details: unknown;
      created_at: string;
      property_id: string | null;
      agency_id: string | null;
    }>;
    const detailsByReviewId = new Map(
      rows.map((row) => [row.id, record(row.details)]),
    );
    const candidatesByReviewId = new Map(
      rows.map((row) => [
        row.id,
        reviewCandidateDescriptors(detailsByReviewId.get(row.id) ?? {}),
      ]),
    );
    const candidatePropertyIds = [...candidatesByReviewId.values()].flatMap(
      (candidates) => candidates.map((candidate) => candidate.propertyId),
    );
    const [properties, agencyResult] = await Promise.all([
      this.hydrateProperties(
        await this.propertiesByIds(
          unique([...rows.map((row) => row.property_id), ...candidatePropertyIds]),
        ),
      ),
      rows.some((row) => row.agency_id)
        ? this.db
            .from("agencies")
            .select("id,slug,name,website_url,enabled")
            .in("id", unique(rows.map((row) => row.agency_id)))
        : Promise.resolve({ data: [], error: null }),
    ]);
    throwIfError(agencyResult.error);
    const propertyById = new Map(properties.map((property) => [property.id, property]));
    const agencyById = new Map(
      ((agencyResult.data ?? []) as AgencyRow[]).map((agency) => [agency.id, agency]),
    );
    const hydrated = rows.map((row): LifecycleReviewItem & { candidateCount: number } => {
      const property = row.property_id ? propertyById.get(row.property_id) ?? null : null;
      const candidateDescriptors = candidatesByReviewId.get(row.id) ?? [];
      const candidates = candidateDescriptors.flatMap((candidate) => {
        const property = propertyById.get(candidate.propertyId);
        return property ? [{ ...candidate, property }] : [];
      });
      const evaluation =
        row.review_type === "IDENTITY" && property
          ? evaluateIdentityReviewCandidates(property, candidates)
          : {
              candidates,
              automaticExclusions: { count: 0, reasons: {} },
            };
      return {
        id: row.id,
        reviewType: row.review_type,
        status: row.status,
        priority: row.priority,
        title: row.title,
        details: detailsByReviewId.get(row.id) ?? {},
        createdAt: row.created_at,
        property,
        agencyName: row.agency_id ? agencyById.get(row.agency_id)?.name ?? null : null,
        ...evaluation,
        candidateCount: candidateDescriptors.length,
      };
    });

    return hydrated.filter(
      (review) =>
        review.reviewType !== "IDENTITY" ||
        !review.property ||
        review.candidateCount === 0 ||
        review.candidates.length > 0,
    );
  }

  async privateRadar(): Promise<LifecyclePrivatePublication[]> {
    const { data, error } = await this.db
      .from("private_publications")
      .select(
        "id,legacy_listing_id,property_id,source,canonical_url,state,identity_outcome,identity_score,title,price_amount,surface_sqm,rooms,first_seen_at,last_seen_at,removed_at",
      )
      .order("last_seen_at", { ascending: false })
      .limit(300);
    throwIfError(error);
    const rows = (data ?? []) as PrivatePublicationRow[];
    const properties = await this.hydrateProperties(
      await this.propertiesByIds(unique(rows.map((row) => row.property_id))),
    );
    const propertyById = new Map(properties.map((property) => [property.id, property]));
    return rows.flatMap((row) => {
      const property = propertyById.get(row.property_id);
      return property
        ? [
            {
              id: row.id,
              legacyListingId: row.legacy_listing_id,
              source: row.source,
              canonicalUrl: row.canonical_url,
              state: row.state,
              identityOutcome: row.identity_outcome,
              identityScore: numberValue(row.identity_score) ?? 0,
              title: row.title,
              price: row.price_amount,
              surfaceSqm: numberValue(row.surface_sqm),
              rooms: numberValue(row.rooms),
              firstSeenAt: row.first_seen_at,
              lastSeenAt: row.last_seen_at,
              removedAt: row.removed_at,
              property,
            },
          ]
        : [];
    });
  }

  async property(id: string): Promise<LifecyclePropertyDetail | null> {
    const properties = await this.propertiesByIds([id]);
    const propertyRow = properties[0];
    if (!propertyRow) return null;
    const property = (await this.hydrateProperties(properties))[0];
    const agencyListingIds = property.agencies.map((agency) => agency.listingId);
    const [publicationResult, privateResult, eventResult, evidenceResult, opportunityResult] =
      await Promise.all([
        agencyListingIds.length
          ? this.db
              .from("publications")
              .select(
                "id,agency_listing_id,source_key,canonical_url,state,source_status,first_seen_at,last_seen_at",
              )
              .in("agency_listing_id", agencyListingIds)
              .order("last_seen_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        this.db
          .from("private_publications")
          .select(
            "id,legacy_listing_id,property_id,source,canonical_url,state,identity_outcome,identity_score,title,price_amount,surface_sqm,rooms,first_seen_at,last_seen_at,removed_at",
          )
          .eq("property_id", id)
          .order("last_seen_at", { ascending: false }),
        this.db
          .from("events")
          .select("id,event_type,occurred_at,confidence,actor_type,payload")
          .eq("property_id", id)
          .order("occurred_at", { ascending: false })
          .limit(300),
        this.db
          .from("evidence")
          .select(
            "id,evidence_kind,claim_key,extraction_method,confidence,observed_at,source_recorded_at",
          )
          .eq("property_id", id)
          .order("observed_at", { ascending: false })
          .limit(200),
        this.db
          .from("opportunities")
          .select(
            "id,property_id,level,status,score,detected_at,reasons,evidence_summary",
          )
          .eq("property_id", id)
          .maybeSingle(),
      ]);
    [
      publicationResult,
      privateResult,
      eventResult,
      evidenceResult,
      opportunityResult,
    ].forEach((result) => throwIfError(result.error));
    const privateRows = (privateResult.data ?? []) as PrivatePublicationRow[];
    const targetIds = unique([
      id,
      ...agencyListingIds,
      ...((publicationResult.data ?? []) as Array<{ id: string }>).map((row) => row.id),
      ...privateRows.map((row) => row.id),
    ]);
    const [locationResult, buildingResult, overrideResult] = await Promise.all([
      propertyRow.primary_location_id
        ? this.db
            .from("locations")
            .select(
              "raw_text,municipality,locality,street_name,street_number,latitude,longitude,precision_level,resolution_confidence,manually_verified",
            )
            .eq("id", propertyRow.primary_location_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      propertyRow.building_id
        ? this.db
            .from("buildings")
            .select("id,display_name")
            .eq("id", propertyRow.building_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.db
        .from("manual_overrides")
        .select(
          "id,target_type,target_id,override_key,override_value,previous_value,reason,source,effective_at",
        )
        .in("target_id", targetIds)
        .order("effective_at", { ascending: false }),
    ]);
    [locationResult, buildingResult, overrideResult].forEach((result) =>
      throwIfError(result.error),
    );
    const imagePaths = property.representativeImagePaths.slice(0, 2);
    const signedImages = imagePaths.length
      ? await this.db.storage
          .from("property-lifecycle-visuals")
          .createSignedUrls(imagePaths, 60 * 30)
      : { data: [], error: null };
    const eventRows = (eventResult.data ?? []) as Array<Record<string, unknown>>;
    const opportunityRows = opportunityResult.data
      ? await this.opportunityItems([
          opportunityResult.data as Parameters<
            PropertyLifecycleReadRepository["opportunityItems"]
          >[0][number],
        ])
      : [];
    const agencyByListing = new Map(
      property.agencies.map((agency) => [agency.listingId, agency.name]),
    );
    const privatePublications: LifecyclePrivatePublication[] = privateRows.map(
      (row) => ({
        id: row.id,
        legacyListingId: row.legacy_listing_id,
        source: row.source,
        canonicalUrl: row.canonical_url,
        state: row.state,
        identityOutcome: row.identity_outcome,
        identityScore: numberValue(row.identity_score) ?? 0,
        title: row.title,
        price: row.price_amount,
        surfaceSqm: numberValue(row.surface_sqm),
        rooms: numberValue(row.rooms),
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        removedAt: row.removed_at,
        property,
      }),
    );
    const location = locationResult.data as Record<string, unknown> | null;
    const building = buildingResult.data as { id: string; display_name: string | null } | null;
    return {
      property,
      location: location
        ? {
            rawText: stringValue(location.raw_text),
            municipality: stringValue(location.municipality),
            locality: stringValue(location.locality),
            streetName: stringValue(location.street_name),
            streetNumber: stringValue(location.street_number),
            latitude: numberValue(location.latitude),
            longitude: numberValue(location.longitude),
            precision: String(location.precision_level),
            confidence: numberValue(location.resolution_confidence),
            manuallyVerified: Boolean(location.manually_verified),
          }
        : null,
      building: building
        ? { id: building.id, displayName: building.display_name }
        : null,
      publications: (
        (publicationResult.data ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: String(row.id),
        agencyName: agencyByListing.get(String(row.agency_listing_id)) ?? "Agenzia",
        sourceKey: String(row.source_key),
        canonicalUrl: String(row.canonical_url),
        state: String(row.state),
        sourceStatus: String(row.source_status),
        firstSeenAt: String(row.first_seen_at),
        lastSeenAt: String(row.last_seen_at),
      })),
      privatePublications,
      events: eventRows.map((row) => ({
        id: String(row.id),
        eventType: String(row.event_type),
        occurredAt: String(row.occurred_at),
        confidence: numberValue(row.confidence) ?? 0,
        actorType: String(row.actor_type),
        payload: record(row.payload),
      })),
      evidence: ((evidenceResult.data ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          kind: String(row.evidence_kind),
          claimKey: String(row.claim_key),
          extractionMethod: String(row.extraction_method),
          confidence: numberValue(row.confidence) ?? 0,
          observedAt: String(row.observed_at),
          sourceRecordedAt: stringValue(row.source_recorded_at),
        }),
      ),
      priceHistory: eventRows
        .filter((row) => ["PRICE_DROP", "PRICE_INCREASE"].includes(String(row.event_type)))
        .map((row) => ({
          eventType: String(row.event_type),
          occurredAt: String(row.occurred_at),
          oldPrice: numberValue(record(row.payload).oldPrice),
          newPrice: numberValue(record(row.payload).newPrice),
        })),
      opportunity: opportunityRows[0] ?? null,
      manualOverrides: (
        (overrideResult.data ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: String(row.id),
        targetType: String(row.target_type),
        targetId: String(row.target_id),
        key: String(row.override_key),
        value: row.override_value,
        previousValue: row.previous_value,
        reason: String(row.reason),
        source: String(row.source),
        effectiveAt: String(row.effective_at),
      })),
      imageUrls: (signedImages.data ?? []).flatMap((item) =>
        item.signedUrl ? [item.signedUrl] : [],
      ),
    };
  }
}
