import {expect,it} from 'vitest';
import {qualifyProtocolRows} from '@/lib/property-lifecycle/buildings/protocol-register';
const row=(subject:string)=>({_id:1,Applicazione:'ape','Numero Pratica':'12/2026',Oggetto:subject,'Data Protocollo':'2026-09-16T00:00:00','Numero Protocollo':500,'Ufficio Responsabile':'13.2 - Edilizia Privata'});
it('keeps access requests out of transformation candidates and never exports the subject',()=>{
 const result=qualifyProtocolRows([row('Richiesta accesso agli atti per frazionamento - Persona Sintetica')]);
 expect(result.candidates[0]).toMatchObject({disposition:'ARCHIVE',reason:'ADMINISTRATIVE_REQUEST',topics:['SPLIT']});
 expect(JSON.stringify(result)).not.toContain('Persona Sintetica');expect(JSON.stringify(result)).not.toContain('Richiesta');
});
it('requires the primary document for useful topics, without promoting an occurrence to a fact',()=>{
 const result=qualifyProtocolRows([row("Cambio di destinazione d'uso da ufficio ad abitazione a Bitonto")]);
 expect(result.candidates[0]).toMatchObject({disposition:'DOCUMENT_REVIEW',evidenceGrade:'REGISTER_METADATA_ONLY',localityMentioned:true,structuredTerritorialFields:false});
 expect(result).toMatchObject({factsCreated:0,newsCreated:0,productionWrites:0});
});
it('does not call residential construction a use change, or habitability suitability a split',()=>{
 for(const subject of ['Nuovo fabbricato a destinazione abitativa','Attestazione idoneità abitativa'])expect(qualifyProtocolRows([row(subject)]).candidates[0]?.disposition).toBe('ARCHIVE');
});
it('retains missing and impossible dates without borrowing the observation date',()=>{
 for(const value of [null,'2026-02-30','2026-09-16 junk']){
  const result=qualifyProtocolRows([{...row('frazionamento'),'Data Protocollo':value}]);
  expect(result.candidates[0]).toMatchObject({protocolDate:null,disposition:'DATA_REVIEW'});
 }
});
it('deduplicates only exact data with complete identity, preserving changed descriptions',()=>{
 const a=row('frazionamento'),b={...a,_id:2},c={...a,_id:3,Oggetto:'Cambio di destinazione d’uso'};
 const result=qualifyProtocolRows([a,b,c]);expect(result).toMatchObject({sourceRows:3,groups:2,repeatedRows:1});
 expect(qualifyProtocolRows([{...a,'Numero Protocollo':null},{...b,'Numero Protocollo':null}]).groups).toBe(2);
});
it('requires the exact responsible office and validates source counts',()=>{
 expect(qualifyProtocolRows([{...row('frazionamento'),'Ufficio Responsabile':'Servizio territoriale sociale'}]).candidates[0]?.disposition).toBe('OUT_OF_SCOPE');
 expect(()=>qualifyProtocolRows([{...row('frazionamento'),occurrences:-1}])).toThrow();
});
