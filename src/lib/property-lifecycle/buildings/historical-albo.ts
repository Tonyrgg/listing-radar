import {load} from 'cheerio';
import {hashValue} from '@/lib/property-lifecycle/contracts/normalized-listing';
import {AlboHttp,parseAlboInventory,safeAlboUrl,type AlboItem} from './albo';
import {extractTerritorialReferences,extractDeclaredCadastralReferences,type RegistryStreet} from './territorial-extraction';
import {classifyPublicRecord} from './public-record-policy';

export const HISTORY_POLICY=Object.freeze({version:'territorial_relevance_v1',url:'https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti',minYear:2021,maxYear:2026,maxYearRecords:6500,maxCandidateRatio:0.35,maxPages:330,pageSize:50,leaseSeconds:600,batchSize:25});
const ns='_jcitygovalbopubblicazioni_WAR_jcitygovalbiportlet_';
export interface HistoricalCandidate {id:string;url:string;registration:string;act:string;category:string;start:string|null;end:string|null;marker:string}
export interface HistoricalPlan {year:number;total:number;pages:number;fingerprint:string|null;candidates:HistoricalCandidate[];manifest:string;inventoryObservedAt?:string}
export function validateHistoricalPlan(plan:HistoricalPlan,year:number){
 if(plan.year!==year||plan.total<1||plan.total>HISTORY_POLICY.maxYearRecords||plan.pages<1||plan.pages>HISTORY_POLICY.maxPages||!plan.candidates.length||plan.candidates.length/plan.total>HISTORY_POLICY.maxCandidateRatio||hashValue(plan.candidates)!==plan.manifest)throw Error('Invalid historical checkpoint plan');
 const seen=new Set<string>();for(const c of plan.candidates){if(!/^\d+$/.test(c.id)||seen.has(c.id)||!safeAlboUrl(c.url).endsWith('/papca/display/'+c.id)||(!c.registration.startsWith(`${year}/`)&&!c.act.startsWith(`${year}/`)))throw Error('Invalid historical checkpoint identity');seen.add(c.id);}
 return plan;
}
export function resumeHistoricalCheckpoint(previous:{manifest?:string;done?:string[]},manifest:string,acceptedManifest?:string){
 if(previous.manifest&&previous.manifest!==manifest){
  if(acceptedManifest!==manifest)throw Error('Historical manifest changed; manual review required before resume');
  return {manifest,done:[] as string[]}; // Re-evaluate identities; never deletes source records or evidence.
 }
 return {manifest,done:previous.done??[]};
}
export function territorialRelevance(subject:string,category:string,streets:RegistryStreet[]){
 const refs=extractTerritorialReferences(subject,streets),cadastre=extractDeclaredCadastralReferences(subject),type=classifyPublicRecord(subject,category).type;
 // Exclude routine personnel/finance/publication notices even if an office address is present.
 if(/\b(?:liquidazione|retribuzion|stipendi|ferie|concors|graduatori|matrimoni|cambio nome|elettoral|rimborso|retta|pensione)\b/i.test(subject)&&!/(?:demoliz|incolumit|divieto di|espropri|urbanistic)/i.test(subject))return {relevant:false,reason:'non_territorial_administration'};
 const strong=['DEMOLITION_ORDER','SAFETY_ORDER','URBAN_PLAN','URBAN_VARIANT','EXPROPRIATION','HERITAGE','BUILDING_PERMIT','CILA','SCIA','AGIBILITY_SIGNAL','SANATORIA','CONDONO'].includes(type);
 const territorial=refs.length>0||cadastre.length>0||(/\b(?:MARIOTTO|PALOMBAIO)\b/i.test(subject)&&['PUBLIC_WORK','ROAD_WORK','VIABILITY','SUAP'].includes(type));
 return {relevant:strong||territorial,reason:strong?'territorial_category':territorial?'explicit_territory':'no_concrete_territory'};
}
export function validateHistoryPage(p:ReturnType<typeof parseAlboInventory>,expected:number,total:number|null,fingerprint:string|null,year:number,seen:Set<string>){
 if(p.page!==expected||p.total>HISTORY_POLICY.maxYearRecords||(total!=null&&p.total!==total)||(fingerprint&&p.fingerprint!==fingerprint))throw Error('Historical inventory drift or implausible count');
 for(const i of p.items){if(!i.registration.startsWith(`${year}/`)&&!i.act.startsWith(`${year}/`))throw Error('Historical year filter failed');if(seen.has(i.id))throw Error('Duplicate historical ID');seen.add(i.id);}
}
/** Only public form actions discovered in the response; never guess private endpoints. */
export async function historicalInventory(http:Pick<AlboHttp,'get'|'post'>,year:number,streets:RegistryStreet[],progress?:(p:{page:number;pages:number;total:number;scanned:number;candidates:number})=>Promise<void>){
 if(!Number.isInteger(year)||year<HISTORY_POLICY.minYear||year>HISTORY_POLICY.maxYear)throw Error('Unsupported historical year');
 let html=await http.get(HISTORY_POLICY.url),$=load(html);const form=$(`form#${ns}filterForm`),body=new URLSearchParams();
 if(!form.length||!form.find(`[name="${ns}annoRegistrazioneDa"]`).length)throw Error('Historical filter structure changed');
 form.find('input').each((_,i)=>{const name=$(i).attr('name');if(name)body.set(name,$(i).attr('value')??'');});
 body.set(ns+'annoRegistrazioneDa',String(year));body.set('submitButton','doFilter');
 html=await http.post(safeAlboUrl(form.attr('action')!),body);$=load(html);
 const pager=$('form#form_page_size');if(!pager.length)throw Error('Historical pagination form changed');
 html=await http.post(safeAlboUrl(pager.attr('action')!),new URLSearchParams({hidden_page_size:String(HISTORY_POLICY.pageSize),hidden_page_to:'1'}));
 let expected=1,total:number|null=null,fingerprint:string|null=null;const seen=new Set<string>(),candidates:HistoricalCandidate[]=[];
 for(;;){const p=parseAlboInventory(html,HISTORY_POLICY.maxPages);validateHistoryPage(p,expected,total,fingerprint,year,seen);total=p.total;fingerprint=p.fingerprint;
  for(const i of p.items)if(territorialRelevance(i.subject,i.category,streets).relevant){const {subject: _subject,...safe}=i;void _subject;candidates.push(safe);}
  await progress?.({page:p.page,pages:p.pages,total:p.total,scanned:seen.size,candidates:candidates.length});
  if(p.page===p.pages)break;expected++;html=await http.get(p.next!);
 }
 if(seen.size!==total)throw Error('Historical inventory incomplete');
 if(!candidates.length||candidates.length/seen.size>HISTORY_POLICY.maxCandidateRatio)throw Error('Historical candidate count anomaly');
 candidates.sort((a,b)=>a.id.localeCompare(b.id));
 return {year,total:seen.size,pages:expected,fingerprint,candidates,manifest:hashValue(candidates),inventoryObservedAt:new Date().toISOString()};
}
export function historyItem(candidate:HistoricalCandidate,subject:string):AlboItem{return {...candidate,subject};}
