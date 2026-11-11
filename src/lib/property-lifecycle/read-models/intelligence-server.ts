import "server-only";
import {unstable_cache} from "next/cache";
import {getSupabaseServiceClient} from "@/lib/supabase/service";
import {readIntelligence,type IntelligenceFilters} from "./intelligence";

// Private layout enforces authentication. Only the shared market archive is cached,
// never sessions or user-specific data. Throw on failed reads so a refresh cannot
// replace a valid cache entry with an empty archive.
export const readCachedIntelligence=unstable_cache(
 (filters:IntelligenceFilters)=>readIntelligence(getSupabaseServiceClient(),filters),
 ["intelligence-indexed-v1",process.env.NEXT_PUBLIC_SUPABASE_URL??"unconfigured"],
 {revalidate:60,tags:["lifecycle"]},
);
