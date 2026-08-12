import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  comparePropertyIdentity,
  type PropertyIdentityInput,
} from "@/lib/listings/property-identity";

export type DuplicateCandidate = PropertyIdentityInput & {
  id: string;
  duplicate_group_id: string | null;
};

export function duplicateConfidence(
  listing: PropertyIdentityInput,
  candidate: DuplicateCandidate,
) {
  return Math.round(comparePropertyIdentity(listing, candidate).score * 10);
}

/**
 * Keeps uncertain matches visible for manual review. Certain matches are merged
 * before persistence and therefore never need a duplicate group.
 */
export async function assignDuplicateGroup(listing: DuplicateCandidate) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("listings")
    .select(
      "id,title,description,address_raw,zone,price,sqm,rooms,floor,latitude,longitude,duplicate_group_id",
    )
    .neq("id", listing.id)
    .neq("status", "archived")
    .limit(500);
  const match = (data as DuplicateCandidate[] | null)
    ?.map((candidate) => ({
      candidate,
      result: comparePropertyIdentity(listing, candidate),
    }))
    .filter(({ result }) => result.possibleDuplicate && !result.autoMerge)
    .sort((left, right) => right.result.score - left.result.score)[0];

  if (!match) return null;
  const groupId = crypto.randomUUID();
  await supabase
    .from("listings")
    .update({ duplicate_group_id: groupId })
    .in("id", [listing.id, match.candidate.id]);
  return groupId;
}
