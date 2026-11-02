"use server";
import {requireUser} from "@/lib/auth";
import {getSupabaseServiceClient} from "@/lib/supabase/service";
import {readPublicRecordMap} from "@/lib/property-lifecycle/buildings/read-model";
import {readBuildingMap} from "@/lib/property-lifecycle/buildings/graph-read-model";

/** Only requested when the user enables territorial context layers. */
export async function loadTerritoryLayers(){
 await requireUser();
 const db=getSupabaseServiceClient();
 const [records,buildings]=await Promise.allSettled([readPublicRecordMap(db),readBuildingMap(db)]);
 return {recordMap:records.status==="fulfilled"?records.value:null,buildingMap:buildings.status==="fulfilled"?buildings.value:null};
}
