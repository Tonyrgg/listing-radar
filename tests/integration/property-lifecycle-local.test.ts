import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { HttpResponse } from "@/lib/http/client";
import { normalizeIconacasaDetail } from "@/lib/property-lifecycle/adapters/iconacasa";
import { normalizePuntoCasaDetail } from "@/lib/property-lifecycle/adapters/puntocasa";
import type {
  AdapterHealthResult,
  InventoryItem,
  InventoryResult,
  PropertyLifecycleAdapter,
  SourceDocument,
} from "@/lib/property-lifecycle/adapters/types";
import type {
  AdapterHealthState,
  NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import { LifecycleJobQueue } from "@/lib/property-lifecycle/jobs/queue";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { runAgencySync } from "@/lib/property-lifecycle/sync/engine";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "property-lifecycle");
const supabaseUrl = process.env.PROPERTY_LIFECYCLE_TEST_SUPABASE_URL;
const serviceRoleKey = process.env.PROPERTY_LIFECYCLE_TEST_SERVICE_ROLE_KEY;
const localConfiguration = Boolean(
  supabaseUrl &&
    serviceRoleKey &&
    ["127.0.0.1", "localhost", "::1"].includes(new URL(supabaseUrl).hostname),
);
const localDescribe = localConfiguration ? describe.sequential : describe.skip;

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function response(url: string, body: string): HttpResponse {
  return {
    body,
    headers: new Headers(),
    ok: true,
    status: 200,
    url,
  };
}

class FixtureAdapter implements PropertyLifecycleAdapter {
  readonly inventoryUrl = "https://fixture.invalid/inventory";

  constructor(
    readonly key: string,
    readonly agencySlug: string,
    private readonly items: InventoryItem[],
    private readonly details: Map<string, string>,
    private readonly normalizer: (document: SourceDocument) => NormalizedListingV2,
    private readonly state: AdapterHealthState = "HEALTHY",
    private readonly complete = true,
    private readonly observedAt = "2026-08-19T09:00:00.000Z",
  ) {}

  async fetchInventory(): Promise<InventoryResult> {
    const requiredMarkers = { fixture: true };
    return {
      items: this.items,
      healthState: this.state,
      complete: this.complete,
      structureFingerprint: `fixture-${this.key}-${this.state}`,
      diagnostics: {
        expectedCount: this.items.length,
        observedCount: this.items.length,
        duplicateCount: 0,
        parseErrorCount: 0,
        pagesVisited: 1,
        expectedPages: 1,
        requiredMarkers,
        reasons: [],
      },
      response: response(this.inventoryUrl, "fixture"),
    };
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    const inventory = await this.fetchInventory();
    return {
      state: inventory.healthState,
      complete: inventory.complete,
      structureFingerprint: inventory.structureFingerprint,
      diagnostics: inventory.diagnostics,
    };
  }

  async fetchDetail(item: InventoryItem): Promise<SourceDocument> {
    const body = this.details.get(item.sourceKey);
    if (!body) {
      throw new Error(`Missing fixture detail ${item.sourceKey}.`);
    }
    return { item, observedAt: this.observedAt, response: response(item.url, body) };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return this.normalizer(document);
  }
}

function iconacasaAdapter(
  state: AdapterHealthState = "HEALTHY",
  complete = true,
): FixtureAdapter {
  const activeUrl =
    "https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento";
  const soldUrl =
    "https://www.iconacasa.com/index.php/opportunita/property/45213-bitonto-vendita-villa";
  const items: InventoryItem[] =
    state === "HEALTHY" && complete
      ? [
          { sourceKey: "45212", externalId: "45212", url: activeUrl, summary: {} },
          { sourceKey: "45213", externalId: "45213", url: soldUrl, summary: {} },
        ]
      : [];
  return new FixtureAdapter(
    "iconacasa",
    "iconacasa-bitonto",
    items,
    new Map([
      ["45212", fixture("iconacasa-active-detail.html")],
      ["45213", fixture("iconacasa-sold-detail.html")],
    ]),
    normalizeIconacasaDetail,
    state,
    complete,
  );
}

function emptyHealthyIconacasaAdapter(observedAt: string): FixtureAdapter {
  return new FixtureAdapter(
    "iconacasa",
    "iconacasa-bitonto",
    [],
    new Map(),
    () => {
      throw new Error("Empty inventory has no details.");
    },
    "HEALTHY",
    true,
    observedAt,
  );
}

function puntoCasaAdapter(sourceKey = "bitonto-zona-via-mazzini"): FixtureAdapter {
  const url = "https://www.puntocasagroup.it/property-item/bitonto-zona-via-mazzini/";
  return new FixtureAdapter(
    "puntocasa",
    "puntocasa-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("puntocasa-active-detail.html")]]),
    normalizePuntoCasaDetail,
  );
}

