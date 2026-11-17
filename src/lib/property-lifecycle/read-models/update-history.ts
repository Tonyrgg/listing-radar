import type {SupabaseClient} from '@supabase/supabase-js';
type Data=Record<string,unknown>;
const object=(v:unknown):Data=>v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{};
export type HistoricalUpdate={field:string;label:string;before:string|number|null;after:string|number|null;at:string;sourceUrl:string;basis:string};
const scalar=(v:unknown)=>typeof v==='string'||typeof v==='number'?v:null;
export function snapshotUpdateFields(payload:unknown){const p=object(payload),c=object(p.commercial),l=object(p.location),s=object(p.source),status=object(p.status),features=object(c.features),check=object(features.adMaioraCrossCheck),wp=object(check.wordpress),checks=object(check.checks);
 return {address:scalar(l.streetName?[l.streetName,l.streetNumber].filter(Boolean).join(' '):l.rawText),street_number:scalar(l.streetNumber),latest_asking_price:scalar(c.priceAmount),rooms:scalar(c.rooms),surface_sqm:scalar(c.surfaceSqm),property_type:scalar(c.propertyType),latitude:scalar(l.latitude),longitude:scalar(l.longitude),floor:scalar(c.floor),bathrooms:scalar(c.bathrooms),source_status:scalar(status.value),site_publication:scalar(s.portalPublishedAt),wordpress_verification:checks.wordpress==='verified_identity'?'HTML e WordPress controllati':null,energy_class:scalar(object(wp.fields).energy_class),gallery_assets:Array.isArray(p.assets)?p.assets.length:null};
}
const labels:Record<string,string>={address:'Indirizzo dichiarato',street_number:'Civico',latest_asking_price:'Prezzo richiesto',rooms:'Locali',surface_sqm:'Superficie',property_type:'Tipologia',latitude:'Latitudine dichiarata',longitude:'Longitudine dichiarata',floor:'Piano',bathrooms:'Bagni',source_status:'Stato nella fonte',site_publication:'Data di pubblicazione sul sito',wordpress_verification:'Verifica dei metadati',energy_class:'Classe energetica dichiarata nei metadati',gallery_assets:'Riferimenti fotografici conservati'};
/** Compare retained readings of the same publication. Never compare two agencies' ads. */
export function compareSavedReadings(before:unknown,after:unknown,at:string,url:string):HistoricalUpdate[]{
 const a=snapshotUpdateFields(before),b=snapshotUpdateFields(after);
 return Object.entries(a).flatMap(([field,value])=>(field==='address'&&typeof value==='string'&&typeof b.address==='string'?value.toLocaleLowerCase('it').replace(/\s+/g,' ').trim()!==b.address.toLocaleLowerCase('it').replace(/\s+/g,' ').trim():value!==b[field as keyof typeof b])?[{field,label:labels[field]!,before:value,after:b[field as keyof typeof b],at,sourceUrl:url,basis:'saved_readings'}]:[]);
}
export async function readPropertyUpdateHistory(db:SupabaseClient,id:string,since:string):Promise<HistoricalUpdate[]>{
 if(!Number.isFinite(Date.parse(since)))return [];
 const listings=await db.from('agency_listings').select('id').eq('property_id',id);if(listings.error)throw Error('Storico non disponibile');
 const ids=(listings.data??[]).map(r=>r.id);if(!ids.length)return [];
 const pubs=await db.from('publications').select('id,canonical_url').in('agency_listing_id',ids);if(pubs.error)throw Error('Pubblicazioni non disponibili');
 const changes:HistoricalUpdate[]=[];
 for(const pub of pubs.data??[]){
  const [old,current]=await Promise.all([
   db.from('snapshots').select('observed_at,normalized_payload').eq('publication_id',pub.id).lte('observed_at',since).order('observed_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle(),
   db.from('snapshots').select('observed_at,normalized_payload').eq('publication_id',pub.id).gt('observed_at',since).order('observed_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()]);
  if(old.error||current.error)throw Error('Letture storiche non disponibili');
  if(old.data?.normalized_payload&&current.data?.normalized_payload)changes.push(...compareSavedReadings(old.data.normalized_payload,current.data.normalized_payload,current.data.observed_at,pub.canonical_url));
 }
 const events=await db.from('events').select('event_type,occurred_at,payload,publication_id').eq('property_id',id).gt('occurred_at',since).in('event_type',['PRICE_CHANGED','PRICE_DROP','PRICE_INCREASE','PUBLICATION_REMOVED','DISAPPEARED_CONFIRMED','SOURCE_MARKED_SOLD','PUBLICATION_REAPPEARED','AGENCY_SWITCH_DETECTED']).order('occurred_at',{ascending:false}).limit(100);
 if(events.error)throw Error('Eventi storici non disponibili');
 for(const row of events.data??[]){const p=object(row.payload);if(typeof p.oldPrice==='number'&&typeof p.newPrice==='number'&&p.oldPrice!==p.newPrice&&!changes.some(c=>c.field==='latest_asking_price'&&c.before===p.oldPrice&&c.after===p.newPrice))changes.push({field:'latest_asking_price',label:'Prezzo richiesto',before:p.oldPrice,after:p.newPrice,at:row.occurred_at,sourceUrl:'',basis:'price_event'});}
 const outcomes:Record<string,string>={PUBLICATION_REMOVED:'Annuncio non più rilevato dalla fonte',DISAPPEARED_CONFIRMED:'Scomparsa dell’annuncio confermata',SOURCE_MARKED_SOLD:'La fonte segnala venduto',PUBLICATION_REAPPEARED:'Annuncio nuovamente presente',AGENCY_SWITCH_DETECTED:'Cambio di agenzia rilevato'};
 for(const row of events.data??[]){const after=outcomes[row.event_type];if(after)changes.push({field:'recorded_event',label:'Evento dell’annuncio',before:null,after,at:row.occurred_at,sourceUrl:(pubs.data??[]).find(p=>p.id===row.publication_id)?.canonical_url??'',basis:'recorded_event'});}
 return changes;
}
