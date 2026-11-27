import {load} from "cheerio";
import {rehashNormalizedListing,type NormalizedListingV2} from "../contracts/normalized-listing";
import {resolveMonitoredGeography} from "../geography/scope";
import type {SourceDocument} from "./types";

type Fields = Record<string,unknown>;
const asFields = (value:unknown):Fields|null => value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Fields:null;
const asText = (value:unknown):string|null => typeof value==="string"&&value.trim()?value.trim():null;
function sameUrl(value:unknown, canonical:string):boolean {
  if(typeof value!=="string")return false;
  try{
    const actual=new URL(value,canonical),expected=new URL(canonical);
    actual.hash="";expected.hash="";
    return actual.href===expected.href;
  }catch{return false;}
}

function publicDate(value:unknown, observedAt:string):string|null {
  if(typeof value!=="string")return null;
  const iso=/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.exec(value.trim());
  if(!iso)return null;
  const day=Date.parse(iso[1]+"T00:00:00Z"), actual=Date.parse(value);
  if(!Number.isFinite(day)||!Number.isFinite(actual)||new Date(day).toISOString().slice(0,10)!==iso[1]||actual>Date.parse(observedAt))return null;
  return new Date(actual).toISOString();
}

/** Adopt explicit data only from a unique JSON-LD entity tied to this URL.
 * Nearby map centers and other listings stay distinguishable as clues. */
export function enrichPublicLocationEvidence(listing:NormalizedListingV2,document:SourceDocument):NormalizedListingV2{
  const $=load(document.response.body),canonical=listing.source.canonicalUrl;
  const candidates:Record<string,unknown>[]=[],matched:Fields[]=[];
  const add=(method:string,value:unknown)=>{
    if(value!=null)candidates.push({method,value,sourceUrl:canonical,independentlyVerified:false});
  };
  const visit=(entry:unknown,parentMatched=false)=>{
    if(Array.isArray(entry)){entry.forEach(value=>visit(value,parentMatched));return;}
    const obj=asFields(entry);if(!obj)return;
    const pageRef = asFields(obj.mainEntityOfPage);
    const identities = [obj.url, obj["@id"], typeof obj.mainEntityOfPage === "string" ? obj.mainEntityOfPage : pageRef?.["@id"], pageRef?.url]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const match = (parentMatched || identities.length > 0) && identities.every(value => sameUrl(value, canonical));
    if(/Apartment|House|Residence|RealEstateListing|SingleFamilyResidence|Accommodation/i.test(JSON.stringify(obj["@type"]??""))){
      add("PROPERTY_JSONLD_ADDRESS",obj.address);
      add("PROPERTY_JSONLD_GEO",obj.geo);
      add("PUBLICATION_DATE_NOT_MANDATE",obj.datePosted??obj.datePublished);
      if(match)matched.push(obj);
    }
    if(obj["@graph"])visit(obj["@graph"]);
    if(obj.mainEntity)visit(obj.mainEntity,match);
  };
  for(const node of $('script[type="application/ld+json"]').toArray()) {
    try{visit(JSON.parse($(node).text()));}catch{ /* Optional metadata. */ }
  }
  for(const frame of $('iframe[src]').toArray()){
    try{
      const url=new URL($(frame).attr('src')!,canonical);
      if(/(^|\.)(google\.[a-z.]+|openstreetmap\.org|maps\.google\.[a-z.]+)$/.test(url.hostname))add('PUBLISHED_MAP_FRAME',url.toString());
    }catch{ /* Optional map evidence. */ }
  }
  if(listing.location.latitude!==null&&listing.location.longitude!==null)add('ADAPTER_PUBLISHED_COORDINATES',{latitude:listing.location.latitude,longitude:listing.location.longitude});
  if(listing.location.streetName)add('ADAPTER_DECLARED_ADDRESS',{streetName:listing.location.streetName,streetNumber:listing.location.streetNumber});
  const matchedAddresses=matched.map(node=>asFields(node.address)).filter((row):row is Fields=>row!==null);
  const sameAddress=new Set(matchedAddresses.map(row=>JSON.stringify([row.streetAddress,row.addressLocality,row.postalCode])));
  const exact=sameAddress.size===1?matchedAddresses[0]:null;
  const dates=new Set(matched.map(node=>publicDate(node.datePosted??node.datePublished,listing.observedAt)).filter(Boolean));
  const date=dates.size===1?[...dates][0]:null;
  let location=listing.location;
  if(exact&&location.scope!=="OUT_OF_SCOPE"&&!location.streetNumber){
    const address=resolveMonitoredGeography({
      rawText:[asText(exact.streetAddress),asText(exact.addressLocality)].filter(Boolean).join(", "),
      locality:asText(exact.addressLocality)??location.locality,
      municipality:location.municipality,
      postalCode:asText(exact.postalCode)??location.postalCode,
      latitude:location.latitude,longitude:location.longitude,
      coordinatesExact:location.precision==="EXACT_COORDINATES",
    });
    const compatible=!location.streetName||location.streetName.localeCompare(address.streetName??"","it",{sensitivity:"base"})===0;
    if(compatible&&address.scope==="IN_SCOPE"&&address.streetNumber)location={
      ...location,...address,zoneName:location.zoneName,
      resolutionMethod:"PUBLISHER_JSONLD_ADDRESS",
    };
  }
  return rehashNormalizedListing(listing,input=>{
    const published=date&&!input.source.portalPublishedAt?date:null;
    const improvesFirstSeen=published&&input.marketStart.method==="CRAWLER_FIRST_SEEN"&&
      (!input.marketStart.upperBound||published<input.marketStart.upperBound);
    return {
      ...input,location,
      source:{...input.source,...(published?{portalPublishedAt:published}:{})},
      marketStart:improvesFirstSeen?{
        lowerBound:null,upperBound:published,method:"PUBLISHER_JSONLD_PUBLICATION_DATE",confidence:0.7,
        evidence:[...input.marketStart.evidence,{
          kind:"PORTAL_PUBLICATION_DATE",claimKey:"publication.datePublished",sourceUrl:canonical,
          extractionMethod:"PUBLISHER_JSONLD_PUBLICATION_DATE",rawValue:published,normalizedValue:published,
          confidence:0.7,observedAt:input.observedAt,sourceRecordedAt:published,metadata:{},
        }],
      }:input.marketStart,
      provenance:{...input.provenance,publicLocationEvidence:candidates,locationEvidencePolicy:"KEEP_LAST_KNOWN_WITH_SOURCE_V1"},
    };
  });
}
