import type {SupabaseClient} from '@supabase/supabase-js';
/** Read retained observations, not the remote URL: missing/removed publications remain readable. */
export async function readSavedSnapshots(db:SupabaseClient,propertyId:string){
 const listings=await db.from('agency_listings').select('id').eq('property_id',propertyId);
 if(listings.error)throw Error('Archivio delle schede non disponibile');
 if(!listings.data?.length)return [];
 const pubs=await db.from('publications').select('id,canonical_url,state').in('agency_listing_id',listings.data.map(r=>r.id)).order('last_seen_at',{ascending:false});
 if(pubs.error)throw Error('Pubblicazioni salvate non disponibili');
 // Individual indexed lookups avoid reading every historical payload for every dossier.
 return Promise.all((pubs.data??[]).map(async publication=>{
  const snapshot=await db.from('snapshots').select('id,observed_at,normalized_payload').eq('publication_id',publication.id).order('observed_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  if(snapshot.error)throw Error('Scheda conservata temporaneamente non disponibile');
  return {publicationId:publication.id,url:publication.canonical_url,state:publication.state,snapshot:snapshot.data??null};
 }));
}
