import { hashValue } from '../contracts/normalized-listing';

/** Relevance is information value, NEVER sale probability. Changes require a new version. */
export const FACT_POLICY = Object.freeze({version:'property_facts_v1', confidence:{explicit:.95,practice:.9},
  maxSpan:180, maxEvents:40, deepLimit:80, pdfLimit:8, recentDays:90,
  ranking:{relevance:.65,recency:.15,precision:.1,confidence:.08,novelty:.02},
});
type Rule = {type:string;pattern:RegExp;relevance:number;proximity:'DIRECT'|'NEAR'|'POSSIBLE'|'CONTEXT'};
const r=(type:string,pattern:RegExp,relevance:number,proximity:Rule['proximity']='POSSIBLE'):Rule=>({type,pattern,relevance,proximity});
export const FACT_RULES:Rule[]=[
 r('DEMOLIZIONE_RICOSTRUZIONE',/demolizione\s+(?:e\s+|con\s+(?:successiva\s+)?)ricostruzione/i,85,'NEAR'),
 r('FRAZIONAMENTO',/frazionamento(?:\s+(?:dell['’]|di\s+)(?:unità|unita|immobile))?|divisione\s+in\s+(?:più|due|tre|\d+)\s+unit[àa]|realizzazione\s+di\s+(?:due|tre|\d+)\s+unit[àa]|suddivisione\s+(?:in\s+(?:più|due|tre|\d+)\s+unit[àa]|dell['’]unit[àa])|separazione\s+funzionale\s+(?:di\s+)?unit[àa]|creazione\s+di\s+unit[àa]\s+autonome/i,90,'NEAR'),
 r('FUSIONE',/(?:fusione|accorpamento|unificazione)(?:\s+(?:di\s+|delle?\s+|tra\s+)?(?:due\s+|tre\s+|\d+\s+|più\s+)?(?:unit[àa]|immobili|appartamenti))?|collegamento\s+funzionale\s+di\s+unit[àa]/i,80,'NEAR'),
 r('CAMBIO_DESTINAZIONE_USO',/(?:cambio|cambiamento|mutamento|modifica)\s+(?:di\s+|della\s+)?destinazione\s+d['’]?uso(?:\s+da\s+(?:commerciale|residenziale|ufficio|deposito|magazzino|abitazione)\s+(?:a|ad)\s+(?:commerciale|residenziale|ufficio|deposito|magazzino|abitazione))?/i,90,'NEAR'),
 r('NUOVA_COSTRUZIONE',/nuova\s+costruzione|costruzione\s+di\s+(?:un\s+)?nuovo\s+fabbricato/i,85,'NEAR'),
 r('DEMOLIZIONE',/demolizione\s+(?:di\s+|del\s+|dell['’])(?:un\s+)?(?:fabbricato|edificio|immobile|opere\s+abusive)/i,65),
 r('RISTRUTTURAZIONE_IMPORTANTE',/ristrutturazione\s+(?:integrale|totale|pesante|importante)|ristrutturazione\s+edilizia\s+(?:integrale|totale|pesante)/i,70,'NEAR'),
 r('RISTRUTTURAZIONE',/ristrutturazione(?:\s+edilizia)?/i,60),
 r('AMPLIAMENTO',/ampliamento\s+(?:di\s+|del\s+|dell['’])?(?:un\s+)?(?:fabbricato|edificio|immobile|abitazione|volume|unit[àa])/i,75,'NEAR'),
 r('SOPRAELEVAZIONE',/sopraelevazione/i,80,'NEAR'),
 r('INIZIO_LAVORI',/(?:comunicazione\s+(?:di\s+)?)inizio\s+(?:dei\s+)?lavori|lavori\s+iniziati/i,65),
 r('FINE_LAVORI',/(?:fine|ultimazione|conclusione)\s+(?:dei\s+)?lavori|lavori\s+ultimati/i,80,'NEAR'),
 r('SCA_AGIBILITA',/segnalazione\s+certificata\s+(?:di\s+|per\s+l['’])agibilit[àa]|\bSCA\b|certificato\s+di\s+agibilit[àa]/i,80,'NEAR'),
 r('ACCERTAMENTO_CONFORMITA',/accertamento\s+(?:di\s+)?conformit[àa]/i,65),
 r('SANATORIA',/sanatoria/i,65), r('CONDONO',/condono\s+edilizio/i,65),
 r('MANUTENZIONE_STRAORDINARIA',/manutenzione\s+straordinaria/i,30),
 r('MANUTENZIONE_ORDINARIA',/manutenzione\s+ordinaria|manutenzione\s+(?:del\s+)?bagno/i,10,'CONTEXT'),
 r('RESTAURO_RISANAMENTO',/restauro\s+(?:e\s+)?risanamento(?:\s+conservativo)?|risanamento\s+conservativo/i,55),
 r('CESSAZIONE_ATTIVITA',/cessazione\s+(?:dell['’]|di\s+|di\s+un['’]?)?(?:attivit[àa]|esercizio)\s*(?:commerciale|produttiv[ao]|di\s+somministrazione)?/i,80,'NEAR'),
 r('NUOVA_ATTIVITA',/apertura\s+(?:di\s+)?(?:nuov[ao]\s+)?(?:attivit[àa]|esercizio|negozio)/i,60),
 r('TRASFERIMENTO_ATTIVITA',/trasferimento\s+(?:di\s+|dell['’])?(?:attivit[àa]|esercizio|sede\s+commerciale)/i,70),
 r('VARIAZIONE_SUAP',/variazione\s+(?:di\s+)?attivit[àa]|variazione\s+SUAP/i,50),
 r('VARIANTE_URBANISTICA',/variante\s+(?:urbanistica|al\s+(?:PRG|PUG|piano\s+regolatore))/i,75),
 r('CAMBIO_DESTINAZIONE_URBANISTICA',/(?:cambio|modifica)\s+(?:della\s+)?destinazione\s+urbanistica/i,80),
 r('POTENZIALE_EDIFICATORIO_MODIFICATO',/(?:modifica|incremento|riduzione)\s+(?:dell['’]|di\s+)?(?:indice\s+edificatorio|capacit[àa]\s+edificatoria|edificabilit[àa])/i,80),
 r('NUOVA_LOTTIZZAZIONE',/(?:nuova\s+)?lottizzazione/i,80),r('PIANO_ATTUATIVO',/piano\s+(?:urbanistico\s+)?attuativo/i,70),
 r('VINCOLO_ESPROPRIATIVO',/vincolo\s+(?:preordinato\s+all['’])?espropriativo|vincolo\s+preordinato\s+all['’]esproprio/i,70),
 r('ESPROPRIO',/espropriazione|esproprio/i,65),
 r('ALIENAZIONE',/(?:alienazione|vendita|asta|cessione)\s+(?:pubblica\s+|di\s+|del\s+|dei\s+|dell['’]){0,3}(?:immobili|immobile|fabbricati|fabbricato|terreni|terreno|patrimonio|beni\s+immobili)(?:\s+(?:comunali|pubblici|comunale|pubblico|privato|privati))?|piano\s+(?:delle\s+)?alienazioni/i,100,'DIRECT'),
 r('DISMISSIONE',/dismissione\s+(?:di\s+|del\s+|dei\s+)?(?:immobili|patrimonio|beni\s+immobili)/i,90,'DIRECT'),
 r('VALORIZZAZIONE_PATRIMONIALE',/valorizzazione\s+(?:del\s+)?patrimonio\s+immobiliare/i,80),
 r('ORDINANZA_SICUREZZA',/ordinanza\s+(?:di\s+)?(?:sicurezza|incolumit[àa])/i,50),
 r('INAGIBILITA',/dichiarazione\s+(?:di\s+)?inagibilit[àa]|immobile\s+inagibile/i,60),
 r('MESSA_IN_SICUREZZA',/messa\s+in\s+sicurezza\s+(?:di\s+|del\s+|dell['’])?(?:fabbricato|edificio|immobile)/i,55),
 r('LAVORO_STRADALE',/lavori\s+stradali|manomissione\s+(?:del\s+|di\s+)?(?:suolo|sede\s+stradale)|rifacimento\s+(?:del\s+)?manto\s+stradale/i,15,'CONTEXT'),
 r('NUOVO_PARCHEGGIO',/(?:nuovo\s+parcheggio|realizzazione\s+(?:di\s+)?(?:un\s+)?parcheggio)/i,35,'CONTEXT'),
 r('RIQUALIFICAZIONE',/riqualificazione\s+(?:urbana|di\s+area|di\s+piazza|del\s+quartiere)/i,30,'CONTEXT'),
 r('NUOVA_INFRASTRUTTURA',/realizzazione\s+(?:di\s+)?(?:nuova\s+)?infrastruttura/i,30,'CONTEXT'),
 r('MODIFICA_VIABILITA',/modifica\s+(?:della\s+)?viabilit[àa]|istituzione\s+(?:di\s+)?senso\s+unico|divieto\s+di\s+circolazione/i,15,'CONTEXT'),
 r('OTHER_PROPERTY_TRANSFORMATION',/trasformazione\s+(?:edilizia|immobiliare)/i,45),
];
export interface FactEvidence {text:string;field:string;sourceUrl:string;sourceHash:string;observedAt:string;page?:number;row?:number;territorialScopeVerified?:boolean}
export interface PropertyFact {id:string;event_type:string;event_subtype:string|null;event_date:string|null;document_date?:string|null;completion_reported_by?:string|null;date_evidence?:string|null;date_semantics:'DOCUMENT_DATE'|'UNKNOWN';observed_at:string;confidence:number;evidence_text:string;evidence_location:{field:string;page:number|null;row:number|null;start:number;end:number;source_hash:string;source_url:string};classification_version:string;real_estate_relevance:number;sale_proximity:Rule['proximity'];works_lifecycle:string|null;units_before:number|null;units_after:number|null;from_use:string|null;to_use:string|null;ownership_scope:'PUBLIC'|'PRIVATE'|'UNKNOWN';derived_signals:string[]}
const invalidContext=/(?:non\s+(?:preved(?:e|ono)|comport(?:a|ano)|costituisce|riguard(?:a|ano))\s+(?:la\s+|il\s+|alcun[ao]?\s+)?|senza(?:\s+il\s+preventivo)?|esclus[oa]|non\s+è\s+previst[oa])\s*$/i;
export function extractPropertyFacts(recordId:string,evidence:FactEvidence,eventDate:string|null):PropertyFact[]{
 const text=evidence.text.normalize('NFC'), facts:PropertyFact[]=[];
 if(/partecipazione\s+(?:al\s+)?master|corso\s+di\s+formazione|formazione\s+in\s+materia/i.test(text))return [];
 if(evidence.field==='albo.subject'&&evidence.territorialScopeVerified===false&&!/\b(?:Bitonto|Palombaio|Mariotto)\b/i.test(text))return [];
 for(const rule of FACT_RULES){
  const pattern=new RegExp(rule.pattern.source,'gi');let match:RegExpExecArray|null;
  while((match=pattern.exec(text))){
   const transition=text.slice(match.index,match.index+FACT_POLICY.maxSpan).match(/^(?:frazionamento|fusione|accorpamento)\s+da\s+(una|uno|due|tre|\d+)\s+(?:unit[àa]\s+)?(?:a|in)\s+(una|uno|due|tre|\d+)\s+unit[àa]/i);
   if(transition)match[0]=transition[0];
   const partial=['FRAZIONAMENTO','FUSIONE'].includes(rule.type)?text.slice(match.index+match[0].length).match(/^\s+(?:e\s+(?:frazionamento|fusione)\s+)?(?:del(?:la)?\s+|di\s+|dell['’])(?:terrazzo|lastrico|cortile|area\s+comune)/i):null;
   if(partial)match[0]+=partial[0];
   const before=text.slice(Math.max(0,match.index-110),match.index),sentence=text.slice(Math.max(0,text.lastIndexOf('.',match.index)+1),match.index);
   if(invalidContext.test(before)||/\b(?:regolamento|linee\s+guida|diritti\s+di\s+segreteria|tariffe|modulistica|elenco\s+documenti|requisiti|normativa)\b/i.test(sentence))continue;
   // A PDF can quote entire laws and hypothetical alternatives. Only operative
   // assertions/subject clauses are eligible, never a keyword in legal boilerplate.
   if(evidence.field==='pdf.text'){
    const local=text.slice(Math.max(0,match.index-250),match.index+match[0].length+180);
    const prefix=text.slice(Math.max(0,match.index-250),match.index);
    if(!/oggetto\s*:|certificato\s+di\s*$|ha\s+trasmesso|si\s+approva|approvazione\s+(?:del|di)|si\s+autorizza|dichiara|decreto\s+di\s*$/i.test(prefix)||/rappresenterebbe|possono|a\s+norma\s+di\s+legge|recita\s+testualmente/i.test(local))continue;
   }
   if(rule.type==='INIZIO_LAVORI'&&(/segnalazione\s+certificata\s+(?:di\s+)?$/i.test(before)||/\bCILA\b|\bSCIA\b|inizio\s+lavori\s+asseverat/i.test(text)))continue;
   if(rule.type==='SCA_AGIBILITA'&&/inagibilit/i.test(match[0]))continue;
   const tail=text.slice(match.index+match[0].length,match.index+match[0].length+90);
   if(rule.type==='DEMOLIZIONE_RICOSTRUZIONE'&&tail.trim()&&!/^\s+(?:in\s+sagoma\s+)?(?:di\s+|del\s+|dell['’])?(?:un\s+)?(?:edific\w*|fabbricat\w*|immobil\w*|local[ei]|abitazion\w*)\b/i.test(tail))continue;
   if(rule.type==='FUSIONE'&&!/unit[àa]|immobili|appartamenti/i.test(match[0])&&(!/elenco-pratiche/.test(evidence.sourceUrl)||/societ[àa]|aziende|enti\b/i.test(tail)))continue;
   if(rule.type==='CAMBIO_DESTINAZIONE_URBANISTICA'&&/^\s+da\s+[ACDFE]\s*\/?\s*\d/i.test(tail))continue;
   if(rule.type==='CONDONO'&&/a\s+seguito\s+di\s*$|precedente\s*$|pregresso\s*$/i.test(before))continue;
   if(rule.type==='CONDONO'&&/precedente\s+condono|irrilevanza\s+(?:del\s+)?(?:precedente\s+)?condono/i.test(text))continue;
   if(rule.type==='FINE_LAVORI'&&/(?:mancata|dimenticata)\s+presentazione\s+della\s*$/i.test(before))continue;
   if(rule.type==='FINE_LAVORI'&&/\b(?:a|alla)\s*$|termine\s+per\s+la\s*$/i.test(before))continue;
   if(rule.type==='ESPROPRIO'&&/vincolo\s+(?:preordinato\s+all['’])?$/i.test(before))continue;
   if(match[0].length>FACT_POLICY.maxSpan)continue;
   const context=text.slice(Math.max(0,match.index-70),match.index+match[0].length+120);
   const lifecycle=/lavori\s+(?:iniziati|avviati)/i.test(context)?'STARTED':/lavori\s+in\s+corso/i.test(context)?'ONGOING_DECLARED':/lavori\s+ultimati|comunicazione\s+(?:di\s+)?fine\s+lavori|certificato\s+di\s+ultimazione/i.test(context)?'COMPLETED':/rilascio|rilasciato|autorizza(?:to|zione)/i.test(before)?'AUTHORIZED':/istanza|richiesta|domanda|presentazion/i.test(before)?'PLANNED':null;
   const uses=match[0].match(/da\s+(commerciale|residenziale|ufficio|deposito|magazzino|abitazione)\s+(?:a|ad)\s+(commerciale|residenziale|ufficio|deposito|magazzino|abitazione)/i);
   const mapUse=(v:string)=>({commerciale:'COMMERCIAL',residenziale:'RESIDENTIAL',abitazione:'RESIDENTIAL',ufficio:'OFFICE',deposito:'WAREHOUSE',magazzino:'WAREHOUSE'}[v.toLowerCase()]??null);
   // Counts are accepted only from the evidence span itself; no planimetry or unrelated numbers.
   const after=transition?.[2]??match[0].match(/(?:in|di)\s+(due|tre|\d+)\s+unit[àa]/i)?.[1];
   const count=(s:string)=>Number(({una:1,uno:1,due:2,tre:3} as Record<string,number>)[s.toLowerCase()]??s);
   const derived:string[]=[];
   const historicalCompletion=evidence.field==='pdf.text'&&rule.type==='FINE_LAVORI';
   const reported=historicalCompletion?text.slice(Math.max(0,match.index-220),match.index).match(/\bdel\s+(\d{2})\/(\d{2})\/(\d{4})[\s\S]{0,160}ha\s+trasmesso[\s\S]{0,70}certificato\s+di\s*$/i):null;
   const reportedBy=reported?`${reported[3]}-${reported[2]}-${reported[1]}`:null;
   const supporting=evidence.field==='albo.subject'&&/affidamento|liquidazione|impegno\s+di\s+spesa|rimborso/i.test(text);
   const regularization=['FRAZIONAMENTO','FUSIONE','DEMOLIZIONE','DEMOLIZIONE_RICOSTRUZIONE','NUOVA_COSTRUZIONE','AMPLIAMENTO','RISTRUTTURAZIONE','CAMBIO_DESTINAZIONE_USO'].includes(rule.type)&&/sanatoria|accertamento\s+di\s+conformit/i.test(text);
   if(!partial&&!regularization&&rule.type==='FRAZIONAMENTO'&&/unit[àa]|appartament/i.test(match[0]))derived.push('NEW_UNITS_POSSIBLE');
   if(uses&&mapUse(uses[1])!=='RESIDENTIAL'&&mapUse(uses[2])==='RESIDENTIAL')derived.push('PROPERTY_FUNCTION_TRANSFORMED');
   if(rule.type==='CESSAZIONE_ATTIVITA')derived.push('POSSIBLE_COMMERCIAL_SPACE_TRANSITION');
   if(!supporting&&/URBANISTIC|EDIFICATORIO|LOTTIZZAZIONE|PIANO_ATTUATIVO/.test(rule.type))derived.push('URBAN_PLANNING_CHANGE','LAND_TO_WATCH');
   facts.push({id:hashValue({recordId,type:rule.type,field:evidence.field,page:evidence.page??null}),event_type:rule.type,event_subtype:supporting?'SUPPORTING_ADMINISTRATION':partial?'PARTIAL_ASSET':regularization?'REGULARIZATION_REFERENCE':evidence.field==='pdf.text'||evidence.field==='albo.subject'?'SOURCE_ASSERTION':'DECLARED_IN_PRACTICE',
    event_date:historicalCompletion?null:eventDate,document_date:eventDate,completion_reported_by:reportedBy,date_evidence:reported?`${reported[1]}/${reported[2]}/${reported[3]}`:null,date_semantics:!historicalCompletion&&eventDate?'DOCUMENT_DATE':'UNKNOWN',observed_at:evidence.observedAt,confidence:evidence.field==='practice_type'?FACT_POLICY.confidence.practice:FACT_POLICY.confidence.explicit,
    evidence_text:match[0],evidence_location:{field:evidence.field,page:evidence.page??null,row:evidence.row??null,start:match.index,end:match.index+match[0].length,source_hash:evidence.sourceHash,source_url:evidence.sourceUrl},
    classification_version:FACT_POLICY.version,real_estate_relevance:supporting?25:partial?55:regularization?Math.min(65,rule.relevance):rule.relevance,sale_proximity:supporting?'CONTEXT':partial||regularization?'POSSIBLE':rule.proximity,works_lifecycle:lifecycle,
    units_before:transition?count(transition[1]):null,units_after:after?count(after):null,
    from_use:uses?mapUse(uses[1]):null,to_use:uses?mapUse(uses[2]):null,ownership_scope:/\bcomunal[ei]|pubblic[oi]\b/i.test(match[0])?'PUBLIC':/\bprivat[oi]\b/i.test(match[0])?'PRIVATE':'UNKNOWN',derived_signals:derived});break;
  }
 }
 const types=new Set(facts.map(f=>f.event_type));
 return facts.filter(f=>!(types.has('DEMOLIZIONE_RICOSTRUZIONE')&&f.event_type==='DEMOLIZIONE')&&!(types.has('RISTRUTTURAZIONE_IMPORTANTE')&&f.event_type==='RISTRUTTURAZIONE')).slice(0,FACT_POLICY.maxEvents);
}

export interface FactRecord {id:string;content_hash:string;source_key:string;source_url:string|null;record_type:string;practice_type?:string|null;intervention_type?:string;record_date:string|null;source_status?:string;sanitized_payload?:Record<string,unknown>}
/** Generated title/subject and previously inferred intervention_type are NEVER primary evidence. */
export function cheapFacts(record:FactRecord,observedAt:string):PropertyFact[]{
 const type=record.practice_type??record.sanitized_payload?.practiceType;
 if(typeof type!=='string')return [];
 return extractPropertyFacts(record.id,{text:type,field:'practice_type',sourceUrl:record.source_url??'',sourceHash:record.content_hash,observedAt},record.record_date);
}
export function deepCandidate(record:FactRecord){
 if(['SCIA','CILA','BUILDING_PERMIT','AGIBILITY_SIGNAL','SANATORIA','CONDONO','SUAP','URBAN_VARIANT','URBAN_PLAN','EXPROPRIATION','DEMOLITION_ORDER','SAFETY_ORDER'].includes(record.record_type))return {priority:80,reason:'TRANSFORMATION_OR_AMBIGUOUS_ADMINISTRATIVE_TYPE'};
 if(record.intervention_type&&record.intervention_type!=='OTHER')return {priority:70,reason:'PREVIOUS_CLASSIFICATION_REQUIRES_PRIMARY_SPAN'};
 return {priority:record.record_type==='OTHER'?40:20,reason:'PRIMARY_TITLE_NOT_RETAINED'};
}

export interface CombinationContext {buildingId:string;knownProperties:number;activeProperties:number;oldListingAt?:string|null;exitAt?:string|null;marketEntryAt?:string|null;soldEvidence:boolean}
export function combinePropertyFacts(events:PropertyFact[],context:CombinationContext){
 const sorted=events.filter(e=>e.event_date).sort((a,b)=>a.event_date!.localeCompare(b.event_date!));
 const result:Array<{type:string;evidenceIds:string[];reasons:string[];relevance:number;buildingId:string}>=[];
 const add=(type:string,es:PropertyFact[],relevance:number,reasons:string[])=>result.push({type,evidenceIds:es.map(e=>e.id),reasons,relevance,buildingId:context.buildingId});
 const transforms=sorted.filter(e=>!['REGULARIZATION_REFERENCE','PARTIAL_ASSET'].includes(e.event_subtype??'')&&['FRAZIONAMENTO','FUSIONE','RISTRUTTURAZIONE','RISTRUTTURAZIONE_IMPORTANTE','NUOVA_COSTRUZIONE','DEMOLIZIONE_RICOSTRUZIONE','CAMBIO_DESTINAZIONE_USO','AMPLIAMENTO'].includes(e.event_type));
 const completion=sorted.filter(e=>e.event_type==='FINE_LAVORI'&&e.works_lifecycle==='COMPLETED'||e.event_type==='SCA_AGIBILITA');
 for(const end of completion){const prev=transforms.filter(e=>e.event_date!<end.event_date!).at(-1);if(!prev)continue;
  add('ASSET_RECENTLY_COMPLETED',[prev,end],90,['ORDERED_TRANSFORMATION_AND_COMPLETION_CLAIM','BUILDING_CONTEXT_NOT_UNIT_IDENTITY']);
  if(context.knownProperties>0&&context.activeProperties===0&&!context.soldEvidence)add(prev.event_type==='FRAZIONAMENTO'?'POSSIBLE_NEW_UNITS_PRE_MARKET':'COMPLETED_ASSET_NO_MARKET_LISTING',[prev,end],95,['NO_ACTIVE_KNOWN_LISTING','SALE_INTENT_UNKNOWN']);
 }
 if(context.oldListingAt&&context.exitAt&&!context.soldEvidence){const t=transforms.find(e=>e.event_type==='FRAZIONAMENTO'&&e.event_date!>context.exitAt!.slice(0,10)&&context.oldListingAt!<context.exitAt!);if(t)add('EX_LISTING_WITH_NEW_TRANSFORMATION',[t],95,['OLD_LISTING_THEN_EXIT_THEN_TRANSFORMATION','SALE_INTENT_UNKNOWN']);}
 const cessation=sorted.find(e=>e.event_type==='CESSAZIONE_ATTIVITA'),change=sorted.find(e=>e.event_type==='CAMBIO_DESTINAZIONE_USO'&&cessation&&e.event_date!>cessation.event_date!),works=transforms.find(e=>e.event_type!=='CAMBIO_DESTINAZIONE_USO'&&change&&e.event_date!>change.event_date!);
 if(cessation&&change&&works)add('COMMERCIAL_ASSET_TRANSFORMATION',[cessation,change,works],90,['ORDERED_CESSATION_CHANGE_WORKS']);
 const regularization=sorted.find(e=>['SANATORIA','ACCERTAMENTO_CONFORMITA','CONDONO'].includes(e.event_type));
 if(regularization&&context.marketEntryAt){const end=completion.find(e=>e.event_date!>regularization.event_date!&&e.event_date!<context.marketEntryAt!.slice(0,10));if(end)add('REGULARIZATION_COMPLETION_MARKET_ENTRY',[regularization,end],85,['HISTORICAL_SEQUENCE','NO_CAUSALITY_ASSERTED']);}
 if(transforms.length>=2&&context.oldListingAt)add('BUILDING_TO_WATCH',transforms,85,['MULTIPLE_TRANSFORMATIONS','KNOWN_MARKET_HISTORY']);
 // No BUILDABILITY_CHANGED or LAND_TRANSFORMATION_WATCH without compatible before/after planning evidence.
 return result.filter((v,i,a)=>a.findIndex(x=>x.type===v.type&&x.evidenceIds.join()===v.evidenceIds.join())===i);
}

export function factRank(f:PropertyFact,level:string,now:number,firstObservedAt:string){
 const age=f.event_date?Math.max(0,(now-Date.parse(f.event_date))/86400000):Infinity;
 const w=FACT_POLICY.ranking;
 return Math.round((f.real_estate_relevance*w.relevance+(age<=30?100:age<=90?65:0)*w.recency+(level==='PROPERTY'?100:level==='BUILDING'?80:level==='STREET'?40:10)*w.precision+f.confidence*100*w.confidence+(now-Date.parse(firstObservedAt)<7*86400000?100:0)*w.novelty)*100)/100;
}
