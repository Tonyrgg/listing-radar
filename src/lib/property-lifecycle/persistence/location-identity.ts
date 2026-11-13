import type {NormalizedListingV2} from '../contracts/normalized-listing';
import {hashValue} from '../contracts/normalized-listing';

/** A publisher's property pin must not share an area-address row with other ads. */
export function listingLocationKey(listing:NormalizedListingV2){
 const pin=listing.provenance.publishedMapPin;
 return hashValue({
  municipality:listing.location.municipality,locality:listing.location.locality,
  postalCode:listing.location.postalCode,streetName:listing.location.streetName,
  streetNumber:listing.location.streetNumber,rawText:listing.location.rawText,
  ...(pin&&typeof pin==='object'&&listing.location.latitude!==null&&listing.location.longitude!==null
   ?{publisherPin:{adapter:listing.adapterKey,sourceKey:listing.source.sourceKey}}:{}),
 });
}
