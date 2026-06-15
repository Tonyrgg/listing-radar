import { getSupabaseServiceClient } from "@/lib/supabase/service";

type DuplicateCandidate = {
  id: string;
  title: string;
  address_raw: string | null;
  zone: string | null;
  price: number | null;
  sqm: number | null;
  duplicate_group_id: string | null;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function titleSimilarity(left: string, right: string) {
  const leftWords = new Set(normalize(left).split(" ").filter((word) => word.length > 2));
  const rightWords = new Set(normalize(right).split(" ").filter((word) => word.length > 2));
  const union = new Set([...leftWords, ...rightWords]);
  if (!union.size) return 0;
  return [...leftWords].filter((word) => rightWords.has(word)).length / union.size;
}

export function duplicateConfidence(
  listing: Omit<DuplicateCandidate, "id" | "duplicate_group_id">,
  candidate: DuplicateCandidate,
) {
  let confidence = 0;
  const address = normalize(listing.address_raw);
  if (address && address === normalize(candidate.address_raw)) confidence += 4;
  if (titleSimilarity(listing.title, candidate.title) >= 0.65) confidence += 3;
  if (listing.sqm && candidate.sqm && Math.abs(listing.sqm - candidate.sqm) <= 5) confidence += 2;
  if (listing.price && candidate.price && Math.abs(listing.price - candidate.price) / listing.price <= 0.05) confidence += 1;
  if (normalize(listing.zone) && normalize(listing.zone) === normalize(candidate.zone)) confidence += 1;
  return confidence;
}

export async function assignDuplicateGroup(listing: DuplicateCandidate) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("listings")
    .select("id,title,address_raw,zone,price,sqm,duplicate_group_id")
    .neq("id", listing.id)
    .limit(200);
  const match = (data as DuplicateCandidate[] | null)
    ?.map((candidate) => ({ candidate, confidence: duplicateConfidence(listing, candidate) }))
    .filter((result) => result.confidence >= 6)
    .sort((left, right) => right.confidence - left.confidence)[0];

  if (!match) return null;
  const groupId = match.candidate.duplicate_group_id ?? crypto.randomUUID();
  await supabase.from("listings").update({ duplicate_group_id: groupId }).in(
    "id",
    [listing.id, match.candidate.id],
  );
  return groupId;
}
