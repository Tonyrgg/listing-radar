import {it,expect} from 'vitest';
import {crmRecordKind,assertOrdinaryProperty} from '../src/import-v2/record-protection.js';
it.each([['IN-00123','mandate'],['NT - 55','news'],['IM-0056','property'],['Incarico','mandate'],['Notizia','news'],['Immobile','property'],['Unknown','unknown']])('classifies %s as %s',(label,kind)=>{expect(crmRecordKind(label)).toBe(kind);});
it('does not mistake actions or the related-list title for the record type',()=>{expect(crmRecordKind('IM-0005','Immobili / Notizie / Incarichi','Crea incarico')).toBe('property');});
it('recognizes alphanumeric codes, non-breaking dashes and explicit record subtypes',()=>{
 expect(crmRecordKind('IM-AB123')).toBe('property');expect(crmRecordKind('IM‑AB123')).toBe('property');
 expect(crmRecordKind('Immobile residenziale')).toBe('property');expect(crmRecordKind('IN-AB123')).toBe('mandate');
});
it('blocks protected and unknown records',()=>{for(const kind of ['news','mandate','unknown'] as const)expect(()=>assertOrdinaryProperty(kind)).toThrow();expect(()=>assertOrdinaryProperty('property')).not.toThrow();});
