import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { HttpResponse } from "@/lib/http/client";
import { normalizeFuturaDetail } from "@/lib/property-lifecycle/adapters/futura";
import { normalizeGarofaloDetail } from "@/lib/property-lifecycle/adapters/garofalo";
import { normalizeIconacasaDetail } from "@/lib/property-lifecycle/adapters/iconacasa";
import { normalizeMomentoDetail } from "@/lib/property-lifecycle/adapters/momento";
import { normalizePuntoCasaDetail } from "@/lib/property-lifecycle/adapters/puntocasa";
import { normalizeTrioDetail } from "@/lib/property-lifecycle/adapters/trio";
import { normalizeVistocasaDetail } from "@/lib/property-lifecycle/adapters/vistocasa";
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
import { runBootstrapDryRun } from "@/lib/property-lifecycle/bootstrap/dry-run";
import {
  BuildingIntelligenceImporter,
  DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
} from "@/lib/property-lifecycle/buildings/importer";
import { rehashNormalizedListing } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { LifecycleJobQueue } from "@/lib/property-lifecycle/jobs/queue";
import { runLifecycleWorkerOnce } from "@/lib/property-lifecycle/jobs/worker";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { PrivateRadarBridge } from "@/lib/property-lifecycle/private-radar/bridge";
import { PropertyLifecycleReadRepository } from "@/lib/property-lifecycle/read-models/repository";
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

