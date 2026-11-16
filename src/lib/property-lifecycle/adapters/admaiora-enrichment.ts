import {load} from 'cheerio';
import type {NormalizedListingV2} from '../contracts/normalized-listing';
import {resolveMonitoredGeography} from '../geography/scope';

export const AD_MAIORA_PORTAL_CATALOG='https://www.idealista.it/pro/ad-maiora-immobiliare-bitonto/';
type ObjectData=Record<string,unknown>;
export function objectData(value:unknown):ObjectData{return value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectData:{};}
function text(value:unknown):string|null {if(typeof value!=='string')return null;return load(value).text().replace(/\s+/g,' ').trim()||null;}
function number(value:unknown):number|null {if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
const clean=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

/** Select public commercial fields only: never ingest WP owner/private-note fields. */
export function compactAdMaioraRest(raw:unknown,id:string,url:string):ObjectData|null {
 const row=objectData(raw);let link:URL;try{link=new URL(String(row.link));}catch{return null;}
 if(String(row.id)!==id||link.origin!=='https://www.admaioraimmobiliare.it'||link.pathname.replace(/\/$/,'')!==new URL(url).pathname.replace(/\/$/,''))return null;
 const meta=objectData(row.property_meta),fields: ObjectData={};
 for(const key of ['price','old_price','size','lot_size','bedrooms','bathrooms','garage','id','year_built','address'])fields[key]=meta[`REAL_HOMES_property_${key}`]??null;
 fields.energy_class=meta.REAL_HOMES_energy_class??null;
 fields.additional_details=meta.REAL_HOMES_additional_details_list??[];
 fields.floor_plans=meta.inspiry_floor_plans??[];
 fields.attachments=meta.REAL_HOMES_attachments??[];
 const media=Array.isArray(meta.REAL_HOMES_property_images)?meta.REAL_HOMES_property_images:[];
 return {id:row.id,url:link.href,dateGmt:row.date_gmt??null,modifiedGmt:row.modified_gmt??null,title:text(objectData(row.title).rendered),description:text(objectData(row.content).rendered),featuredMedia:row.featured_media??null,classes:row.class_list??[],fields,images:media.slice(0,60).map(raw=>{const m=objectData(raw);return {id:m.ID??null,url:m.full_url??m.url??null,title:text(m.title),alt:text(m.alt),caption:text(m.caption)};})};
}

export interface PortalCard {url:string;address:string;price:number|null;surface:number|null;rooms:number|null;description:string;floor:string|null;}
export function parseAdMaioraPortalCatalog(html:string,url=AD_MAIORA_PORTAL_CATALOG):PortalCard[]{
 if(/captcha|cf-chl-|Access Denied/i.test(html))return [];
 const $=load(html);if(!/Ad Maiora/i.test($('h1').text()))return [];
 const cards:PortalCard[]=[];
 $('article.item,article[data-element-id]').each((_,el)=>{
  const card=$(el),anchor=card.find('a.item-link').first();let target:URL;try{target=new URL(anchor.attr('href')??'',url);}catch{return;}
  if(target.origin!=='https://www.idealista.it'||!/^\/immobile\/\d+\/?$/.test(target.pathname))return;
  const details=card.find('.item-detail').toArray().map(el=>$(el).text().trim());
  cards.push({url:target.href,address:anchor.text().trim(),price:Number(card.find('.item-price').first().text().replace(/[^\d]/g,''))||null,surface:Number(details.find(v=>/m[²2]/.test(v))?.match(/[\d.]+/)?.[0]?.replace(/\./g,''))||null,rooms:Number(details.find(v=>/local/i.test(v))?.match(/\d+/)?.[0])||null,description:card.find('.item-description').text().replace(/\s+/g,' ').trim(),floor:details.find(v=>/piano/i.test(v))??null});
 });
 return [...new Map(cards.map(card=>[card.url,card])).values()];
}

/** Require street + commercial facts + distinctive description; ambiguity never fills a civic. */
export function matchAdMaioraPortal(listing:NormalizedListingV2,cards:PortalCard[]):PortalCard|null {
 const street=listing.location.streetName;if(!street||!listing.commercial.description)return null;
 const phrase=clean(listing.commercial.description).replace(/^l agenzia immobiliare ad maiora immobiliare propone in vendita /,'').split(' ').filter(w=>w.length>3).slice(0,24);
 const matches=[...new Map(cards.map(card=>[card.url,card])).values()].filter(card=>{
  const location=resolveMonitoredGeography({rawText:card.address});
  const a=clean(location.streetName??''),b=clean(street);
  const words=new Set(clean(card.description).split(' '));
  return a===b&&location.scope==='IN_SCOPE'&&card.price!=null&&card.price===listing.commercial.priceAmount&&card.surface!=null&&card.surface===listing.commercial.surfaceSqm&&card.rooms===listing.commercial.rooms&&phrase.length>=8&&phrase.filter(w=>words.has(w)).length/phrase.length>=0.65;
 });
 return matches.length===1?matches[0]!:null;
}

export function enrichAdMaioraListing(listing:NormalizedListingV2,rest: ObjectData|null,media: ObjectData|null,cards:PortalCard[],checks:Record<string,unknown>):void {
 const fields=objectData(rest?.fields),conflicts:Array<{field:string;html:unknown;wordpress:unknown}>=[];
 for(const [key,field]of [['priceAmount','price'],['surfaceSqm','size'],['rooms','bedrooms'],['bathrooms','bathrooms']] as const){
  const value=number(fields[field]);if(value===null)continue;
  if(listing.commercial[key]==null)listing.commercial[key]=value;
  else if(listing.commercial[key]!==value)conflicts.push({field:key,html:listing.commercial[key],wordpress:value});
 }
 if(!listing.commercial.description&&typeof rest?.description==='string')listing.commercial.description=rest.description;
 if(Array.isArray(rest?.images))for(const raw of rest.images){const image=objectData(raw);let url:URL;try{url=new URL(String(image.url));}catch{continue;}if(url.origin!=='https://www.admaioraimmobiliare.it'||!url.pathname.startsWith('/wp-content/uploads/')||! /\.(png|jpe?g|webp)$/i.test(url.pathname))continue;const existing=listing.assets.find(asset=>asset.canonicalUrl===url.href);if(existing)existing.metadata={...existing.metadata,wordpressTitle:image.title,wordpressAlt:image.alt};else if(listing.assets.length<60)listing.assets.push({kind:/planimetr|pianta/i.test(url.pathname)?'FLOORPLAN':'IMAGE',url:url.href,canonicalUrl:url.href,sourceRecordedAt:null,dateEvidenceMethod:null,metadata:{wordpressTitle:image.title,wordpressAlt:image.alt}});}
 const restAddress=text(fields.address),htmlLocation=listing.location;
 const restLocation=resolveMonitoredGeography({rawText:restAddress});
 if(restAddress&&restLocation.streetName&&(!htmlLocation.streetName||clean(htmlLocation.streetName)===clean(restLocation.streetName))){
  if(htmlLocation.streetNumber&&restLocation.streetNumber&&clean(htmlLocation.streetNumber)!==clean(restLocation.streetNumber))conflicts.push({field:'streetNumber',html:htmlLocation.streetNumber,wordpress:restLocation.streetNumber});
  else listing.location=resolveMonitoredGeography({rawText:[htmlLocation.streetNumber?htmlLocation.rawText:restAddress,listing.commercial.title].join(' | '),streetName:htmlLocation.streetName??restLocation.streetName,streetNumber:htmlLocation.streetNumber??restLocation.streetNumber});
 }else if(restLocation.streetName&&htmlLocation.streetName&&clean(restLocation.streetName)!==clean(htmlLocation.streetName))conflicts.push({field:'address',html:htmlLocation.rawText,wordpress:restAddress});
 // Publisher pins are known to be approximate/false; retain no coordinates as location evidence.
 listing.location.latitude=null;listing.location.longitude=null;
 listing.location.reasons.push('publisher_pin_ignored_use_address_geocoding');
 const published=rest?.dateGmt;const iso=typeof published==='string'&&Number.isFinite(Date.parse(published+'Z'))?new Date(published+'Z').toISOString():null;
 if(iso&&Date.parse(iso)<=Date.parse(listing.observedAt)){
  if(listing.source.portalPublishedAt&&listing.source.portalPublishedAt!==iso)conflicts.push({field:'publishedAt',html:listing.source.portalPublishedAt,wordpress:iso});
  else {listing.source.portalPublishedAt=iso;listing.marketStart={lowerBound:iso,upperBound:iso,confidence:.95,method:'WORDPRESS_REST_DATE_GMT_CROSSCHECK',evidence:[{kind:'MARKET_START',claimKey:'publication.datePublished',sourceUrl:`https://www.admaioraimmobiliare.it/wp-json/wp/v2/immobile/${listing.source.externalId}`,extractionMethod:'WORDPRESS_REST_DATE_GMT_CROSSCHECK',rawValue:String(published),normalizedValue:{lowerBound:iso,upperBound:iso},confidence:.95,observedAt:listing.observedAt,sourceRecordedAt:iso,metadata:{semantics:'SITE_PUBLICATION_NOT_MANDATE_START'}}]};}
 }
 const modified=rest?.modifiedGmt;if(typeof modified==='string'&&Number.isFinite(Date.parse(modified+'Z'))&&Date.parse(modified+'Z')<=Date.parse(listing.observedAt)){const date=new Date(modified+'Z').toISOString();if(listing.source.portalModifiedAt&&listing.source.portalModifiedAt!==date)conflicts.push({field:'modifiedAt',html:listing.source.portalModifiedAt,wordpress:date});else listing.source.portalModifiedAt=date;}
 const match=matchAdMaioraPortal(listing,cards);
 if(match){const extra=resolveMonitoredGeography({rawText:match.address});if(!listing.location.streetNumber&&extra.streetNumber){listing.location=extra;listing.location.reasons.push('civic_from_uniquely_matched_agency_portal_publication');}else if(extra.streetNumber&&listing.location.streetNumber!==extra.streetNumber)conflicts.push({field:'streetNumber',html:listing.location.streetNumber,wordpress:extra.streetNumber});if(!listing.commercial.floor&&match.floor)listing.commercial.floor=match.floor;}
 const classes=Array.isArray(rest?.classes)?rest.classes.filter((v):v is string=>typeof v==='string'):[];
 const type=classes.find(v=>v.startsWith('property-type-'));if(!listing.commercial.propertyType&&type)listing.commercial.propertyType=type.replace('property-type-','').replaceAll('-',' ');
 const zone=classes.find(v=>v.startsWith('property-city-zona-'));if(zone)listing.location.zoneName=zone.replace('property-city-','').replaceAll('-',' ');
 const structured=objectData(listing.commercial.features.structuredFacts);
 const schemaBaths=number(structured.bathrooms);if(schemaBaths!=null&&listing.commercial.bathrooms!=null&&schemaBaths!==listing.commercial.bathrooms)conflicts.push({field:'bathroomsJsonLd',html:listing.commercial.bathrooms,wordpress:schemaBaths});
 const labels=Array.isArray(listing.commercial.features.labels)?listing.commercial.features.labels:[];
 const energy=labels.map(String).join(' ').match(/Classe Energetica\s+([A-G])/i)?.[1];
 if(energy&&fields.energy_class&&energy!==fields.energy_class)conflicts.push({field:'energyClass',html:energy,wordpress:fields.energy_class});
 listing.commercial.features.adMaioraCrossCheck={wordpress:rest,featuredMedia:media,portalMatch:match,checks,conflicts,publisherPinIgnored:true,photoNamesAreNotOwnerIdentity:true};
 listing.provenance.adMaioraDoubleCheck={restUrl:rest?`${new URL(listing.source.canonicalUrl).origin}/wp-json/wp/v2/immobile/${listing.source.externalId}`:null,portalUrl:match?.url??null,...checks};
 if(conflicts.length)listing.extractionWarnings.push('admaiora_conflicting_source_fields');
 if(checks.wordpress&&checks.wordpress!=='verified_identity')listing.extractionWarnings.push('admaiora_wordpress_check_unavailable');
 if(typeof checks.portal==='string'&&checks.portal.startsWith('unavailable'))listing.extractionWarnings.push('admaiora_portal_check_unavailable');
}
