import type {SupabaseClient} from '@supabase/supabase-js';
import {rehashNormalizedListing,type NormalizedListingV2} from '../contracts/normalized-listing';
export function pinAddressKey(lat:number,lon:number){return `${lat.toFixed(6)},${lon.toFixed(6)}`;}
export function applyPinAddress(listing:NormalizedListingV2,proof:Record<string,unknown>):NormalizedListingV2{
 const a=proof.address&&typeof proof.address==='object'?proof.address as Record<string,unknown>:{};
 const road=typeof a.road==='string'?a.road:null,number=typeof a.house_number==='string'?a.house_number:null;
 if(!road)return listing;
 const latitude=Number(proof.lat),longitude=Number(proof.lon);
 const distance=Math.hypot((latitude-listing.location.latitude!)*111320,(longitude-listing.location.longitude!)*84000);
 if(!Number.isFinite(distance)||distance>50||a.country_code!=='it')return listing;
 return rehashNormalizedListing(listing,input=>{
  const location={...input.location,reasons:[...input.location.reasons]};
  const compatible=!location.streetName||location.streetName.toLocaleLowerCase('it').trim()===road.toLocaleLowerCase('it').trim();
  if(!location.streetName){location.streetName=road;location.rawText=[road,location.rawText].filter(Boolean).join(', ');location.reasons.push('street_from_published_pin_reverse_lookup');}
  if(!location.streetNumber&&number&&compatible&&distance<=20){location.streetNumber=number;location.reasons.push('civic_from_published_pin_reverse_lookup:not_entrance_verified');}
  location.resolutionMethod='PUBLISHER_PIN_OSM_REVERSE';
  // Keep the publisher's point. Never replace it with the geocoder's nearest feature.
  location.precision='EXACT_COORDINATES';
  return {...input,location,provenance:{...input.provenance,pinAddressLookup:{...proof,distanceMeters:Math.round(distance),civicIsCandidate:true,source:'OpenStreetMap / Nominatim',licence:'ODbL 1.0',sourceUrl:`https://www.openstreetmap.org/${proof.osm_type}/${proof.osm_id}`}}};
 });
}
export async function enrichCachedPinAddress(db:SupabaseClient,listing:NormalizedListingV2){
 if(!['vistocasa','futura'].includes(listing.adapterKey)||!listing.provenance.publishedMapPin||listing.location.latitude===null||listing.location.longitude===null)return listing;
 const result=await db.from('publisher_pin_address_cache').select('payload').eq('pin_key',pinAddressKey(listing.location.latitude,listing.location.longitude)).maybeSingle();
 if(result.error||!result.data)return listing;
 return applyPinAddress(listing,result.data.payload);
}
