import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {analyzeReviews} from '../scripts/seller-review-report.mjs';
import {makeReviewRows,GROUPS} from '../scripts/seller-review-template.mjs';
const sample=()=> {
 const detected={market:[{property_id:'p',address:'Via sintetica',source_urls:['https://example.test/item']}],opportunities:[],sold:[{property_id:'s',source_url:'https://example.test/sale'}],news:[]};
 const reviews=makeReviewRows(detected);
 return {detected,reviews,manifest:{kind:'FROZEN_REVIEW_NOT_CURRENT_MARKET',source_hash:createHash('sha256').update(JSON.stringify(detected)).digest('hex'),counts:Object.fromEntries(GROUPS.map(g=>[g,reviews.filter(r=>r.group===g).length]))}};
};
const fill=row=>Object.assign(row,{judgement:'CONFIRMED',reviewer:'Revisore sintetico',reviewer_kind:'human',reviewed_at:'2026-10-25T10:00:00Z',checked_source_url:'https://example.test/proof',observed_fact:'Fatto sintetico verificato',prediction_seen:false});
describe('rapporto giudizi congelati',()=>{
 it('nessun giudizio diventa una precisione inventata',()=>{const r=analyzeReviews(sample());expect(r.reviewed).toBe(0);expect(r.groups.IDENTITY.agreement).toBeNull();});
 it('conta solo dimensioni esplicite e indipendenza dichiarata',()=>{const s=sample();fill(s.reviews[0]);s.reviews[0].field_judgements={identity:'CONFIRMED',asking_price:'NOT_ENOUGH_EVIDENCE'};const r=analyzeReviews(s);expect(r.independent).toBe(1);expect(r.groups.IDENTITY.dimensions.asking_price.agreement).toBeNull();expect(r.groups.SOLD.reviewed).toBe(0);});
 it('non scambia un giudizio globale sui venduti per prezzo di transazione',()=>{const s=sample();fill(s.reviews[1]);delete s.reviews[1].prediction_seen;const r=analyzeReviews(s);expect(r.independent).toBe(0);expect(r.groups.SOLD.dimensions).toEqual({});});
 it.each(['hash','id','duplicate','judgement','metadata','frozen'])('rifiuta corruzioni: %s',kind=>{const s=sample();if(kind==='hash')s.manifest.source_hash='bad';if(kind==='id')s.reviews[0].review_id='UNKNOWN';if(kind==='duplicate')s.reviews[1]=s.reviews[0];if(kind==='judgement')fill(s.reviews[0]).judgement='MAYBE';if(kind==='metadata')s.reviews[0].judgement='CONFIRMED';if(kind==='frozen')s.reviews[0].address='Mutato';expect(()=>analyzeReviews(s)).toThrow();});
});
