import "server-only";
import {unstable_cache} from "next/cache";
import {getSupabaseServiceClient} from "@/lib/supabase/service";
import {loadTerritoryProperties} from './territory-loader';
export {TERRITORY_PROPERTY_FIELDS} from './territory-loader';

// No evidence payloads or scoring components travel with the map. The dossier
// remains the source of full details. Human changes invalidate the lifecycle tag.

export const readTerritoryProperties=unstable_cache(async()=>{
 return loadTerritoryProperties(getSupabaseServiceClient());
},["territory-properties-v4-live-decisions",process.env.NEXT_PUBLIC_SUPABASE_URL??"unconfigured"],{revalidate:60,tags:["lifecycle"]});
