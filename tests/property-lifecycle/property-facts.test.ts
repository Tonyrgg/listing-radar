import {describe,it,expect} from 'vitest';
import {extractPropertyFacts,cheapFacts,combinePropertyFacts,factRank} from '@/lib/property-lifecycle/buildings/property-facts';
const evidence={field:'Oggetto',sourceUrl:'https://www.comune.bitonto.ba.it/example',sourceHash:'a'.repeat(64),observedAt:'2026-10-20T12:00:00Z'};
const parse=(text:string,date='2026-10-01')=>extractPropertyFacts('record',{...evidence,text},date);
describe('Public property facts are primary-evidence-bound',()=>{
 it.each([
  ['CILA per frazionamento dell’unità immobiliare','FRAZIONAMENTO'],['divisione in due unità','FRAZIONAMENTO'],['accorpamento di due unità','FUSIONE'],
  ['cambio destinazione d’uso da commerciale a residenziale','CAMBIO_DESTINAZIONE_USO'],['nuova costruzione','NUOVA_COSTRUZIONE'],
  ['demolizione e ricostruzione','DEMOLIZIONE_RICOSTRUZIONE'],['comunicazione fine lavori','FINE_LAVORI'],['segnalazione certificata di agibilità','SCA_AGIBILITA'],
  ['sanatoria','SANATORIA'],['accertamento di conformità','ACCERTAMENTO_CONFORMITA'],['condono edilizio','CONDONO'],
  ['cessazione dell’attività commerciale','CESSAZIONE_ATTIVITA'],['variante urbanistica','VARIANTE_URBANISTICA'],['piano delle alienazioni','ALIENAZIONE'],
  ['vendita di terreno','ALIENAZIONE'],['manutenzione bagno','MANUTENZIONE_ORDINARIA'],['lavori stradali','LAVORO_STRADALE'],
 ])('extracts %s with a verbatim source span',(text,type)=>{const e=parse(text).find(e=>e.event_type===type)!;expect(e).toBeDefined();expect(text.slice(e.evidence_location.start,e.evidence_location.end)).toBe(e.evidence_text);expect(e.classification_version).toBe('property_facts_v1');});
 it.each(['CILA','SCIA','CILA comunicazione inizio lavori asseverata','Segnalazione certificata di inizio lavori','nessun intervento','non prevede frazionamento','senza frazionamento','regolamento per frazionamento','tariffe per nuova costruzione','alienazione di automezzi','fusione di società','inagibilità'])('does not promote %s to an unsupported transformation/start',(text)=>expect(parse(text)).toHaveLength(0));
 it('generated labels, inferred intervention and generic creation time are not evidence',()=>{expect(cheapFacts({id:'x',content_hash:'a',source_key:'test',source_url:'https://test.it',record_type:'FRAZIONAMENTO',intervention_type:'FRAZIONAMENTO',record_date:null},evidence.observedAt)).toEqual([]);});
 it('keeps counts/use only from explicit spans, never cadastral categories',()=>{expect(parse('divisione in due unità')[0].units_after).toBe(2);expect(parse('frazionamento')[0].units_after).toBeNull();expect(parse('frazionamento')[0].derived_signals).not.toContain('NEW_UNITS_POSSIBLE');const change=parse('cambio destinazione d’uso da deposito a residenziale')[0];expect(change).toMatchObject({from_use:'WAREHOUSE',to_use:'RESIDENTIAL'});expect(change.derived_signals).toContain('PROPERTY_FUNCTION_TRANSFORMED');expect(parse('cambio destinazione d’uso categoria C/2 A/3')[0].from_use).toBeNull();});
 it('does not assert buildability, sale or availability from planning/cessation',()=>{expect(parse('variante urbanistica').map(e=>e.event_type)).toEqual(['VARIANTE_URBANISTICA']);expect(parse('cessazione attività commerciale')[0].derived_signals).toEqual(['POSSIBLE_COMMERCIAL_SPACE_TRANSITION']);});
 it('no observed_at fallback for unknown historical date',()=>{const e=extractPropertyFacts('x',{...evidence,text:'frazionamento'},null)[0];expect(e.event_date).toBeNull();expect(e.date_semantics).toBe('UNKNOWN');});
 it('rejects hypothetical and negated planning references in real PDF context',()=>{
  for(const text of ['un piano di lottizzazione rappresenterebbe una superflua attività','possono essere attuati dal Comune previa espropriazione a norma di legge','il proprio intervento senza il preventivo piano attuativo'])expect(extractPropertyFacts('x',{...evidence,field:'pdf.text',page:4,text},'2023-01-01')).toEqual([]);
  expect(extractPropertyFacts('x',{...evidence,field:'pdf.text',page:3,text:'ha trasmesso il certificato di ultimazione dei lavori'},'2023-01-01')[0]).toMatchObject({event_type:'FINE_LAVORI',works_lifecycle:'COMPLETED'});
 });
 it.each(['demolizione e ricostruzione dei tramezzi interni','demolizione e ricostruzione delle tramezzature interne','demolizione e ricostruzione di piccoli tratti di tramezzatura','demolizione e ricostruzione dei rivestimenti del bagno','demolizione e ricostruzione della scala','non comportano la modifica della destinazione d’uso','CAMBIO DESTINAZIONE URBANISTICA DA C/1 A C/6','realizzato a seguito di condono edilizio','A conclusione dei lavori i due locali presenteranno zone di passaggio interne'])('rejects the real false positive %s',text=>expect(parse(text)).toEqual([]));
 it('a later PDF citing an old completion certificate cannot date completion to the later act',()=>{const e=extractPropertyFacts('x',{...evidence,field:'pdf.text',page:3,text:'con nota del 14/06/2022 il direttore ha trasmesso il certificato di ultimazione dei lavori'},'2025-01-01')[0];expect(e).toMatchObject({event_date:null,document_date:'2025-01-01',completion_reported_by:'2022-06-14',date_evidence:'14/06/2022'});});
 it('known transformation + later completion combine only in a known building without sold evidence',()=>{
  const first=parse('frazionamento','2026-08-01')[0],end=parse('comunicazione fine lavori','2026-10-01')[0];end.id='different-record';
  const context={buildingId:'b',knownProperties:1,activeProperties:0,soldEvidence:false};
  expect(combinePropertyFacts([first,end],context).map(c=>c.type)).toContain('POSSIBLE_NEW_UNITS_PRE_MARKET');
  expect(combinePropertyFacts([first,end],{...context,activeProperties:1}).map(c=>c.type)).not.toContain('POSSIBLE_NEW_UNITS_PRE_MARKET');
  expect(combinePropertyFacts([first,end],{...context,soldEvidence:true}).map(c=>c.type)).not.toContain('POSSIBLE_NEW_UNITS_PRE_MARKET');
  expect(combinePropertyFacts([first,end],{...context,knownProperties:0}).map(c=>c.type)).not.toContain('POSSIBLE_NEW_UNITS_PRE_MARKET');
  expect(combinePropertyFacts([first,{...end,event_date:'2026-07-01'}],context)).toEqual([]);
 });
 it('a recent road order cannot outrank an evidenced transformation',()=>{const now=Date.parse(evidence.observedAt);expect(factRank(parse('lavori stradali','2026-10-19')[0],'STREET',now,evidence.observedAt)).toBeLessThan(factRank(parse('frazionamento','2024-01-01')[0],'BUILDING',now,'2024-01-01'));});
 it('regularization of old works cannot become a new transformation sequence',()=>{const e=extractPropertyFacts('x',{...evidence,sourceUrl:'https://www.opendata.maggioli.cloud/elenco-pratiche.csv',text:'Sanatoria per frazionamento e fusione del terrazzo comune'},'2026-01-01');expect(e.find(v=>v.event_type==='FUSIONE')).toMatchObject({event_subtype:'PARTIAL_ASSET',real_estate_relevance:55});expect(combinePropertyFacts([...e,...parse('comunicazione fine lavori','2026-02-01')],{buildingId:'b',knownProperties:1,activeProperties:0,soldEvidence:false})).toEqual([]);});
 it('extracts explicitly stated before/after and public ownership',()=>{expect(parse('frazionamento da una a due unità')[0]).toMatchObject({units_before:1,units_after:2});expect(parse('alienazione di immobili comunali')[0].ownership_scope).toBe('PUBLIC');});
 it('training and procurement are not new transformations; unrelated territories are quarantined',()=>{
  expect(parse('PARTECIPAZIONE AL MASTER DI FORMAZIONE IN MATERIA DI ESPROPRIAZIONE')).toEqual([]);
  expect(extractPropertyFacts('x',{...evidence,text:'Altamura, variante urbanistica',field:'albo.subject',territorialScopeVerified:false},'2026-01-01')).toEqual([]);
  expect(extractPropertyFacts('x',{...evidence,text:'Bitonto, affidamento pubblicazione avviso variante urbanistica',field:'albo.subject',territorialScopeVerified:false},'2026-01-01')[0]).toMatchObject({event_subtype:'SUPPORTING_ADMINISTRATION',real_estate_relevance:25});
 });
});
