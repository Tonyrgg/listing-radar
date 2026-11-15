import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readTerritoryWorkAreas} from './work-areas';
import {buildZoneStreetDirectory,type DirectoryStreet} from '../../../worker/src/territory/zone-streets';

export async function readWorkerStreetDirectory(db:SupabaseClient,ownerId:string){
 const [areas,result]=await Promise.all([readTerritoryWorkAreas(db),db.rpc('read_worker_street_directory',{p_owner_id:ownerId})]);
 if(result.error)throw Error('Elenco vie del Worker non disponibile. Riprova.');
 return{...buildZoneStreetDirectory((result.data?.streets??[]) as DirectoryStreet[],areas),revision:result.data?.revision??0,fetchedAt:new Date().toISOString()};
}
