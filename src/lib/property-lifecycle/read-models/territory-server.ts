import "server-only";
import {unstable_cache} from "next/cache";
import {getSupabaseServiceClient} from "@/lib/supabase/service";
import type {IntelligenceRow} from "./intelligence";

// No evidence payloads or scoring components travel with the map. The dossier
// remains the source of full details. Human changes invalidate the lifecycle tag.
export const TERRITORY_PROPERTY_FIELDS="property_id,row_id,agency_name,address,locality,zone_name,state,property_state,sale_status,exit_classification,first_seen_at,last_seen_at,earliest_market_evidence_at,latest_asking_price,first_asking_price,reduction_percent,drop_count,sold_at,sold_observed_at,opportunity_score,property_type,surface_sqm,rooms,latitude,longitude,location_precision,publication_count,evidence_count,document_count,publication_sources,attributes,agent_name,earliest_known_asking,earliest_known_asking_at,relaunch_count,public_record_count,building_record_count,specific_record_count,recent_street_count,latest_public_record_type,latest_public_record_date,source_price_conflict";

export const readTerritoryProperties=unstable_cache(async()=>{
 const db=getSupabaseServiceClient(),rows:IntelligenceRow[]=[];
 for(let from=0;;from+=1000){
  const result=await db.from("market_observer_graph_property_archive").select(TERRITORY_PROPERTY_FIELDS).order("property_id").range(from,from+999);
  if(result.error)throw Error(result.error.message);
  const page=result.data as IntelligenceRow[];
  rows.push(...page.map(row=>({...row,attributes:{floor:row.attributes?.floor,features:row.attributes?.features}})));
  if(page.length<1000)return rows;
 }
},["territory-properties-v1",process.env.NEXT_PUBLIC_SUPABASE_URL??"unconfigured"],{revalidate:60,tags:["lifecycle"]});
