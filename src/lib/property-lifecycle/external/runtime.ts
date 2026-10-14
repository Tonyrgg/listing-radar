import type { SupabaseClient } from "@supabase/supabase-js";
import { processListingAssets } from "@/lib/property-lifecycle/assets/pipeline";
import { rehashNormalizedListing } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { emptyHealthBaseline, evaluateHealthBaseline, type AdapterHealthBaseline } from "@/lib/property-lifecycle/health/baseline";
import type { LifecycleJob } from "@/lib/property-lifecycle/jobs/queue";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { fetchWikicasaInventory, verifyExternalPublication, type ExternalObservation } from "./adapters";
import { ExternalPublicHttp, SourceAccessError } from "./http";
import { externalReviewResolution } from "./identity";
import { detailRequired, externalClaim, EXTERNAL_POLICY, EXTERNAL_SOURCES, type ExternalSource } from "./policy";

export function normalizedAgencyName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("it").replace(/\s+/g, " ");
}
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message); return result.data;
}
interface SourceConfig { source_key: ExternalSource; enabled: boolean; projections_enabled: boolean;
  inventory_roots: string[]; health_baseline: Partial<AdapterHealthBaseline> }
interface KnownPublication { id: string; external_id: string; external_inventory_marker: string | null;
  external_detail_at: string | null; external_projection_enabled: boolean | null; state: string; canonical_url: string }

