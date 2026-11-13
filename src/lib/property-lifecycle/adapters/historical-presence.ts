import {HttpClient} from '@/lib/http/client';
import {hashValue,rehashNormalizedListing,type NormalizedListingV2} from '../contracts/normalized-listing';
import type {PropertyLifecycleAdapter,SourceDocument} from './types';

const http=new HttpClient({timeoutMs:10000,retries:0,minIntervalMs:1500});
let unavailable=false;
const clean=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const imageKey=(value:string)=>{try{const u=new URL(value);return u.hostname+u.pathname+u.search;}catch{return value;}};

/** URLs can be reused: require an exact reference plus physical agreement, or two identical photographs. */
export function sameHistoricalListing(current:NormalizedListingV2,archived:NormalizedListingV2):boolean{
 if(current.source.agencySlug!==archived.source.agencySlug)return false;
 const a=current.commercial.surfaceSqm,b=archived.commercial.surfaceSqm;
 if(a!=null&&b!=null&&Math.abs(a-b)>Math.max(2,a*.03))return false;
 const streetA=current.location.streetName,streetB=archived.location.streetName;
 if(streetA&&streetB&&clean(streetA)!==clean(streetB))return false;
 if(current.location.streetNumber&&archived.location.streetNumber&&clean(current.location.streetNumber)!==clean(archived.location.streetNumber))return false;
 const ref=current.source.agencyReference,oldRef=archived.source.agencyReference;
 if(ref&&oldRef&&clean(ref)!==clean(oldRef))return false;
 const images=new Set(current.assets.filter(x=>x.kind==='IMAGE').map(x=>imageKey(x.canonicalUrl)));
 const shared=new Set(archived.assets.filter(x=>x.kind==='IMAGE'&&images.has(imageKey(x.canonicalUrl))).map(x=>imageKey(x.canonicalUrl))).size;
 return shared>=2||Boolean(ref&&oldRef&&clean(ref)===clean(oldRef)&&a!=null&&b!=null&&streetA&&streetB);
}

export function historicalCandidates(items:Array<{sourceKey:string}>,day:string,limit=5):Set<string>{
 return new Set([...items].sort((a,b)=>hashValue(day+a.sourceKey).localeCompare(hashValue(day+b.sourceKey))).slice(0,limit).map(x=>x.sourceKey));
}

/** Failure of an external archive never changes live source health or listing status. */
export async function enrichHistoricalPresence(adapter:PropertyLifecycleAdapter,document:SourceDocument,current:NormalizedListingV2):Promise<NormalizedListingV2>{
 if(unavailable)return current;
 const original=current.source.canonicalUrl;
 const query=new URL('https://web.archive.org/cdx/search/cdx');
 query.search=new URLSearchParams({url:original,matchType:'exact',output:'json',filter:'statuscode:200',fl:'timestamp,original',limit:'1'}).toString();
 try{
  const index=await http.get(query.href);
  if([429,503].includes(index.status)){unavailable=true;return current;}
  if(!index.ok)return current;
  const rows:unknown=JSON.parse(index.body);
  if(!Array.isArray(rows)||!Array.isArray(rows[1]))return current;
  const [stamp,url]=rows[1] as unknown[];
  if(typeof stamp!=='string'||!/^\d{14}$/.test(stamp)||typeof url!=='string')return current;
  const requested=new URL(original),found=new URL(url);
  const path=(value:URL)=>value.pathname.replace(/\/$/,'');
  if(requested.hostname!==found.hostname||path(requested)!==path(found)||requested.search!==found.search)return current;
  const date=`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}Z`;
  if(!Number.isFinite(Date.parse(date))||Date.parse(date)>=Date.parse(current.observedAt))return current;
  const snapshotUrl=`https://web.archive.org/web/${stamp}id_/${url}`;
  const snapshot=await http.get(snapshotUrl);
  if([429,503].includes(snapshot.status)){unavailable=true;return current;}
  if(!snapshot.ok||!snapshot.headers.get('content-type')?.includes('html'))return current;
  const archived=await adapter.normalize({...document,response:{...snapshot,url:original},observedAt:date});
  if(!sameHistoricalListing(current,archived)){console.info(JSON.stringify({action:'historical-presence',agency:adapter.agencySlug,sourceKey:current.source.sourceKey,status:'IDENTITY_UNCONFIRMED'}));return current;}
  const claim={kind:'PUBLICATION',claimKey:'publication.archivedPresence',sourceUrl:snapshotUrl,extractionMethod:'WAYBACK_VERIFIED_PRESENCE',rawValue:stamp,normalizedValue:{lowerBound:date,upperBound:date},confidence:.9,observedAt:current.observedAt,sourceRecordedAt:date,metadata:{originalUrl:original,archiveDigest:hashValue(snapshot.body),semantics:'PRESENT_BY_NOT_MANDATE_START'}};
  console.info(JSON.stringify({action:'historical-presence',agency:adapter.agencySlug,sourceKey:current.source.sourceKey,status:'VERIFIED',presentBy:date}));
  return rehashNormalizedListing(current,row=>({...row,marketStart:{...row.marketStart,evidence:[...row.marketStart.evidence,claim]}}));
 }catch{return current;}
}