function buildingPracticeCsv(): string {
  return [
    "Applicazione,Numero Pratica,Oggetto,Data Protocollo,Numero Protocollo,Anno,Tipo Pratica,Via,Civico,Lettera,Cognome,Nome,Ragione Sociale,Situazione Pratica,Comune,Tipo Catasto,Foglio,Particella,Subalterno,Sezione,Lotto",
    'ape,P-1,"FRAZIONAMENTO, manutenzione straordinaria",15/02/2026,100,2026,CILA,Via Luigi Galvani,26/28/30,,Rossi,Mario,,Aperta,Bitonto,Fabbricati,50,2279,2,,',
    'ape,P-1,"FRAZIONAMENTO, manutenzione straordinaria",15/02/2026,100,2026,CILA,Via Luigi Galvani,26/28/30,,Bianchi,Anna,Impresa privata,Aperta,Bitonto,Fabbricati,50,2279,3,,',
    'ape,P-2,"Cambio destinazione d uso da laboratorio a residenza",01/03/2026,101,2026,SCIA,"Palombaio - Corso Vittorio Emanuele",51,,,Persona,,,Chiusa,Bitonto,Fabbricati,51,100,1,,',
    "ape,P-3,Fine lavori,04/03/2026,102,2026,CILA,Via Mazzini,,,,,,,Chiusa,Bitonto,Fabbricati,52,101,,,",
    "sue,P-4,Nuova costruzione,05/03/2026,103,2026,PDC,Via Verdi,10,,,,,Aperta,Bitonto,Fabbricati,53,102,1,,",
  ].join("\n");
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

function puntoCasaAdapter(
  sourceKey = "bitonto-zona-via-mazzini",
  priceAmount: number | null = null,
  observedAt = "2026-08-19T09:00:00.000Z",
): FixtureAdapter {
  const url = "https://www.puntocasagroup.it/property-item/bitonto-zona-via-mazzini/";
  return new FixtureAdapter(
    "puntocasa",
    "puntocasa-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("puntocasa-active-detail.html")]]),
    (document) => {
      const listing = normalizePuntoCasaDetail(document);
      return priceAmount == null
        ? listing
        : rehashNormalizedListing(listing, (input) => ({
            ...input,
            commercial: { ...input.commercial, priceAmount },
          }));
    },
    "HEALTHY",
    true,
    observedAt,
  );
}

function vistocasaAdapter(): FixtureAdapter {
  const sourceKey = "10002";
  const url = "https://www.vistocasa.com/it/immobile.aspx?articoliid=10002";
  return new FixtureAdapter(
    "vistocasa",
    "vistocasa-bitonto",
    [
      {
        sourceKey,
        externalId: sourceKey,
        url,
        summary: {
          latitude: 41.106875,
          longitude: 16.697617,
          imageUrl: "https://www.vistocasa.com/immobili/fotoimmobile10002/1.jpg",
        },
      },
    ],
    new Map([[sourceKey, fixture("vistocasa-active-detail.html")]]),
    normalizeVistocasaDetail,
    "HEALTHY",
    true,
    "2026-08-28T09:00:00.000Z",
  );
}

function futuraAdapter(): FixtureAdapter {
  const sourceKey = "2587000";
  const url =
    "https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2587000&language=ita";
  return new FixtureAdapter(
    "futura",
    "futura-immobiliare-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("futura-active-detail.html")]]),
    normalizeFuturaDetail,
    "HEALTHY",
    true,
    "2026-08-19T09:00:00.000Z",
  );
}

function garofaloAdapter(): FixtureAdapter {
  const sourceKey = "14164";
  const url =
    "https://garofaloimmobiliare.com/realestate-detail/reid/14164/largo-teatro-umberto-4-vani";
  return new FixtureAdapter(
    "garofalo",
    "garofalo-immobiliare-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("garofalo-active-detail.json")]]),
    normalizeGarofaloDetail,
    "HEALTHY",
    true,
    "2026-08-19T09:00:00.000Z",
  );
}

function trioAdapter(): FixtureAdapter {
  const sourceKey = "72461820";
  const url = "https://www.trovacasa.it/annunci/ba-tc-92459-72461820";
  return new FixtureAdapter(
    "trio",
    "trio-casa-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("trio-active-detail.html")]]),
    normalizeTrioDetail,
    "HEALTHY",
    true,
    "2026-08-19T09:00:00.000Z",
  );
}

function momentoAdapter(): FixtureAdapter {
  const sourceKey = "70534492";
  const url = "https://www.trovacasa.it/annunci/ba-tc-96100-70534492";
  return new FixtureAdapter(
    "momento",
    "momento-casa-bitonto",
    [{ sourceKey, externalId: sourceKey, url, summary: {} }],
    new Map([[sourceKey, fixture("momento-active-detail.html")]]),
    normalizeMomentoDetail,
    "HEALTHY",
    true,
    "2026-08-19T09:00:00.000Z",
  );
}

async function countRows(
  db: SupabaseClient,
  table: string,
  column = "id",
): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select(column, { count: "exact", head: true });
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function insertPrivateListing(
  db: SupabaseClient,
  input: {
    sourceKey: string;
    title: string;
    address: string;
    sqm: number;
    rooms: number;
    status?: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    available?: boolean | null;
  },
): Promise<string> {
  const firstSeenAt = input.firstSeenAt ?? "2026-08-20T09:00:00.000Z";
  const lastSeenAt = input.lastSeenAt ?? "2026-08-21T09:00:00.000Z";
  const url = `https://private-fixture.invalid/${input.sourceKey}`;
  const listing = await db
    .from("listings")
    .insert({
      source: "private-fixture",
      source_listing_id: input.sourceKey,
      url,
      canonical_url: url,
      title: input.title,
      description:
        "Contatto Mario Rossi: 333 123 4567, mario.rossi@example.com, https://contact.invalid/owner",
      price: 135_000,
      sqm: input.sqm,
      rooms: input.rooms,
      floor: "2",
      zone: "Bitonto",
      address_raw: input.address,
      seller_type: "private",
      seller_name: "Mario Rossi",
      phone: "+39 333 123 4567",
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      status: input.status ?? "new",
      seller_classification_confidence: 0.99,
      seller_classification_reasons: ["owner_language", "direct_contact"],
    })
    .select("id")
    .single();
  if (listing.error || !listing.data?.id) {
    throw new Error(listing.error?.message ?? "Private fixture insert returned no id.");
  }
  if (input.available != null) {
    const snapshot = await db.from("listing_snapshots").insert({
      listing_id: listing.data.id,
      checked_at: lastSeenAt,
      source: "private-fixture",
      url,
      title: input.title,
      is_available: input.available,
    });
    if (snapshot.error) {
      throw new Error(snapshot.error.message);
    }
  }
  return listing.data.id;
}

localDescribe("Property Lifecycle local Supabase end-to-end", () => {
  const db = createClient(supabaseUrl ?? "http://127.0.0.1:54321", serviceRoleKey ?? "unused", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repository = new PropertyLifecycleRepository(db);

  it("starts from a clean local V2 schema with seeded agencies", async () => {
    expect(await countRows(db, "sync_runs")).toBe(0);
    expect(await countRows(db, "agencies")).toBe(10);
  });

  it("produces a bootstrap prediction without writing any lifecycle state", async () => {
    const protectedTables = [
      "sync_runs",
      "properties",
      "agency_listings",
      "publications",
      "snapshots",
      "evidence",
      "events",
      "image_fingerprints",
      "floorplan_fingerprints",
      "review_queue",
      "lifecycle_jobs",
    ];
    const before = Object.fromEntries(
      await Promise.all(
        protectedTables.map(async (table) => [table, await countRows(db, table)]),
      ),
    );
    const report = await runBootstrapDryRun({
      adapters: [iconacasaAdapter()],
      existingState: await repository.loadBootstrapState(),
      generatedAt: "2026-08-19T09:00:00.000Z",
      assetProcessor: async () => ({ assets: [], warnings: [] }),
    });
    const after = Object.fromEntries(
      await Promise.all(
        protectedTables.map(async (table) => [table, await countRows(db, table)]),
      ),
    );

    expect(report).toMatchObject({
      nonMutating: true,
      totals: {
        rawListings: 2,
        acceptedListings: 2,
        predictedNewProperties: 2,
        predictedPublications: 2,
        sourceFailures: 0,
      },
    });
    expect(after).toEqual(before);
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

  it("persists deep-sync content fingerprints and compact representative media", async () => {
    await runAgencySync({
      adapter: puntoCasaAdapter(
        "bitonto-zona-via-mazzini",
        null,
        "2026-08-20T09:00:00.000Z",
      ),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl: listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/image.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "a".repeat(64),
            perceptualHash: "01".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: '"fixture"',
            lastModified: "Wed, 19 Aug 2026 09:00:00 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: new Uint8Array([1, 2, 3, 4]),
          },
        ],
        warnings: [],
      }),
    });

    const fingerprints = await db
      .from("image_fingerprints")
      .select("algorithm,fingerprint,width,height")
      .in("algorithm", ["SHA256", "DHASH64"]);
    expect(fingerprints.error).toBeNull();
    expect(fingerprints.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ algorithm: "SHA256", fingerprint: "a".repeat(64) }),
        expect.objectContaining({ algorithm: "DHASH64", fingerprint: "01".repeat(32) }),
      ]),
    );

    const propertyWithVisual = await db
      .from("properties")
      .select("representative_image_paths")
      .not("representative_image_paths", "eq", "{}")
      .single();
    expect(propertyWithVisual.data?.representative_image_paths).toHaveLength(1);
    const visualPath = propertyWithVisual.data?.representative_image_paths?.[0];
    const storedVisual = await db.storage
      .from("property-lifecycle-visuals")
      .download(visualPath ?? "missing");
    expect(storedVisual.error).toBeNull();
  });

  it("recognizes a relaunch without resetting true market age", async () => {
    await runAgencySync({
      adapter: puntoCasaAdapter(
        "bitonto-zona-via-mazzini-relaunch",
        null,
        "2026-08-21T09:00:00.000Z",
      ),
      repository,
      mode: "DEEP_SYNC",
      observedAt: "2026-08-20T09:00:00.000Z",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl:
              listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/image.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "a".repeat(64),
            perceptualHash: "01".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: '"fixture"',
            lastModified: "Wed, 19 Aug 2026 09:00:00 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
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
      .select("true_market_start_lower_bound,true_market_start_method,relaunch_count")
      .eq("id", puntoAgencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_lower_bound: "2024-03-01T00:00:00+00:00",
      true_market_start_method: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
      relaunch_count: 1,
    });
  });

  it("emits immutable price drop and increase events but no event when unchanged", async () => {
    await runAgencySync({
      adapter: puntoCasaAdapter(
        "bitonto-zona-via-mazzini",
        425_000,
        "2026-08-22T09:00:00.000Z",
      ),
      repository,
      mode: "SYNC",
    });
    await runAgencySync({
      adapter: puntoCasaAdapter(
        "bitonto-zona-via-mazzini",
        425_000,
        "2026-08-23T09:00:00.000Z",
      ),
      repository,
      mode: "SYNC",
    });
    await runAgencySync({
      adapter: puntoCasaAdapter(
        "bitonto-zona-via-mazzini",
        460_000,
        "2026-08-24T09:00:00.000Z",
      ),
      repository,
      mode: "SYNC",
    });

    const priceEvents = await db
      .from("events")
      .select("event_type,payload")
      .in("event_type", ["PRICE_DROP", "PRICE_INCREASE"])
      .order("occurred_at");
    expect(priceEvents.data).toHaveLength(2);
    expect(priceEvents.data?.[0]).toMatchObject({
      event_type: "PRICE_DROP",
      payload: {
        oldPrice: 450_000,
        newPrice: 425_000,
        absoluteDelta: 25_000,
      },
    });
    expect(priceEvents.data?.[1]).toMatchObject({
      event_type: "PRICE_INCREASE",
      payload: {
        oldPrice: 425_000,
        newPrice: 460_000,
        absoluteDelta: 35_000,
      },
    });
  });

  it("rolls back every critical observation checkpoint and retries idempotently", async () => {
    const adapter = puntoCasaAdapter(
      "bitonto-zona-via-mazzini",
      440_000,
      "2026-08-25T09:00:00.000Z",
    );
    const inventory = await adapter.fetchInventory();
    const item = inventory.items[0];
    if (!item) {
      throw new Error("Atomic fixture inventory is empty.");
    }
    const listing = await adapter.normalize(await adapter.fetchDetail(item));
    const agency = await repository.getAgencyBySlug("puntocasa-bitonto");
    const protectedTables = [
      "locations",
      "buildings",
      "properties",
      "agency_listings",
      "publications",
      "snapshots",
      "evidence",
      "events",
      "image_fingerprints",
      "floorplan_fingerprints",
      "property_match_candidates",
      "review_queue",
      "opportunities",
    ];

    for (const failurePoint of [
      "AFTER_PUBLICATION",
      "AFTER_SNAPSHOT",
      "DURING_EVENT_GENERATION",
      "DURING_LIFECYCLE_UPDATE",
    ] as const) {
      const before = Object.fromEntries(
        await Promise.all(
          protectedTables.map(async (table) => [table, await countRows(db, table)]),
        ),
      );
      const syncRunId = await repository.createSyncRun({
        agencyId: agency.id,
        adapterKey: "puntocasa",
        mode: "FIXTURE",
      });
      await expect(
        repository.persistObservation(agency.id, syncRunId, listing, [], {
          failurePoint,
        }),
      ).rejects.toThrow(`Injected observation failure ${failurePoint}`);
      const after = Object.fromEntries(
        await Promise.all(
          protectedTables.map(async (table) => [table, await countRows(db, table)]),
        ),
      );
      expect(after).toEqual(before);
      const failedRun = await db
        .from("sync_runs")
        .select("observation_commit_count,observation_failure_count")
        .eq("id", syncRunId)
        .single();
      expect(failedRun.data).toEqual({
        observation_commit_count: 0,
        observation_failure_count: 1,
      });
    }

    const retryRunId = await repository.createSyncRun({
      agencyId: agency.id,
      adapterKey: "puntocasa",
      mode: "FIXTURE",
    });
    const snapshotsBefore = await countRows(db, "snapshots");
    const eventsBefore = await countRows(db, "events");
    const first = await repository.persistObservation(
      agency.id,
      retryRunId,
      listing,
    );
    const snapshotsAfterCommit = await countRows(db, "snapshots");
    const eventsAfterCommit = await countRows(db, "events");
    const replay = await repository.persistObservation(
      agency.id,
      retryRunId,
      listing,
    );

    expect(replay.snapshotId).toBe(first.snapshotId);
    expect(snapshotsAfterCommit).toBe(snapshotsBefore + 1);
    expect(await countRows(db, "snapshots")).toBe(snapshotsAfterCommit);
    expect(eventsAfterCommit).toBeGreaterThan(eventsBefore);
    expect(await countRows(db, "events")).toBe(eventsAfterCommit);
    const retryRun = await db
      .from("sync_runs")
      .select("observation_commit_count,observation_failure_count")
      .eq("id", retryRunId)
      .single();
    expect(retryRun.data).toEqual({
      observation_commit_count: 1,
      observation_failure_count: 0,
    });
  });

  it("freezes missing state on failed health, then requires two healthy absences", async () => {
    // La prima sync ha creato la baseline; due osservazioni sane aggiuntive la
    // stabilizzano senza inventare storico precedente.
    await runAgencySync({
      adapter: iconacasaAdapter(),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-19T12:00:00.000Z",
    });
    await runAgencySync({
      adapter: iconacasaAdapter(),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-20T09:00:00.000Z",
    });
    const agency = await repository.getAgencyBySlug("iconacasa-bitonto");
    const stableBaseline = await db
      .from("adapter_health_baselines")
      .select("successful_run_count,recent_inventory_counts,rolling_median,schema_version,consecutive_healthy_runs")
      .eq("agency_id", agency.id)
      .single();
    expect(stableBaseline.data).toEqual({
      successful_run_count: 3,
      recent_inventory_counts: [2, 2, 2],
      rolling_median: 2,
      schema_version: 1,
      consecutive_healthy_runs: 3,
    });
    await runAgencySync({
      adapter: iconacasaAdapter("FAILED", false),
      repository,
      mode: "SYNC",
      observedAt: "2026-08-21T09:00:00.000Z",
    });
    let active = await db
      .from("publications")
      .select("id,state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(active.data).toMatchObject({ state: "ACTIVE", missing_healthy_run_count: 0 });

    const firstMissingRun = await repository.createSyncRun({
      agencyId: agency.id,
      adapterKey: "iconacasa",
      mode: "FIXTURE",
    });
    await repository.applyMissingObservations({
      agencyId: agency.id,
      syncRunId: firstMissingRun,
      observedSourceKeys: new Set(["45213"]),
      observedAt: "2026-08-22T09:00:00.000Z",
      healthState: "HEALTHY",
      inventoryComplete: true,
      missingHealthyRunThreshold: 2,
    });
    active = await db
      .from("publications")
      .select("id,state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(active.data).toMatchObject({ state: "MISSING_PENDING", missing_healthy_run_count: 1 });
    await repository.applyMissingObservations({
      agencyId: agency.id,
      syncRunId: firstMissingRun,
      observedSourceKeys: new Set(["45213"]),
      observedAt: "2026-08-22T09:00:00.000Z",
      healthState: "HEALTHY",
      inventoryComplete: true,
      missingHealthyRunThreshold: 2,
    });
    const replayedMissing = await db
      .from("publications")
      .select("state,missing_healthy_run_count")
      .eq("source_key", "45212")
      .single();
    expect(replayedMissing.data).toMatchObject({
      state: "MISSING_PENDING",
      missing_healthy_run_count: 1,
    });
    const firstMissingEvents = await db
      .from("events")
      .select("id")
      .eq("publication_id", active.data?.id ?? "")
      .eq("event_type", "PUBLICATION_MISSING_PENDING");
    expect(firstMissingEvents.data).toHaveLength(1);

    const secondMissingRun = await repository.createSyncRun({
      agencyId: agency.id,
      adapterKey: "iconacasa",
      mode: "FIXTURE",
    });
    await repository.applyMissingObservations({
      agencyId: agency.id,
      syncRunId: secondMissingRun,
      observedSourceKeys: new Set(["45213"]),
      observedAt: "2026-08-23T09:00:00.000Z",
      healthState: "HEALTHY",
      inventoryComplete: true,
      missingHealthyRunThreshold: 2,
    });
    active = await db
      .from("publications")
      .select("id,state,missing_healthy_run_count")
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

  it("runs the post-exit monitor and creates a high transparent opportunity", async () => {
    const queuedExit = await db
      .from("lifecycle_jobs")
      .select("id,status,job_type,run_after,payload")
      .eq("job_type", "POST_EXIT_CHECK")
      .eq("status", "QUEUED")
      .single();
    expect(queuedExit.error).toBeNull();
    const scheduledListing = await db
      .from("agency_listings")
      .select("monitoring_phase,next_check_at,check_attempt")
      .eq("id", queuedExit.data?.payload?.agencyListingId)
      .single();
    expect(scheduledListing.data).toMatchObject({
      monitoring_phase: "WAITING_CONFIRMATION",
      next_check_at: queuedExit.data?.run_after,
      check_attempt: 0,
    });
    await repository.runPostExitCheck({
      jobId: queuedExit.data?.id ?? "",
      agencyListingId: queuedExit.data?.payload?.agencyListingId ?? "",
      publicationId: queuedExit.data?.payload?.publicationId ?? null,
      checkedAt: queuedExit.data?.run_after,
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "45212")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("state,property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    expect(agencyListing.data?.state).toBe("OFF_MARKET_NO_SALE_EVIDENCE");

    const postExitCheck = await db
      .from("post_exit_checks")
      .select("outcome,technical_disappearance_confirmed")
      .eq("agency_listing_id", publication.data?.agency_listing_id)
      .single();
    expect(postExitCheck.data).toEqual({
      outcome: "OFF_MARKET_NO_SALE_EVIDENCE",
      technical_disappearance_confirmed: true,
    });

    const opportunity = await db
      .from("opportunities")
      .select("level,reasons,status")
      .eq("property_id", agencyListing.data?.property_id)
      .single();
    expect(opportunity.data).toMatchObject({
      level: "HIGH",
      status: "OPEN",
      reasons: expect.arrayContaining(["agency_exit_confirmed", "no_sale_evidence"]),
    });
  });

  it("persists every Post-Exit branch independently from worker memory", async () => {
    const primaryAgency = await repository.getAgencyBySlug("iconacasa-bitonto");
    const secondaryAgency = await repository.getAgencyBySlug("ad-maiora-bitonto");
    const dueAt = "2026-09-02T09:00:00.000Z";

    async function exitFixture(key: string) {
      const property = await db
        .from("properties")
        .insert({
          property_type: "Appartamento",
          canonical_attributes: { address: `Via Post Exit ${key}`, locality: "Bitonto" },
        })
        .select("id")
        .single();
      if (property.error || !property.data?.id) throw new Error(property.error?.message);
      const agencyListing = await db
        .from("agency_listings")
        .insert({
          agency_id: primaryAgency.id,
          property_id: property.data.id,
          state: "EXIT_PENDING",
          monitoring_phase: "WAITING_CONFIRMATION",
          post_exit_check_due_at: dueAt,
          next_check_at: dueAt,
        })
        .select("id")
        .single();
      if (agencyListing.error || !agencyListing.data?.id) {
        throw new Error(agencyListing.error?.message);
      }
      const publication = await db
        .from("publications")
        .insert({
          agency_id: primaryAgency.id,
          agency_listing_id: agencyListing.data.id,
          source_key: `post-exit-${key}`,
          external_id: `post-exit-${key}`,
          canonical_url: `https://fixture.invalid/post-exit-${key}`,
          state: "REMOVED",
          source_status: "ACTIVE",
          missing_healthy_run_count: 2,
          missing_since: "2026-08-30T09:00:00.000Z",
          removed_at: "2026-08-31T09:00:00.000Z",
        })
        .select("id")
        .single();
      if (publication.error || !publication.data?.id) {
        throw new Error(publication.error?.message);
      }
      const job = await db
        .from("lifecycle_jobs")
        .insert({
          job_type: "POST_EXIT_CHECK",
          agency_id: primaryAgency.id,
          payload: {
            agencyListingId: agencyListing.data.id,
            publicationId: publication.data.id,
          },
          run_after: dueAt,
          dedupe_key: `integration:post-exit:${key}`,
        })
        .select("id")
        .single();
      if (job.error || !job.data?.id) throw new Error(job.error?.message);
      return {
        propertyId: property.data.id,
        agencyListingId: agencyListing.data.id,
        publicationId: publication.data.id,
        jobId: job.data.id,
      };
    }

    const premature = await exitFixture("premature");
    expect(
      await repository.runPostExitCheck({
        ...premature,
        checkedAt: "2026-09-01T09:00:00.000Z",
      }),
    ).toBe("NEEDS_VERIFICATION");
    const prematureState = await db
      .from("agency_listings")
      .select("state,monitoring_phase,next_check_at,check_attempt")
      .eq("id", premature.agencyListingId)
      .single();
    expect(prematureState.data).toMatchObject({
      state: "EXIT_PENDING",
      monitoring_phase: "WAITING_CONFIRMATION",
      check_attempt: 1,
    });
    expect(new Date(prematureState.data?.next_check_at ?? "").getTime()).toBe(
      new Date(dueAt).getTime(),
    );
    const recheckJob = await db
      .from("lifecycle_jobs")
      .select("id,run_after")
      .eq("dedupe_key", `POST_EXIT_RECHECK:${premature.agencyListingId}:1`)
      .single();
    expect(new Date(recheckJob.data?.run_after ?? "").getTime()).toBe(
      new Date(dueAt).getTime(),
    );
    expect(
      await repository.runPostExitCheck({
        jobId: recheckJob.data?.id ?? "",
        agencyListingId: premature.agencyListingId,
        publicationId: premature.publicationId,
        checkedAt: dueAt,
      }),
    ).toBe("OFF_MARKET_NO_SALE_EVIDENCE");

    const reappeared = await exitFixture("reappeared");
    await db
      .from("publications")
      .update({ state: "ACTIVE", missing_healthy_run_count: 0, missing_since: null, removed_at: null })
      .eq("id", reappeared.publicationId);
    expect(
      await repository.runPostExitCheck({
        ...reappeared,
        checkedAt: dueAt,
      }),
    ).toBe("REAPPEARED");

    const sold = await exitFixture("sold");
    await db
      .from("publications")
      .update({ state: "SOLD_MARKED", source_status: "SOLD" })
      .eq("id", sold.publicationId);
    expect(
      await repository.runPostExitCheck({ ...sold, checkedAt: dueAt }),
    ).toBe("CLOSED_SOLD");

    const switched = await exitFixture("switched");
    await db.from("agency_listings").insert({
      agency_id: secondaryAgency.id,
      property_id: switched.propertyId,
      state: "ACTIVE",
    });
    expect(
      await repository.runPostExitCheck({ ...switched, checkedAt: dueAt }),
    ).toBe("CLOSED_SWITCHED");

    const privateRelist = await exitFixture("private");
    const legacyListingId = await insertPrivateListing(db, {
      sourceKey: "post-exit-private",
      title: "Privato via Post Exit",
      address: "Via Post Exit private",
      sqm: 100,
      rooms: 4,
    });
    const privatePublication = await db.from("private_publications").insert({
      legacy_listing_id: legacyListingId,
      property_id: privateRelist.propertyId,
      source: "private-fixture",
      source_listing_id: "post-exit-private",
      canonical_url: "https://private-fixture.invalid/post-exit-private",
      state: "ACTIVE",
      identity_outcome: "AUTO_MATCH",
      identity_score: 1,
      identity_margin: 1,
      title: "Privato via Post Exit",
      surface_sqm: 100,
      rooms: 4,
      first_seen_at: "2026-09-01T09:00:00.000Z",
      last_seen_at: "2026-09-01T09:00:00.000Z",
      content_hash: "f".repeat(64),
    });
    expect(privatePublication.error).toBeNull();
    expect(
      await repository.runPostExitCheck({ ...privateRelist, checkedAt: dueAt }),
    ).toBe("CLOSED_TO_PRIVATE");

    const results = await db
      .from("agency_listings")
      .select("id,state,monitoring_phase,next_check_at,check_attempt")
      .in("id", [
        reappeared.agencyListingId,
        sold.agencyListingId,
        switched.agencyListingId,
        privateRelist.agencyListingId,
      ]);
    expect(results.error).toBeNull();
    expect(results.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reappeared.agencyListingId, state: "ACTIVE", monitoring_phase: "NONE", next_check_at: null, check_attempt: 1 }),
        expect.objectContaining({ id: sold.agencyListingId, state: "CLOSED_SOLD", monitoring_phase: "COMPLETE", next_check_at: null, check_attempt: 1 }),
        expect.objectContaining({ id: switched.agencyListingId, state: "CLOSED_SWITCHED", monitoring_phase: "COMPLETE", next_check_at: null, check_attempt: 1 }),
        expect.objectContaining({ id: privateRelist.agencyListingId, state: "CLOSED_TO_PRIVATE", monitoring_phase: "COMPLETE", next_check_at: null, check_attempt: 1 }),
      ]),
    );
    const privateCleanup = await db
      .from("private_publications")
      .delete()
      .eq("legacy_listing_id", legacyListingId);
    expect(privateCleanup.error).toBeNull();
    // La tabella legacy non concede DELETE al service role: neutralizziamo la
    // fixture senza alterare i privilegi di produzione e senza inquinare i test
    // successivi del bridge Private Radar.
    const legacyCleanup = await db
      .from("listings")
      .update({ seller_type: "agency", status: "archived" })
      .eq("id", legacyListingId);
    expect(legacyCleanup.error).toBeNull();
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

  it("refuses a real bootstrap job until dry-run approval is explicit", async () => {
    const queue = new LifecycleJobQueue(db);
    const agency = await repository.getAgencyBySlug("iconacasa-bitonto");
    const syncRunsBefore = await countRows(db, "sync_runs");
    const queued = await queue.enqueue({
      jobType: "BOOTSTRAP_AGENCY",
      agencyId: agency.id,
      maxAttempts: 1,
      priority: 100,
      dedupeKey: "integration:unapproved-bootstrap",
    });

    await expect(
      runLifecycleWorkerOnce("unapproved-bootstrap-worker", { db }),
    ).rejects.toThrow("payload.approved=true");
    const rejected = await db
      .from("lifecycle_jobs")
      .select("status")
      .eq("id", queued.id)
      .single();
    expect(rejected.data?.status).toBe("DEAD_LETTER");
    expect(await countRows(db, "sync_runs")).toBe(syncRunsBefore);
  });

  it("records Vistocasa original-media Last-Modified as bounded age evidence", async () => {
    await runAgencySync({
      adapter: vistocasaAdapter(),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl: listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/image.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "b".repeat(64),
            perceptualHash: "02".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: '"vistocasa-fixture"',
            lastModified: "Thu, 30 Jul 2026 10:57:16 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "10002")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    const property = await db
      .from("properties")
      .select("true_market_start_upper_bound,true_market_start_method")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_upper_bound: "2026-07-30T10:57:16+00:00",
      true_market_start_method: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
    });

    const mediaEvidence = await db
      .from("evidence")
      .select("source_recorded_at,extraction_method")
      .eq("extraction_method", "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED")
      .single();
    expect(mediaEvidence.data).toMatchObject({
      source_recorded_at: "2026-07-30T10:57:16+00:00",
      extraction_method: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
    });
  });

  it("keeps Futura publication date while allowing an older original gallery batch to bound true age", async () => {
    await runAgencySync({
      adapter: futuraAdapter(),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl: listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/image.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "c".repeat(64),
            perceptualHash: "03".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: '"futura-fixture"',
            lastModified: "Fri, 17 Jul 2026 15:17:44 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "2587000")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    const property = await db
      .from("properties")
      .select("true_market_start_upper_bound,true_market_start_method")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_upper_bound: "2026-07-17T15:17:44+00:00",
      true_market_start_method: "FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED",
    });

    const mediaEvidence = await db
      .from("evidence")
      .select("source_recorded_at,extraction_method")
      .eq("extraction_method", "FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED")
      .single();
    expect(mediaEvidence.data).toMatchObject({
      source_recorded_at: "2026-07-17T15:17:44+00:00",
      extraction_method: "FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED",
    });
  });

  it("accepts Garofalo original-media headers but never transformed derivative timestamps", async () => {
    await runAgencySync({
      adapter: garofaloAdapter(),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl:
              listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/original.png",
            position: 0,
            classification: "IMAGE",
            sha256: "d".repeat(64),
            perceptualHash: "04".repeat(32),
            width: 1200,
            height: 800,
            format: "png",
            etag: '"garofalo-original-fixture"',
            lastModified: "Mon, 30 Mar 2026 08:30:00 GMT",
            contentType: "image/png",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "14164")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    const property = await db
      .from("properties")
      .select("true_market_start_upper_bound,true_market_start_method")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_upper_bound: "2026-03-30T08:30:00+00:00",
      true_market_start_method: "GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED",
    });

    const mediaEvidence = await db
      .from("evidence")
      .select("source_url,source_recorded_at,extraction_method")
      .eq("extraction_method", "GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED")
      .single();
    expect(mediaEvidence.data).toMatchObject({
      source_recorded_at: "2026-03-30T08:30:00+00:00",
      extraction_method: "GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED",
    });
    expect(mediaEvidence.data?.source_url).not.toContain("/v1/");
  });

  it("uses Trio portal-gallery availability only as bounded public evidence", async () => {
    await runAgencySync({
      adapter: trioAdapter(),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl:
              listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/portal-media.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "e".repeat(64),
            perceptualHash: "05".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: null,
            lastModified: "Wed, 15 Jul 2026 12:18:43 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "72461820")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    const property = await db
      .from("properties")
      .select("building_id,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_lower_bound: null,
      true_market_start_upper_bound: "2026-07-15T12:18:43+00:00",
      true_market_start_method: "TRIO_TROVACASA_MEDIA_LAST_MODIFIED",
    });

    const mediaEvidence = await db
      .from("evidence")
      .select("claim_key,source_recorded_at,extraction_method")
      .eq("extraction_method", "TRIO_TROVACASA_MEDIA_LAST_MODIFIED")
      .single();
    expect(mediaEvidence.data).toMatchObject({
      claim_key: "publication.portalMediaAvailableBy",
      source_recorded_at: "2026-07-15T12:18:43+00:00",
      extraction_method: "TRIO_TROVACASA_MEDIA_LAST_MODIFIED",
    });
  });

  it("uses Momento portal-gallery headers as uncertain public-history evidence", async () => {
    await runAgencySync({
      adapter: momentoAdapter(),
      repository,
      mode: "DEEP_SYNC",
      assetProcessor: async (listing) => ({
        assets: [
          {
            canonicalUrl:
              listing.assets[0]?.canonicalUrl ?? "https://fixture.invalid/portal-media.jpg",
            position: 0,
            classification: "IMAGE",
            sha256: "f".repeat(64),
            perceptualHash: "06".repeat(32),
            width: 1200,
            height: 800,
            format: "jpeg",
            etag: null,
            lastModified: "Mon, 02 Mar 2026 14:38:01 GMT",
            contentType: "image/jpeg",
            sourceRecordedAt: null,
            exif: null,
            representativeThumbnail: null,
          },
        ],
        warnings: [],
      }),
    });

    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "70534492")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    const property = await db
      .from("properties")
      .select("building_id,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data).toMatchObject({
      true_market_start_lower_bound: null,
      true_market_start_upper_bound: "2026-03-02T14:38:01+00:00",
      true_market_start_method: "MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED",
    });
    expect(property.data?.building_id).not.toBeNull();
    const building = await db
      .from("buildings")
      .select("display_name,normalized_key")
      .eq("id", property.data?.building_id)
      .single();
    expect(building.data).toMatchObject({
      display_name: "Via Ammiraglio Vacca 56e, Bitonto",
      normalized_key: "it|ba|bitonto|bitonto|via ammiraglio vacca|56e",
    });

    const mediaEvidence = await db
      .from("evidence")
      .select("claim_key,source_recorded_at,extraction_method")
      .eq("extraction_method", "MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED")
      .single();
    expect(mediaEvidence.data).toMatchObject({
      claim_key: "publication.portalMediaAvailableBy",
      source_recorded_at: "2026-03-02T14:38:01+00:00",
      extraction_method: "MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED",
    });
  });

  it("imports municipal practices incrementally at building level without personal data", async () => {
    const importer = new BuildingIntelligenceImporter(db);
    const sourceKey = "integration-bitonto-practices";
    const first = await importer.importCsv({
      sourceKey,
      sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
      csv: buildingPracticeCsv(),
      observedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(first).toMatchObject({
      status: "SUCCEEDED",
      inputRows: 5,
      eligibleRows: 4,
      groupedRecords: 3,
      insertedRecords: 3,
      updatedRecords: 0,
      unchangedRecords: 0,
      duplicateRows: 1,
      unmatchedRecords: 1,
      buildingLinks: 4,
      eventCount: 4,
    });

    const repeated = await importer.importCsv({
      sourceKey,
      sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
      csv: buildingPracticeCsv(),
      observedAt: "2026-08-20T10:00:00.000Z",
    });
    expect(repeated).toMatchObject({
      insertedRecords: 0,
      updatedRecords: 0,
      unchangedRecords: 3,
      eventCount: 0,
    });

    const changedCsv = buildingPracticeCsv().replace(
      ",Aperta,Bitonto,Fabbricati,50,2279,2",
      ",Chiusa,Bitonto,Fabbricati,50,2279,2",
    );
    const changed = await importer.importCsv({
      sourceKey,
      sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
      csv: changedCsv,
      observedAt: "2026-08-21T10:00:00.000Z",
    });
    expect(changed).toMatchObject({
      insertedRecords: 0,
      updatedRecords: 1,
      unchangedRecords: 2,
      eventCount: 3,
    });

    expect(await countRows(db, "building_practice_records")).toBe(3);
    expect(await countRows(db, "building_practice_observations")).toBe(4);
    expect(
      await countRows(db, "building_practice_buildings", "practice_record_id"),
    ).toBe(4);
    const practices = await db
      .from("building_practice_records")
      .select("sanitized_payload")
      .eq("source_key", sourceKey);
    expect(practices.error).toBeNull();
    expect(JSON.stringify(practices.data)).not.toMatch(
      /Rossi|Mario|Bianchi|Anna|Impresa privata|Persona/,
    );
    const links = await db
      .from("building_practice_buildings")
      .select("practice_record_id,building_id");
    expect(links.data).toHaveLength(4);
    const linkedProperties = await db
      .from("properties")
      .select("id")
      .in("building_id", (links.data ?? []).map((link) => link.building_id));
    expect(linkedProperties.data).toEqual([]);

    const event = await db
      .from("building_events")
      .select("id")
      .eq("source_url", DEFAULT_BUILDING_PRACTICE_SOURCE_URL)
      .limit(1)
      .single();
    const immutableUpdate = await db
      .from("building_events")
      .update({ payload: { invalidRewrite: true } })
      .eq("id", event.data?.id);
    expect(immutableUpdate.error?.message).toContain("append-only");

    const fetcher = vi.fn(
      async () =>
        new Response(changedCsv, {
          status: 200,
          headers: { "content-type": "text/csv", etag: '"fixture-building-data"' },
        }),
    );
    const queue = new LifecycleJobQueue(db);
    const queued = await queue.enqueue({
      jobType: "BUILDING_DATA_SYNC",
      maxAttempts: 1,
      priority: 100,
      payload: { sourceKey },
      dedupeKey: "integration:building-data-sync",
    });
    expect(
      await runLifecycleWorkerOnce("building-data-worker", { db, fetcher }),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const completed = await db
      .from("lifecycle_jobs")
      .select("status")
      .eq("id", queued.id)
      .single();
    expect(completed.data?.status).toBe("SUCCEEDED");
  });

  it("bridges an agency exit to the same private property without copying contact data", async () => {
    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "70534492")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("id,property_id")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    expect(agencyListing.error).toBeNull();
    const agencyExit = await db
      .from("agency_listings")
      .update({
        state: "OFF_MARKET_NO_SALE_EVIDENCE",
        closed_at: "2026-08-19T18:00:00.000Z",
        exit_confirmed_at: "2026-08-19T18:00:00.000Z",
        outcome_source: "INTEGRATION_FIXTURE",
        outcome_confidence: 1,
      })
      .eq("id", agencyListing.data?.id);
    expect(agencyExit.error).toBeNull();

    const legacyListingId = await insertPrivateListing(db, {
      sourceKey: "agency-to-private-56e",
      title: "Appartamento privato a Bitonto in Via Ammiraglio Vacca 56e",
      address: "Via Ammiraglio Vacca 56e, Bitonto",
      sqm: 100,
      rooms: 4,
      available: true,
    });
    const first = await new PrivateRadarBridge(db).sync();
    expect(first).toMatchObject({
      scannedListings: 1,
      inScopeListings: 1,
      createdPublications: 1,
      autoMatches: 1,
      agencyToPrivateEvents: 1,
      soldOrManualConflicts: 0,
    });

    const privatePublication = await db
      .from("private_publications")
      .select("id,property_id,state,identity_outcome,description,metadata")
      .eq("legacy_listing_id", legacyListingId)
      .single();
    expect(privatePublication.data).toMatchObject({
      property_id: agencyListing.data?.property_id,
      state: "ACTIVE",
      identity_outcome: "AUTO_MATCH",
      metadata: { contactDataExcluded: true },
    });
    expect(JSON.stringify(privatePublication.data)).not.toMatch(
      /Mario Rossi|333 123 4567|mario\.rossi@example\.com|contact\.invalid/,
    );
    const convertedAgencyListing = await db
      .from("agency_listings")
      .select("state,outcome_source")
      .eq("id", agencyListing.data?.id)
      .single();
    expect(convertedAgencyListing.data).toEqual({
      state: "CLOSED_TO_PRIVATE",
      outcome_source: "PRIVATE_RADAR_IDENTITY_V1",
    });
    const property = await db
      .from("properties")
      .select("property_state")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(property.data?.property_state).toBe("ACTIVE_PRIVATE");
    const opportunity = await db
      .from("opportunities")
      .select("level,reasons,status")
      .eq("property_id", agencyListing.data?.property_id)
      .single();
    expect(opportunity.data).toMatchObject({
      level: "HOT",
      status: "OPEN",
      reasons: ["agency_to_private_confirmed"],
    });

    const replay = await new PrivateRadarBridge(db).sync();
    expect(replay).toMatchObject({
      createdPublications: 0,
      updatedPublications: 0,
      unchangedPublications: 1,
      agencyToPrivateEvents: 0,
      simultaneousPrivateEvents: 0,
    });
    const agencyToPrivateEvents = await db
      .from("events")
      .select("id")
      .eq("property_id", agencyListing.data?.property_id)
      .eq("event_type", "AGENCY_TO_PRIVATE");
    expect(agencyToPrivateEvents.data).toHaveLength(1);

    const queue = new LifecycleJobQueue(db);
    const queued = await queue.enqueue({
      jobType: "SYNC_PRIVATE_RADAR",
      priority: 100,
      maxAttempts: 1,
      dedupeKey: "integration:sync-private-radar",
    });
    expect(await runLifecycleWorkerOnce("private-radar-worker", { db })).toBe(true);
    const completed = await db
      .from("lifecycle_jobs")
      .select("status")
      .eq("id", queued.id)
      .single();
    expect(completed.data?.status).toBe("SUCCEEDED");
  });

  it("distinguishes simultaneous private marketing and explicit private removal", async () => {
    const publication = await db
      .from("publications")
      .select("agency_listing_id")
      .eq("source_key", "72461820")
      .single();
    const agencyListing = await db
      .from("agency_listings")
      .select("id,property_id,state")
      .eq("id", publication.data?.agency_listing_id)
      .single();
    expect(agencyListing.data?.state).toBe("ACTIVE");
    const simultaneousLegacyId = await insertPrivateListing(db, {
      sourceKey: "simultaneous-28",
      title: "Appartamento privato a Bitonto in Via Ammiraglio Vacca 28",
      address: "Via Ammiraglio Vacca 28, Bitonto",
      sqm: 100,
      rooms: 3,
      available: true,
    });

    const simultaneous = await new PrivateRadarBridge(db).sync();
    expect(simultaneous).toMatchObject({
      createdPublications: 1,
      autoMatches: 1,
      simultaneousPrivateEvents: 1,
    });
    const unchangedAgencyListing = await db
      .from("agency_listings")
      .select("state")
      .eq("id", agencyListing.data?.id)
      .single();
    expect(unchangedAgencyListing.data?.state).toBe("ACTIVE");
    const simultaneousProperty = await db
      .from("properties")
      .select("property_state")
      .eq("id", agencyListing.data?.property_id)
      .single();
    expect(simultaneousProperty.data?.property_state).toBe(
      "ACTIVE_AGENCY_AND_PRIVATE",
    );

    const firstPrivate = await db
      .from("listings")
      .select("id,url")
      .eq("source_listing_id", "agency-to-private-56e")
      .single();
    const archived = await db
      .from("listings")
      .update({
        status: "archived",
        last_seen_at: "2026-08-23T09:00:00.000Z",
      })
      .eq("id", firstPrivate.data?.id);
    expect(archived.error).toBeNull();
    const unavailable = await db.from("listing_snapshots").insert({
      listing_id: firstPrivate.data?.id,
      checked_at: "2026-08-23T09:00:00.000Z",
      source: "private-fixture",
      url: firstPrivate.data?.url,
      is_available: false,
    });
    expect(unavailable.error).toBeNull();

    const removed = await new PrivateRadarBridge(db).sync();
    expect(removed).toMatchObject({
      activePublications: 1,
      removedPublications: 1,
      removedEvents: 1,
    });
    const removedPublication = await db
      .from("private_publications")
      .select("state,property_id")
      .eq("legacy_listing_id", firstPrivate.data?.id)
      .single();
    expect(removedPublication.data?.state).toBe("REMOVED");
    const removedProperty = await db
      .from("properties")
      .select("property_state")
      .eq("id", removedPublication.data?.property_id)
      .single();
    expect(removedProperty.data?.property_state).toBe("OFF_MARKET_UNKNOWN");
    const historicalEvents = await db
      .from("events")
      .select("event_type")
      .eq("property_id", removedPublication.data?.property_id)
      .in("event_type", ["AGENCY_TO_PRIVATE", "PRIVATE_PUBLICATION_REMOVED"]);
    expect(historicalEvents.data).toEqual(
      expect.arrayContaining([
        { event_type: "AGENCY_TO_PRIVATE" },
        { event_type: "PRIVATE_PUBLICATION_REMOVED" },
      ]),
    );
    expect(simultaneousLegacyId).toBeTruthy();
  });

  it("preserves a manually confirmed private state across automated syncs", async () => {
    const privatePublication = await db
      .from("private_publications")
      .select("id,property_id")
      .eq("legacy_listing_id", (
        await db
          .from("listings")
          .select("id")
          .eq("source_listing_id", "simultaneous-28")
          .single()
      ).data?.id)
      .single();
    const user = await db.auth.admin.createUser({
      email: "private-radar-reviewer@example.test",
      password: "Local-only-Private-Radar-123!",
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    const overrideId = await repository.recordManualOverride({
      targetType: "PRIVATE_PUBLICATION",
      targetId: privatePublication.data?.id ?? "",
      overrideKey: "state",
      overrideValue: "REMOVED",
      previousValue: "ACTIVE",
      reason: "Owner confirmed the advert is no longer available.",
      source: "OWNER_PHONE_CONFIRMATION",
      createdBy: user.data.user?.id ?? "",
    });
    expect(overrideId).toBeTruthy();

    const replay = await new PrivateRadarBridge(db).sync();
    expect(replay.removedPublications).toBe(2);
    const preserved = await db
      .from("private_publications")
      .select("state,metadata")
      .eq("id", privatePublication.data?.id)
      .single();
    expect(preserved.data).toMatchObject({
      state: "REMOVED",
      metadata: { observedState: "ACTIVE", manualStateApplied: true },
    });
    const property = await db
      .from("properties")
      .select("property_state")
      .eq("id", privatePublication.data?.property_id)
      .single();
    expect(property.data?.property_state).toBe("ACTIVE_AGENCY");
  });

  it("routes ambiguous, sold-conflict, and out-of-scope private records safely", async () => {
    const ambiguousProperties = await db
      .from("properties")
      .insert([
        {
          property_type: "Appartamento",
          identity_status: "CONFIRMED",
          canonical_attributes: {
            address: "Via Ambigua 42",
            locality: "Bitonto",
            surfaceSqm: 90,
            rooms: 3,
            propertyType: "Appartamento",
          },
        },
        {
          property_type: "Appartamento",
          identity_status: "CONFIRMED",
          canonical_attributes: {
            address: "Via Ambigua 42",
            locality: "Bitonto",
            surfaceSqm: 90,
            rooms: 3,
            propertyType: "Appartamento",
          },
        },
      ])
      .select("id");
    expect(ambiguousProperties.error).toBeNull();
    const soldProperty = await db
      .from("properties")
      .insert({
        property_type: "Appartamento",
        identity_status: "CONFIRMED",
        sale_status: "SOLD_CONFIRMED",
        canonical_attributes: {
          address: "Via Venduta 77",
          locality: "Bitonto",
          surfaceSqm: 110,
          rooms: 4,
          propertyType: "Appartamento",
        },
      })
      .select("id")
      .single();
    expect(soldProperty.error).toBeNull();
    const ambiguousLegacyId = await insertPrivateListing(db, {
      sourceKey: "ambiguous-42",
      title: "Appartamento privato in Via Ambigua 42 a Bitonto",
      address: "Via Ambigua 42, Bitonto",
      sqm: 90,
      rooms: 3,
      available: true,
    });
    const soldLegacyId = await insertPrivateListing(db, {
      sourceKey: "sold-conflict-77",
      title: "Appartamento privato in Via Venduta 77 a Bitonto",
      address: "Via Venduta 77, Bitonto",
      sqm: 110,
      rooms: 4,
      available: true,
    });
    const outOfScopeLegacyId = await insertPrivateListing(db, {
      sourceKey: "out-of-scope-bari",
      title: "Appartamento privato a Bari",
      address: "Via Sparano 10, Bari",
      sqm: 90,
      rooms: 3,
      available: true,
    });

    const result = await new PrivateRadarBridge(db).sync();
    expect(result).toMatchObject({
      excludedListings: 1,
      createdPublications: 2,
      autoMatches: 1,
      newProperties: 1,
      reviewRequired: 1,
      soldOrManualConflicts: 1,
    });
    const ambiguousPublication = await db
      .from("private_publications")
      .select("id,property_id,identity_outcome")
      .eq("legacy_listing_id", ambiguousLegacyId)
      .single();
    expect(ambiguousPublication.data?.identity_outcome).toBe("REVIEW_REQUIRED");
    expect(
      ambiguousProperties.data?.some(
        (property) => property.id === ambiguousPublication.data?.property_id,
      ),
    ).toBe(false);
    const candidates = await db
      .from("private_property_match_candidates")
      .select("outcome,score")
      .eq("private_publication_id", ambiguousPublication.data?.id)
      .order("candidate_rank");
    expect(candidates.data?.filter((candidate) => candidate.score === 1)).toHaveLength(2);
    expect(candidates.data?.[0]?.outcome).toBe("REVIEW_REQUIRED");
    const identityReview = await db
      .from("review_queue")
      .select("status")
      .eq("dedupe_key", `private-identity:${ambiguousPublication.data?.id}:v1`)
      .single();
    expect(identityReview.data?.status).toBe("OPEN");
    const fabricatedRelist = await db
      .from("events")
      .select("id")
      .eq("property_id", ambiguousPublication.data?.property_id)
      .eq("event_type", "PRIVATE_RELIST");
    expect(fabricatedRelist.data).toEqual([]);

    const soldPublication = await db
      .from("private_publications")
      .select("property_id,identity_outcome")
      .eq("legacy_listing_id", soldLegacyId)
      .single();
    expect(soldPublication.data).toMatchObject({
      property_id: soldProperty.data?.id,
      identity_outcome: "AUTO_MATCH",
    });
    const preservedSoldProperty = await db
      .from("properties")
      .select("sale_status")
      .eq("id", soldProperty.data?.id)
      .single();
    expect(preservedSoldProperty.data?.sale_status).toBe("SOLD_CONFIRMED");
    const conflictReview = await db
      .from("review_queue")
      .select("status")
      .eq("dedupe_key", `private-sold-conflict:${(
        await db
          .from("private_publications")
          .select("id")
          .eq("legacy_listing_id", soldLegacyId)
          .single()
      ).data?.id}:v1`)
      .single();
    expect(conflictReview.data?.status).toBe("OPEN");
    const outOfScopePublication = await db
      .from("private_publications")
      .select("id")
      .eq("legacy_listing_id", outOfScopeLegacyId);
    expect(outOfScopePublication.data).toEqual([]);
  });

  it("serves the lifecycle dashboard, archive, review, and private radar read models", async () => {
    const readRepository = new PropertyLifecycleReadRepository(db);
    const [dashboard, agencies, archive, reviews, privatePublications] =
      await Promise.all([
        readRepository.dashboard(),
        readRepository.agencies(),
        readRepository.archive(),
        readRepository.reviews(),
        readRepository.privateRadar(),
      ]);

    expect(dashboard.metrics.totalProperties).toBeGreaterThan(0);
    expect(dashboard.recentEvents.length).toBeGreaterThan(0);
    expect(agencies).toHaveLength(10);
    expect(agencies.map((agency) => agency.slug)).toContain("momento-casa-bitonto");
    expect(archive.length).toBeGreaterThan(0);
    expect(reviews.some((review) => review.reviewType === "IDENTITY")).toBe(true);
    expect(reviews.some((review) => review.candidates.length >= 2)).toBe(true);
    expect(privatePublications.length).toBeGreaterThan(0);
    expect(
      privatePublications.every(
        (publication) => publication.property.id && publication.canonicalUrl,
      ),
    ).toBe(true);

    const agency = await readRepository.agency("momento-casa-bitonto");
    expect(agency?.agency.slug).toBe("momento-casa-bitonto");

    const dossier = await readRepository.property(privatePublications[0].property.id);
    expect(dossier?.property.id).toBe(privatePublications[0].property.id);
    expect(dossier?.privatePublications.length).toBeGreaterThan(0);
    expect(dossier?.events.length).toBeGreaterThan(0);
  });

  it("persists observations when the identity candidate set exceeds one PostgREST URI", async () => {
    const filler = Array.from({ length: 240 }, (_, index) => ({
      property_type: "Appartamento",
      identity_status: "PROVISIONAL",
      canonical_attributes: {
        address: `Via Batch ${index + 1}`,
        locality: "Bitonto",
        surfaceSqm: 50 + (index % 100),
        rooms: 2 + (index % 4),
        propertyType: "Appartamento",
      },
    }));
    const inserted = await db.from("properties").insert(filler);
    expect(inserted.error).toBeNull();

    const result = await runAgencySync({
      adapter: puntoCasaAdapter("postgrest-id-batch-regression"),
      repository,
      mode: "SYNC",
    });

    expect(result.healthState).toBe("HEALTHY");
    expect(result.counts).toMatchObject({
      normalizedCount: 1,
      inScopeCount: 1,
      errorCount: 0,
    });
  });
});