async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499); const page = (checked(result) ?? []) as T[]; rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function runExternalSourceJob(db: SupabaseClient, job: LifecycleJob,
  fetcher: typeof fetch = fetch, assertOwnership: () => void = () => {}) {
  const source = String(job.payload.source ?? "").toUpperCase() as ExternalSource;
  if (!EXTERNAL_SOURCES.includes(source) || source === "SEARCH_INDEX") throw new Error("Unsupported external source job");
  const config = checked(await db.from("market_observer_sources").select("*").eq("source_key", source).single()) as SourceConfig;
  // Turning a flag off safely drains already-enqueued jobs without network or writes to publications.
  if (!config.enabled) return { skipped: "source_disabled" };
  const sourceRun = { id: checked(await db.rpc("start_market_external_source_run", { p_source_key: source, p_job_id: job.id })) as string };
  const http = new ExternalPublicHttp(fetcher); const repository = new PropertyLifecycleRepository(db);
  const observedAt = new Date().toISOString();
  const counts = { discovered_count: 0, detail_fetch_count: 0, confirmed_seen_count: 0, review_count: 0 };
  let inventoryComplete = false; let baselineReady = false; let fingerprint = "targeted-verifier-v1";
  let state = "HEALTHY"; const reasons: string[] = [];
  const detailErrors: string[] = [];
  let nextConfigRefresh = Date.now() + EXTERNAL_POLICY.configRefreshMs;
  const refreshFlags = async () => {
    if (Date.now() < nextConfigRefresh) return;
    const flags = checked(await db.from("market_observer_sources").select("enabled,projections_enabled").eq("source_key",source).single()) as { enabled:boolean;projections_enabled:boolean };
    if (!flags.enabled) throw new Error("External source disabled");
    config.projections_enabled=flags.projections_enabled;
    nextConfigRefresh=Date.now()+EXTERNAL_POLICY.configRefreshMs;
  };
  let registry: Promise<Array<{ agency_id:string;external_agency_id:string|null;normalized_name:string|null }>> | undefined;
  const agencyCache = new Map<string,Promise<{ id:string;slug:string;market_role:string }>>();
  const review = async (key: string, title: string, details: Record<string, unknown>, reviewType="DATA_QUALITY") => {
    checked(await db.from("review_queue").upsert({ review_type: reviewType, status: "OPEN", title, details,
      agency_id:typeof details.agencyId === "string" ? details.agencyId : null,
      dedupe_key: `external:${source}:${key}` }, { onConflict: "dedupe_key" })); counts.review_count++;
  };
  const retainKnownEvidence = async (observation: ExternalObservation, target: { propertyId: string; publicationId: string }) => {
    assertOwnership();
    const claims = observation.claims.map(claim => ({ ...claim, metadata: { ...claim.metadata,
      targetedVerification: true, attribution: "KNOWN_PUBLICATION_URL", agencyResolution: "REVIEW_REQUIRED" } }));
    checked(await db.rpc("market_external_claims_atomic", { p_property_id: target.propertyId, p_publication_id: target.publicationId,
      p_sync_run_id: null, p_source_key: source, p_claims: claims, p_observed_at: observation.listing.observedAt }));
    // Preserve verifiable facts, without changing current presence, agency or the commercial state.
    state = "DEGRADED"; reasons.push("known_publication_evidence_requires_agency_review");
  };
  const ingest = async (observation: ExternalObservation, marker: string | null, target?: { agencyId: string; propertyId: string; publicationId: string }) => {
    assertOwnership();
    const { listing } = observation;
    if (listing.location.scope !== "IN_SCOPE" || listing.source.transactionType !== "SALE") {
      if (listing.location.scope === "REVIEW") await review(listing.source.externalId, "Località della publication esterna da verificare", { url: listing.source.canonicalUrl, source, reasons: listing.location.reasons });
      return;
    }
    registry ??= paged<{ agency_id: string; external_agency_id: string | null; normalized_name: string | null }>((from, to) =>
      db.from("market_observer_agency_identities").select("agency_id,external_agency_id,normalized_name").eq("source_key", source).order("id").range(from, to));
    const identities = await registry;
    const mapped = [...new Set(identities.filter(i =>
      (observation.agency.externalId != null && i.external_agency_id === observation.agency.externalId) ||
      (observation.agency.name != null && i.normalized_name === normalizedAgencyName(observation.agency.name))).map(i => i.agency_id))];
    if (mapped.length !== 1) {
      await review(listing.source.externalId, "Agenzia della publication esterna da collegare", { source, agency: observation.agency,
        url: listing.source.canonicalUrl, observedAt: listing.observedAt, claims: observation.claims, normalizedListing:listing, ambiguousMapping: mapped });
      if (target) await retainKnownEvidence(observation,target);
      return;
    }
    if (target && mapped[0] !== target.agencyId) {
      await review(listing.source.externalId, "Agenzia diversa sulla publication nota", { source, target, agency: observation.agency, mapped });
      await retainKnownEvidence(observation,target);
      return;
    }
    if (!agencyCache.has(mapped[0])) agencyCache.set(mapped[0],Promise.resolve(db.from("agencies").select("id,slug,market_role").eq("id",mapped[0]).single())
      .then(result=>checked(result) as { id:string;slug:string;market_role:string }));
    const agency = await agencyCache.get(mapped[0])!;
    const situato = rehashNormalizedListing(listing, input => ({ ...input, source: { ...input.source, agencySlug: agency.slug } }));
    // Perceptual hashes use the existing pipeline in DEEP mode only. FAST still uses address/civic/description/etc.
    const assets = job.payload.deep === true ? (await processListingAssets(situato)).assets : [];
    const priorReview=checked(await db.from("review_queue").select("status,resolution,details")
      .eq("dedupe_key",`external:${source}:${listing.source.externalId}`).maybeSingle()) as {
        status:string;resolution:{decision?:string;candidatePropertyId?:string}|null;
        details:{agencyId?:string;candidates?:Array<{propertyId:string}>}|null } | null;
    const human=externalReviewResolution(priorReview,agency.id);
    let approvedProperty:string|null=null;
    if(human.propertyId) {
      const candidate=checked(await db.from("properties").select("id").eq("id",human.propertyId).neq("identity_status","MERGED").single()) as {id:string};
      approvedProperty=candidate.id;
    }
    const decidedProperty=target?.propertyId ?? approvedProperty;
    const decision = decidedProperty ? { outcome: "AUTO_MATCH" as const, propertyId: decidedProperty, score: 1, margin: 1, candidates: [] }
      : await repository.resolveExternalIdentity(agency.id, situato, assets,human.excluded);
    if (decision.outcome === "REVIEW_REQUIRED") {
      await review(listing.source.externalId, "Possibile corrispondenza fra publication e casa", { source, agencyId: agency.id,
        url: listing.source.canonicalUrl, decision, candidates:decision.candidates, claims: observation.claims, normalizedListing: situato },"IDENTITY"); return;
    }
    assertOwnership();
    const persisted = checked(await db.rpc("persist_market_external_observation_atomic", { p_source_key: source, p_agency_id: agency.id,
      p_listing: situato, p_identity_decision: decision, p_claims: observation.claims, p_marker: marker,
      p_processed_assets: assets.map(({ representativeThumbnail, ...asset }) => { void representativeThumbnail; return asset; }) })) as { createdProperty?: boolean };
    if (persisted.createdProperty) repository.invalidateExternalIdentityCatalog(agency.id);
  };
  try {
    if (job.job_type === "SYNC_MARKET_SOURCE") {
      if (source !== "WIKICASA") throw new Error("Only Wikicasa has a geographically scoped inventory contract");
      const inventory = await fetchWikicasaInventory(http, config.inventory_roots, async()=>{assertOwnership();await refreshFlags();});
      assertOwnership();
      counts.discovered_count = inventory.items.length; fingerprint = inventory.fingerprint;
      const health = evaluateHealthBaseline({ baseline: { ...emptyHealthBaseline(), ...config.health_baseline },
        sourceState: inventory.state, sourceComplete: inventory.complete, observedCount: inventory.items.length, structureFingerprint: fingerprint });
      inventoryComplete = health.inventoryComplete; baselineReady = health.baselineReady; state = health.effectiveState;
      reasons.push(...inventory.reasons, ...health.reasons);
      checked(await db.from("market_observer_sources").update({ health_baseline: health.next }).eq("source_key", source));
      const known = await paged<KnownPublication>((from, to) => db.from("publications")
        .select("id,external_id,external_inventory_marker,external_detail_at,external_projection_enabled,state,canonical_url")
        .eq("external_source_key", source).order("id").range(from, to));
      const byId = new Map(known.map(p => [p.external_id, p]));
      for (const item of inventory.items) {
        await refreshFlags();
        assertOwnership(); const previous = byId.get(item.externalId);
        if (!detailRequired({ known: Boolean(previous), previousMarker: previous?.external_inventory_marker ?? null, marker: item.marker,
          lastDetailAt: previous?.external_detail_at ?? null, now: observedAt, deep: job.payload.deep === true,
          exitVerification: previous != null && previous.state !== "ACTIVE", policyChanged: previous?.external_projection_enabled !== config.projections_enabled })) {
          checked(await db.rpc("confirm_market_external_presence_atomic", { p_source_key: source, p_external_id: item.externalId, p_marker: item.marker, p_at: observedAt }));
          counts.confirmed_seen_count++; continue;
        }
        try { counts.detail_fetch_count++; await ingest(await verifyExternalPublication(http, source, item.url, new Date().toISOString()), item.marker); }
        catch (error) {
          if (error instanceof Error && /source disabled/i.test(error.message)) throw error;
          if (error instanceof SourceAccessError && ([401,403,429].includes(error.status ?? 0) ||
            ["source_unavailable","source_circuit_open","retry_after_requires_job_retry","challenge_page"].includes(error.reason))) throw error;
          detailErrors.push(`${item.externalId}:${error instanceof Error ? error.message : "detail_failed"}`);
        }
      }
    } else {
      // Resolve the known publication server-side. The job cannot supply an arbitrary URL or attach a sale to another property.
      const publicationId = String(job.payload.publicationId ?? "");
      const pub = checked(await db.from("publications").select("id,canonical_url,external_source_key,agency_id,agency_listing_id").eq("id", publicationId).single()) as {
        id: string; canonical_url: string; external_source_key: string | null; agency_id: string; agency_listing_id: string };
      if (pub.external_source_key && pub.external_source_key !== source) throw new Error("Verifier source mismatch");
      const relationship = checked(await db.from("agency_listings").select("property_id").eq("id",pub.agency_listing_id).single()) as { property_id: string };
      counts.discovered_count = 1; counts.detail_fetch_count = 1;
      try {
        await ingest(await verifyExternalPublication(http, source, pub.canonical_url, observedAt), null,
          { agencyId: pub.agency_id, propertyId: relationship.property_id, publicationId: pub.id });
      } catch (error) {
        if (!(error instanceof SourceAccessError) || ![404,410].includes(error.status ?? 0)) throw error;
        const claim = externalClaim({ source, url: pub.canonical_url, observedAt, method: "PRIMARY_HTTP",
          kind: "URL_UNAVAILABLE", key: "publication.urlUnavailable", raw: `HTTP ${error.status}`,
          value: { httpStatus: error.status, inventoryAbsence: false, sold: false }, confidence: EXTERNAL_POLICY.confidence.explicitStatus,
          metadata: { currentPresence: false, targetedVerification: true } });
        assertOwnership();
        checked(await db.rpc("market_external_claims_atomic", { p_property_id: relationship.property_id, p_publication_id: pub.id,
          p_sync_run_id: null, p_source_key: source, p_claims: [claim], p_observed_at: observedAt }));
        state="DEGRADED"; reasons.push("known_url_unavailable_not_inventory_absence");
      }
    }
    if (detailErrors.length) { state = "DEGRADED"; inventoryComplete = false; reasons.push("detail_failures"); }
    checked(await db.from("market_observer_source_runs").update({ ...counts, state, finished_at: new Date().toISOString(),
      inventory_complete: inventoryComplete, baseline_ready: baselineReady, absence_evaluation_allowed: false,
      diagnostics: { reasons, fingerprint, detailErrors, policyVersion: EXTERNAL_POLICY.version, observationOnly: true } }).eq("id", sourceRun.id));
    return { state, ...counts, absenceEvaluationAllowed: false };
  } catch (error) {
    if (source === "WIKICASA" && !(error instanceof Error && /source disabled/i.test(error.message))) {
      const failed = evaluateHealthBaseline({ baseline:{...emptyHealthBaseline(),...config.health_baseline},
        sourceState:"FAILED",sourceComplete:false,observedCount:0,structureFingerprint:fingerprint });
      checked(await db.from("market_observer_sources").update({health_baseline:failed.next}).eq("source_key",source));
    }
    checked(await db.from("market_observer_source_runs").update({ ...counts, state: "FAILED", finished_at: new Date().toISOString(),
      inventory_complete: false, absence_evaluation_allowed: false, diagnostics: { reasons: [error instanceof Error ? error.message : "source_failed"],
        responseStatus: error instanceof SourceAccessError ? error.status : null, fingerprint, policyVersion: EXTERNAL_POLICY.version } }).eq("id", sourceRun.id));
    throw error;
  }
}
