import { createClient } from "@supabase/supabase-js";

import {
  BuildingIntelligenceImporter,
  DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,
  DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
} from "../src/lib/property-lifecycle/buildings/importer";

function localConfiguration(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante.");
  if (!["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname)) {
    throw new Error("Building live validation refuses non-local Supabase.");
  }
  return { url, key };
}

async function main(): Promise<void> {
  const { url, key } = localConfiguration();
  const response = await fetch(DEFAULT_BUILDING_PRACTICE_SOURCE_URL, {
    headers: {
      "user-agent": "ListingRadarLifecycle/2.0 (+building validation)",
      accept: "text/csv,text/plain;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`Dataset building returned HTTP ${response.status}.`);
  const csv = await response.text();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tableCount = async (table: string): Promise<number> => {
    const result = await db.from(table).select("*", { count: "exact", head: true });
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  };
  const propertiesBefore = await db.from("properties").select("id,building_id");
  if (propertiesBefore.error) throw new Error(propertiesBefore.error.message);
  const importer = new BuildingIntelligenceImporter(db);
  const first = await importer.importCsv({
    sourceKey: DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,
    sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
    csv,
    sourceEtag: response.headers.get("etag"),
    sourceLastModified: response.headers.get("last-modified"),
    applicationCode: "ape",
  });
  const replay = await importer.importCsv({
    sourceKey: DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,
    sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
    csv,
    sourceEtag: response.headers.get("etag"),
    sourceLastModified: response.headers.get("last-modified"),
    applicationCode: "ape",
  });
  const samples = await db
    .from("building_practice_records")
    .select("application_code,practice_number,intervention_type,sanitized_payload")
    .eq("source_key", DEFAULT_BUILDING_PRACTICE_SOURCE_KEY)
    .limit(25);
  if (samples.error) throw new Error(samples.error.message);
  const serialized = JSON.stringify(samples.data ?? []);
  const propertiesAfter = await db.from("properties").select("id,building_id");
  if (propertiesAfter.error) throw new Error(propertiesAfter.error.message);

  console.info(JSON.stringify({
    observedAt: new Date().toISOString(),
    sourceUrl: DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
    response: {
      status: response.status,
      bytes: Buffer.byteLength(csv),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    },
    first,
    replay,
    persisted: {
      practices: await tableCount("building_practice_records"),
      observations: await tableCount("building_practice_observations"),
      buildings: await tableCount("buildings"),
      practiceBuildingLinks: await tableCount("building_practice_buildings"),
      buildingEvents: await tableCount("building_events"),
    },
    privacy: {
      sampledRecords: samples.data?.length ?? 0,
      containsForbiddenPersonalFieldNames: /cognome|ragione sociale|\"nome\"/i.test(serialized),
    },
    propertyAssociation: {
      before: propertiesBefore.data,
      after: propertiesAfter.data,
      unchanged: JSON.stringify(propertiesBefore.data) === JSON.stringify(propertiesAfter.data),
    },
  }));
}

void main();
