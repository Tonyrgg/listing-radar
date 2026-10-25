import {cache} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {combinePropertyFacts,factRank,type PropertyFact} from './property-facts';
export interface FactNews {practice_number?:string|null;event_id:string;record_id:string;event_type:string;event_subtype:string|null;event_date:string|null;observed_at:string;confidence:number;real_estate_relevance:number;sale_proximity:string;evidence_text:string;evidence_location:PropertyFact['evidence_location'];classification_version:string;territorial_level:string;building_id:string|null;street_id:string|null;property_id:null;street:string|null;civic:string|null;area_name:string|null;source:string;record_source_url:string|null;record_first_seen_at:string;known_properties:number;active_properties:number;historical_properties:number;sold_observed:number;agencies:string[];fact:PropertyFact;rank:number;combination?:{type:string;evidenceIds:string[];reasons:string[]};market?:{propertyIds:string[];firstMarketEvidence:string|null;exitClassifications:string[]}}
export const FACT_FILTERS:Record<string,string>={all:'Tutte',high:'Alta rilevanza',FRAZIONAMENTO:'Frazionamenti',CAMBIO_DESTINAZIONE_USO:'Cambi d’uso',completion:'Lavori conclusi / agibilità',construction:'Nuove costruzioni',land:'Terreni / urbanistica',commercial:'Attività commerciali',premarket:'Possibile pre-market',direct:'Atti di vendita / alienazione'};
export const factLabel=(type:string)=>({BUILDABILITY_CHANGED:'Cambio di edificabilità dichiarato',SCA_AGIBILITA:'Agibilità dichiarata',INIZIO_LAVORI:'Comunicazione di inizio lavori',FINE_LAVORI:'Fine lavori dichiarata',SANATORIA:'Attività di regolarizzazione amministrativa',ACCERTAMENTO_CONFORMITA:'Accertamento di conformità',CONDONO:'Procedimento di condono',POSSIBLE_NEW_UNITS_PRE_MARKET:'Possibili nuove unità prima del mercato',ASSET_RECENTLY_COMPLETED:'Trasformazione con successiva dichiarazione di completamento',COMPLETED_ASSET_NO_MARKET_LISTING:'Trasformazione conclusa, senza annunci attivi conosciuti',EX_LISTING_WITH_NEW_TRANSFORMATION:'Vecchio annuncio e successiva trasformazione',BUILDING_TO_WATCH:'Edificio da osservare',COMMERCIAL_ASSET_TRANSFORMATION:'Trasformazione di immobile commerciale',REGULARIZATION_COMPLETION_MARKET_ENTRY:'Regolarizzazione, completamento e ingresso sul mercato'}[type]??type.toLowerCase().replaceAll('_',' '));
async function all<T>(db:SupabaseClient,table:string,fields:string,key:string){const out:T[]=[];for(let n=0;;n+=1000){const r=await db.from(table).select(fields).order(key).range(n,n+999);if(r.error)throw Error(r.error.message);out.push(...r.data as T[]);if(r.data.length<1000)return out;if(out.length>=20000)throw Error('Semantic read limit reached; refine server read model');}}
export const readFactNews=cache(async(db:SupabaseClient,now:number)=>{
 type Market={property_id:string;context_building_ids:string[];first_seen_at:string;earliest_market_evidence_at:string|null;last_seen_at:string;delisted_at?:string|null;exit_classification:string;state:string};
 const [events,properties]=await Promise.all([
  all<Omit<FactNews,'rank'>>(db,'market_observer_property_facts','*','event_id'),
  all<Market>(db,'market_observer_graph_property_archive','property_id,context_building_ids,first_seen_at,earliest_market_evidence_at,last_seen_at,delisted_at,exit_classification,state','row_id')
 ]);
 const rows:FactNews[]=events.map(e=>({...e,rank:factRank(e.fact,e.territorial_level,now,e.record_first_seen_at)}));
 const market=new Map<string,Market[]>();for(const p of properties)for(const bid of p.context_building_ids??[]){const list=market.get(bid)??[];if(!list.some(v=>v.property_id===p.property_id))list.push(p);market.set(bid,list);}
 const grouped=new Map<string,FactNews[]>();for(const row of rows){if(!row.building_id)continue;const list=grouped.get(row.building_id)??[];list.push(row);grouped.set(row.building_id,list);
  const ps=market.get(row.building_id)??[];row.market={propertyIds:ps.map(p=>p.property_id),firstMarketEvidence:ps.flatMap(p=>p.earliest_market_evidence_at?[p.earliest_market_evidence_at]:[]).sort()[0]??null,exitClassifications:[...new Set(ps.map(p=>p.exit_classification))]};
 }
 const combinations:FactNews[]=[];
 for(const [bid,es] of grouped){const first=es[0],ps=market.get(bid)??[];
  // last_seen is NOT exit_confirmed_at; do not infer an exit sequence from it.
  const patterns=combinePropertyFacts(es.map(e=>e.fact),{buildingId:bid,knownProperties:ps.length,activeProperties:first.active_properties,soldEvidence:first.sold_observed>0,oldListingAt:ps.map(p=>p.first_seen_at).sort()[0],exitAt:ps.filter(p=>p.delisted_at&&!['SOLD_CONFIRMED','SOLD_PROBABLE'].includes(p.exit_classification)).map(p=>p.delisted_at!).sort().at(-1),marketEntryAt:ps.map(p=>p.first_seen_at).sort().at(-1)});
  for(const c of patterns){const evidence=es.filter(e=>c.evidenceIds.includes(e.event_id)),latest=evidence.filter(e=>e.event_date).sort((a,b)=>a.event_date!.localeCompare(b.event_date!)).at(-1)!;
   combinations.push({...latest,event_id:`combination:${bid}:${c.type}:${c.evidenceIds.join(':')}`,event_type:c.type,real_estate_relevance:c.relevance,confidence:Math.min(...evidence.map(e=>Number(e.confidence))),combination:{type:c.type,evidenceIds:c.evidenceIds,reasons:c.reasons},rank:factRank({...latest.fact,real_estate_relevance:c.relevance},latest.territorial_level,now,latest.record_first_seen_at)});
  }
 }
 return [...rows,...combinations].sort((a,b)=>b.rank-a.rank||b.real_estate_relevance-a.real_estate_relevance||(b.event_date??'').localeCompare(a.event_date??'')||a.event_id.localeCompare(b.event_id));
});
export function filterFactNews(rows:FactNews[],options:{period?:string;type?:string;building?:string;query?:string},now:number){
 const days=options.period==='all'?null:options.period==='30'?30:90;
 return rows.filter(r=>{
  if(days&&(!r.event_date||Date.parse(r.event_date)>now||now-Date.parse(r.event_date)>days*86400000))return false;
  if(options.building&&r.building_id!==options.building)return false;
  if(options.query&&!`${r.street??''} ${r.civic??''} ${r.area_name??''}`.toLowerCase().includes(options.query.toLowerCase()))return false;
  const t=options.type??'all';if(t==='all')return true;if(t==='high')return r.real_estate_relevance>=70;if(t==='direct')return r.sale_proximity==='DIRECT';
  if(t==='premarket')return ['POSSIBLE_NEW_UNITS_PRE_MARKET','COMPLETED_ASSET_NO_MARKET_LISTING','EX_LISTING_WITH_NEW_TRANSFORMATION'].includes(r.event_type);
  if(t==='completion')return ['FINE_LAVORI','SCA_AGIBILITA'].includes(r.event_type);if(t==='construction')return ['NUOVA_COSTRUZIONE','DEMOLIZIONE_RICOSTRUZIONE','AMPLIAMENTO','SOPRAELEVAZIONE'].includes(r.event_type);
  if(t==='land')return /URBANISTIC|EDIFICATORIO|LOTTIZZAZIONE|PIANO_ATTUATIVO|ESPROPR|BUILDABILITY/.test(r.event_type);
  if(t==='commercial')return /ATTIVITA|SUAP|COMMERCIAL/.test(r.event_type);return r.event_type===t;
 });
}
