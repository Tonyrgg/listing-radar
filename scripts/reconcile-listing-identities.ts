import { createClient } from "@supabase/supabase-js";

import { comparePropertyIdentity } from "../src/lib/listings/property-identity";
import { classifySeller } from "../src/lib/listings/seller-classification";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono obbligatori.");
}

const db = createClient(url, key, { auth: { persistSession: false } });

type Row = {
  id: string;
  source: string;
  title: string;
  description: string | null;
  address_raw: string | null;
  zone: string | null;
  price: number | null;
  sqm: number | null;
  rooms: number | null;
  floor: string | null;
  latitude: number | null;
  longitude: number | null;
  seller_type: "private" | "agency" | "unknown";
  seller_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  crm_status: "untreated" | "treated";
};

function canonicalFirst(left: Row, right: Row) {
  if (left.crm_status !== right.crm_status) {
    return left.crm_status === "treated" ? [left, right] : [right, left];
  }
  return left.first_seen_at.localeCompare(right.first_seen_at) <= 0
    ? [left, right]
    : [right, left];
}

async function main() {
  const { data, error } = await db
    .from("listings")
    .select(
      "id,source,title,description,address_raw,zone,price,sqm,rooms,floor,latitude,longitude,seller_type,seller_name,first_seen_at,last_seen_at,crm_status",
    )
    .neq("status", "archived")
    .order("first_seen_at", { ascending: true });
  if (error) throw error;

  const rows = data as Row[];
  const removed = new Set<string>();
  const matches: Array<{
    target: Row;
    duplicate: Row;
    score: number;
    reasons: string[];
  }> = [];

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    if (removed.has(left.id)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      if (removed.has(right.id)) continue;
      const identity = comparePropertyIdentity(left, right);
      if (!identity.autoMerge) continue;
      const [target, duplicate] = canonicalFirst(left, right);
      matches.push({ target, duplicate, score: identity.score, reasons: identity.reasons });
      removed.add(duplicate.id);
    }
  }

  const sellerCorrections = rows
    .map((row) => ({
      row,
      classification: classifySeller({
        source: row.source,
        declaredType: row.seller_type,
        sellerName: row.seller_name,
        title: row.title,
        description: row.description,
      }),
    }))
    .filter(({ row, classification }) => row.seller_type !== classification.sellerType);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        scanned: rows.length,
        certainPropertyMerges: matches.length,
        sellerCorrections: sellerCorrections.length,
        mergePreview: matches.slice(0, 30).map(({ target, duplicate, score, reasons }) => ({
          target: target.id,
          duplicate: duplicate.id,
          sources: [target.source, duplicate.source],
          title: target.title,
          score,
          reasons,
        })),
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Nessun dato modificato. Usa --apply soltanto dopo la migration 015.");
    return;
  }

  for (const { row, classification } of sellerCorrections) {
    const { error: updateError } = await db
      .from("listings")
      .update({
        seller_type: classification.sellerType,
        seller_classification_confidence: classification.confidence,
        seller_classification_reasons: classification.reasons,
      })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  for (const match of matches) {
    const { error: mergeError } = await db.rpc("merge_listing_records", {
      target_listing_id: match.target.id,
      duplicate_listing_id: match.duplicate.id,
    });
    if (mergeError) throw mergeError;
  }

  console.log(
    `Riconciliazione completata: ${sellerCorrections.length} venditori corretti, ${matches.length} duplicati certi fusi.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
