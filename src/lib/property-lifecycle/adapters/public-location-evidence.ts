import {load} from 'cheerio';
import {rehashNormalizedListing,type NormalizedListingV2} from '../contracts/normalized-listing';
import type {SourceDocument} from './types';
/** Keep public clues separate from verified address data. No reverse-geocoded guess becomes a civic. */
export function enrichPublicLocationEvidence(listing:NormalizedListingV2,document:SourceDocument):NormalizedListingV2{
 const $=load(document.response.body);const candidates:Record<string,unknown>[]=[];
 // Observation time belongs to the containing snapshot, avoiding a new content hash every crawl.
 const add=(method:string,value:unknown)=>{if(value!=null)candidates.push({method,value,sourceUrl:listing.source.canonicalUrl,independentlyVerified:false});};
 for(const node of $('script[type="application/ld+json"]').toArray()){
  try{const root=JSON.parse($(node).text());const visit=(entry:unknown)=>{if(!entry||typeof entry!=='object')return;if(Array.isArray(entry)){entry.forEach(visit);return;}const obj=entry as Record<string,unknown>;const type=JSON.stringify(obj['@type']??'');
   if(/Apartment|House|Residence|RealEstateListing|SingleFamilyResidence|Accommodation/i.test(type)){add('PROPERTY_JSONLD_ADDRESS',obj.address);add('PROPERTY_JSONLD_GEO',obj.geo);add('PUBLICATION_DATE_NOT_MANDATE',obj.datePosted??obj.datePublished);}
   if(obj['@graph'])visit(obj['@graph']);if(obj.mainEntity)visit(obj.mainEntity);};visit(root);
  }catch{/* Malformed optional metadata must not fail the property read. */}
 }
 for(const frame of $('iframe[src]').toArray()){const src=$(frame).attr('src')!;try{const url=new URL(src,listing.source.canonicalUrl);if(/(^|\.)(google\.[a-z.]+|openstreetmap\.org|maps\.google\.[a-z.]+)$/.test(url.hostname))add('PUBLISHED_MAP_FRAME',url.toString());}catch{/* Ignore malformed map URLs. */}}
 if(listing.location.latitude!==null&&listing.location.longitude!==null)add('ADAPTER_PUBLISHED_COORDINATES',{latitude:listing.location.latitude,longitude:listing.location.longitude});
 if(listing.location.streetName)add('ADAPTER_DECLARED_ADDRESS',{streetName:listing.location.streetName,streetNumber:listing.location.streetNumber});
 return rehashNormalizedListing(listing,input=>({...input,provenance:{...input.provenance,publicLocationEvidence:candidates,locationEvidencePolicy:'KEEP_LAST_KNOWN_WITH_SOURCE_V1'}}));
}
