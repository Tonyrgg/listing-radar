import {ImportV2Error} from './errors.js';
export type CrmRecordKind='property'|'news'|'mandate'|'unknown';
export function crmRecordKind(...labels:(string|null|undefined)[]):CrmRecordKind{
 const text=labels.filter(Boolean).join(' ').trim();
 if(/\bIN\s*[-–]\s*\d|\/s\/incarico\//i.test(text)||labels.some(v=>/^\s*incarico\s*$/i.test(v??'')))return 'mandate';
 if(/\bNT\s*[-–]\s*\d|\/s\/notizia\//i.test(text)||labels.some(v=>/^\s*notizia\s*$/i.test(v??'')))return 'news';
 if(/\bIM\s*[-–]\s*\d/i.test(text)||labels.some(v=>/^\s*immobile\s*$/i.test(v??'')))return 'property';
 return 'unknown';
}
export function assertOrdinaryProperty(kind:CrmRecordKind){
 if(kind!=='property')throw new ImportV2Error(kind==='unknown'?'Tipo della scheda non verificato: nessuna scrittura autorizzata.':`Scheda protetta (${kind==='mandate'?'incarico':'notizia'}): esclusa senza modifiche.`, 'unsupported_case',{details:{protectedRecord:true,recordKind:kind}});
}
