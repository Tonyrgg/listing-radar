import { createHash } from "node:crypto";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import type { IntelligenceRow } from "../src/lib/property-lifecycle/read-models/intelligence";

const closedView = new Set([
  "SOLD_CONFIRMED", "SOLD_PROBABLE", "WITHDRAWN", "RELISTED",
  "AGENCY_CHANGED", "UNKNOWN_EXIT", "MISSING_UNCONFIRMED",
]);

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data) throw new Error("Lettura del piano di pulizia non riuscita");
    rows.push(...data as T[]);
    if (data.length < 1000) return rows;
  }
  throw new Error("Limite della lettura superato");
}

type Row = Pick<IntelligenceRow, "property_id" | "agency_id" | "state" | "exit_classification" |
  "street_name" | "street_number" | "latitude" | "longitude" | "location_precision" | "agency_started_at">;
type Presence = { property_id: string; state: string };
type Property = { id: string; property_state: string };
function coverage(rows: Row[]) {
  return {
    records: rows.length,
    documentedAgencyStart: rows.filter(row => row.agency_started_at).length,
    streetAndCivic: rows.filter(row => row.street_name && row.street_number).length,
    coordinatesWithExactPrecision: rows.filter(row => row.latitude != null && row.longitude != null &&
       ["EXACT_ADDRESS", "EXACT_COORDINATES"].includes(row.location_precision ?? "")).length,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante");
  const host = new URL(url).hostname;
  if (!["localhost","127.0.0.1"].includes(host) &&
      !process.argv.includes(`--confirm-project=${host.split(".")[0]}`)) {
    throw new Error("Indicare il progetto remoto con --confirm-project=<ref>");
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const [rows, agencies, privates, properties] = await Promise.all([
    readAll<Row>((from,to) => db.from("radar_property_live_archive")
      .select("row_id,property_id,agency_id,state,exit_classification,street_name,street_number,latitude,longitude,location_precision,agency_started_at")
      .order("row_id").range(from,to)),
    readAll<Presence>((from,to) => db.from("agency_listings").select("id,property_id,state").in("state",["ACTIVE","EXIT_PENDING"])
      .order("id").range(from,to)),
    readAll<Presence>((from,to) => db.from("private_publications").select("id,property_id,state").eq("state","ACTIVE")
      .order("id").range(from,to)),
    readAll<Property>((from,to) => db.from("properties").select("id,property_state").order("id").range(from,to)),
  ]);
  const unknownExitOnly = process.argv.includes("--unknown-exit-only");
  const listed = new Set(rows.filter(row => unknownExitOnly
    ? row.exit_classification === "UNKNOWN_EXIT" && row.state === "OFF_MARKET_NO_SALE_EVIDENCE"
    : closedView.has(row.exit_classification)).map(row => row.property_id));
  const online = new Set([...agencies,...privates].filter(row => row.state === "ACTIVE").map(row => row.property_id));
  const protectedIds = new Set([
    ...agencies.map(row => row.property_id), ...privates.map(row => row.property_id),
    ...properties.filter(row => row.property_state.startsWith("ACTIVE")).map(row => row.id),
  ]);
  const candidates = [...listed].filter(id => !protectedIds.has(id)).sort();
  let externalReceipts = 0;
  for (let offset = 0; offset < candidates.length; offset += 50) {
    const response = await db.from("fingerprint_archive_receipts").select("id",{count:"exact",head:true})
      .in("property_id",candidates.slice(offset,offset+50));
    if (response.error || response.count === null) throw new Error("Riferimenti all’archivio esterno non verificabili");
    externalReceipts += response.count;
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    scope: unknownExitOnly ? "unknown_exit_only" : "closed_view",
    closedViewUnique: listed.size,
    protectedOnlineOrPending: listed.size - candidates.length,
    cleanupCandidates: candidates.length,
    candidateSetSha256: createHash("sha256").update(candidates.join("\n")).digest("hex"),
    externalReceipts,
    onlineProperties: online.size,
    agencyCoverage: coverage(rows.filter(row => row.agency_id && row.state==="ACTIVE" && online.has(row.property_id))),
    privateCoverage: coverage(rows.filter(row => !row.agency_id && online.has(row.property_id))),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Piano non disponibile");
  process.exitCode = 1;
});
