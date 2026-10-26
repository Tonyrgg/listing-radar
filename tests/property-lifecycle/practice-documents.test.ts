import {describe,it,expect} from 'vitest';
import {extractAdministrativeIdentity,matchPracticeDocuments} from '@/lib/property-lifecycle/buildings/practice-documents';
import {extractPropertyFacts} from '@/lib/property-lifecycle/buildings/property-facts';
import {newsSourceContext} from '@/lib/property-lifecycle/buildings/news-source-context';

const url='https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio?p_p_resource_id=downloadAllegato&id=1';
const reference=extractAdministrativeIdentity('Pratica 12/2025/SCIA, prot. n. 410 del 01/03/2025. Persona sintetica');
const index={id:'index',content_hash:'index-hash',practice_number:'12/2025/SCIA',protocol_number:'410',occurred_at:'2025-03-01T00:00:00Z',sanitized_payload:{registryIdentity:reference.identity}};
const primary={id:'act',content_hash:'act-hash',document_urls:[url],sanitized_payload:{administrativeReferences:reference}};
describe('practice to primary publication matching',()=>{
 it('retains only explicit practice, protocol and valid protocol date',()=>{
  expect(reference.identity).toEqual({practiceNumber:'12/2025/SCIA',protocolNumber:'410',protocolDate:'2025-03-01'});
  expect(JSON.stringify(reference)).not.toContain('Persona');
  expect(extractAdministrativeIdentity('Pratica 12/2025/SCIA prot.410 del 31/02/2025').identity).toBeNull();
  expect(extractAdministrativeIdentity('Pratica 12/2025/SCIA e 13/2025/SCIA prot.410 del 01/03/2025').identity).toBeNull();
  expect(extractAdministrativeIdentity('Pratica 12/2025/SCIA prot.410 del 01/03/2025 e prot.411 del 02/03/2025').identity).toBeNull();
 });
 it('links a unique exact identity and exposes no inferred property or location',()=>{
  const result=matchPracticeDocuments([index],[primary])[0];
  expect(result).toMatchObject({search_state:'LINKED',primary_record_id:'act',candidate_count:1});
  expect(result).not.toHaveProperty('building_id');expect(result).not.toHaveProperty('events');
 });
 it('rejects mismatched dates and ambiguous publications instead of choosing the first',()=>{
  expect(matchPracticeDocuments([{...index,sanitized_payload:{registryIdentity:{...reference.identity,protocolDate:'2025-03-02'}}}],[primary])[0].search_state).toBe('NO_MATCH');
  expect(matchPracticeDocuments([index],[primary,{...primary,id:'second'}])[0]).toMatchObject({search_state:'AMBIGUOUS',primary_record_id:null});
 });
 it('requires a public attachment and refuses credentials or foreign hosts',()=>{
  expect(matchPracticeDocuments([index],[{...primary,document_urls:['https://foreign.test/a.pdf']}])[0].search_state).toBe('NO_ATTACHMENT');
  expect(matchPracticeDocuments([index],[{...primary,document_urls:[url.replace('https://','https://user:password@')]}])[0].search_state).toBe('NO_ATTACHMENT');
  expect(matchPracticeDocuments([{...index,sanitized_payload:{registryIdentity:null}}],[primary])[0].search_state).toBe('IDENTIFIERS_MISSING');
 });
 it('keeps judicial records out of document treatment, facts and news',()=>{
  expect(matchPracticeDocuments([{...index,sanitized_payload:{treatment:'ARCHIVE_ONLY_JUDICIAL'}}],[primary])).toEqual([]);
  expect(matchPracticeDocuments([index],[{...primary,sanitized_payload:{...primary.sanitized_payload,treatment:'ARCHIVE_ONLY_JUDICIAL'}}])[0].search_state).toBe('NO_MATCH');
  const text='Esecuzione immobiliare: vendita giudiziaria di immobile con frazionamento in due unità';
  expect(extractPropertyFacts('id',{text,field:'albo.subject',sourceUrl:url,sourceHash:'hash',observedAt:'2026-10-26'},'2026-10-01')).toEqual([]);
  expect(newsSourceContext(text,url,'hash','2026-10-26')?.disposition).toBe('JUDICIAL_ARCHIVE_ONLY');
 });
});