async function countRows(db: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

localDescribe("Property Lifecycle local Supabase end-to-end", () => {
  const db = createClient(supabaseUrl ?? "http://127.0.0.1:54321", serviceRoleKey ?? "unused", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repository = new PropertyLifecycleRepository(db);

  it("starts from a clean local V2 schema with seeded agencies", async () => {
    expect(await countRows(db, "sync_runs")).toBe(0);
    expect(await countRows(db, "agencies")).toBe(2);
  });

  it("persists both adapters, sold evidence, snapshots, and immutable events", async () => {
    await runAgencySync({ adapter: iconacasaAdapter(), repository, mode: "SYNC" });
    await runAgencySync({ adapter: puntoCasaAdapter(), repository, mode: "SYNC" });

    expect(await countRows(db, "properties")).toBe(3);
    expect(await countRows(db, "publications")).toBe(3);
    expect(await countRows(db, "snapshots")).toBe(3);
    expect(await countRows(db, "evidence")).toBeGreaterThanOrEqual(4);

    const soldPublication = await db
      .from("publications")
      .select("state,source_status,agency_listing_id")
      .eq("source_key", "45213")
      .single();
    expect(soldPublication.error).toBeNull();
    expect(soldPublication.data).toMatchObject({ state: "SOLD_MARKED", source_status: "SOLD" });

    const soldAgencyListing = await db
      .from("agency_listings")
      .select("state")
      .eq("id", soldPublication.data?.agency_listing_id)
      .single();
    expect(soldAgencyListing.data?.state).toBe("CLOSED_SOLD");

    const soldEvents = await db
      .from("events")
      .select("id")
      .eq("event_type", "SOURCE_MARKED_SOLD");
    expect(soldEvents.data).toHaveLength(1);

    const immutableEvent = soldEvents.data?.[0];
    const immutableUpdate = await db
      .from("events")
      .update({ payload: { invalidRewrite: true } })
      .eq("id", immutableEvent?.id);
    expect(immutableUpdate.error?.message).toContain("append-only");
  });

  it("recognizes a relaunch without resetting true market age", async () => {
    await runAgencySync({
      adapter: puntoCasaAdapter("bitonto-zona-via-mazzini-relaunch"),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-20T09:00:00.000Z",
    });

    expect(await countRows(db, "properties")).toBe(3);
    const puntoPublications = await db
      .from("publications")
      .select("id,agency_listing_id")
      .eq("agency_id", (await repository.getAgencyBySlug("puntocasa-bitonto")).id);
    expect(puntoPublications.data).toHaveLength(2);
    expect(new Set(puntoPublications.data?.map((row) => row.agency_listing_id)).size).toBe(1);

    const relaunchEvents = await db
      .from("events")
      .select("id")
      .eq("event_type", "PUBLICATION_RELAUNCHED");
    expect(relaunchEvents.data).toHaveLength(1);

    const puntoAgencyListingId = puntoPublications.data?.[0]?.agency_listing_id;
    const puntoAgencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", puntoAgencyListingId)
      .single();
    const property = await db
      .from("properties")
      .select("true_market_start_lower_bound,true_market_start_method")
      .eq("id", puntoAgencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_lower_bound: "2024-03-01T00:00:00+00:00",
      true_market_start_method: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
    });
  });

  it("freezes missing state on failed health, then requires two healthy absences", async () => {
    await runAgencySync({
      adapter: iconacasaAdapter("FAILED", false),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-21T09:00:00.000Z",
    });
    let active = await db
      .from("publications")
      .select("state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(active.data).toMatchObject({ state: "ACTIVE", missing_healthy_run_count: 0 });

    await runAgencySync({
      adapter: emptyHealthyIconacasaAdapter("2026-08-22T09:00:00.000Z"),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-22T09:00:00.000Z",
    });
    active = await db
      .from("publications")
      .select("state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(active.data).toMatchObject({ state: "MISSING_PENDING", missing_healthy_run_count: 1 });

    await runAgencySync({
      adapter: emptyHealthyIconacasaAdapter("2026-08-23T09:00:00.000Z"),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-23T09:00:00.000Z",
    });
    active = await db
      .from("publications")
      .select("state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(active.data).toMatchObject({ state: "REMOVED", missing_healthy_run_count: 2 });

    const failedRun = await db
      .from("sync_runs")
      .select("health_state,absence_evaluation_allowed")
      .eq("health_state", "FAILED")
      .single();
    expect(failedRun.data).toMatchObject({
      health_state: "FAILED",
      absence_evaluation_allowed: false,
    });
  });

  it("claims and completes a durable leased job", async () => {
    const queue = new LifecycleJobQueue(db);
    const agency = await repository.getAgencyBySlug("iconacasa-bitonto");
    const queued = await queue.enqueue({
      jobType: "SYNC_AGENCY",
      agencyId: agency.id,
      dedupeKey: "integration:queue-claim",
    });
    const claimed = await queue.claim("integration-worker", 60);
    expect(claimed).toMatchObject({ id: queued.id, status: "RUNNING", attempts: 1 });
    const completed = await queue.complete(queued.id, "integration-worker");
    expect(completed.status).toBe("SUCCEEDED");

    const expiring = await queue.enqueue({
      jobType: "SYNC_AGENCY",
      agencyId: agency.id,
      maxAttempts: 1,
      dedupeKey: "integration:queue-expired-final-attempt",
    });
    await queue.claim("integration-crashed-worker", 60);
    const expiredLease = await db
      .from("lifecycle_jobs")
      .update({ lease_expires_at: "2020-01-01T00:00:00.000Z" })
      .eq("id", expiring.id);
    expect(expiredLease.error).toBeNull();
    expect(await queue.claim("integration-recovery-worker", 60)).toBeNull();
    const deadLetter = await db
      .from("lifecycle_jobs")
      .select("status")
      .eq("id", expiring.id)
      .single();
    expect(deadLetter.data?.status).toBe("DEAD_LETTER");
  });
});
