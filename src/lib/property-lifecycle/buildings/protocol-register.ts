import {createHash} from 'node:crypto';

/** Qualification only: a protocol entry is not proof that works were authorized or completed. */
export const BITONTO_PROTOCOL_RESOURCE='3f1b7588-60e2-449a-9c13-c369a65c0631';
export const BITONTO_PROTOCOL_OFFICES=[
 '13 - Servizio per il Territorio','13.2 - Edilizia Privata','13.3 - Edilizia Privata','13.3 - Centro Storico',
 '13.9 - Sportello Unico per le attività produttive (SUAP) e marketing per lo sviluppo economico',
] as const;
type ProtocolRow={_id?:unknown;sample_row_id?:unknown;occurrences?:unknown;Applicazione?:unknown;'Numero Pratica'?:unknown;Oggetto?:unknown;'Data Protocollo'?:unknown;'Numero Protocollo'?:unknown;'Ufficio Responsabile'?:unknown};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value:unknown){
 if(value===null||value===undefined)return '';
 if(typeof value!=='string'&&typeof value!=='number')throw Error('Campo del registro non valido');
 const result=String(value).normalize('NFC').trim();if(result.length>20_000)throw Error('Campo del registro troppo lungo');return result;
}
function date(value:string){
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))return null;
 const day=value.slice(0,10),parsed=new Date(day+'T00:00:00Z');
 return Number.isFinite(Date.parse(value))&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:null;
}
export function qualifyProtocolRows(rows:ProtocolRow[]){
 if(!Array.isArray(rows)||rows.length>100)throw Error('Campione massimo: 100 gruppi');
 const unique=new Map<string,{row:ReturnType<typeof normalize>;occurrences:number}>();let repeatedRows=0;
 function normalize(raw:ProtocolRow){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Riga del registro non valida');
  const row={application:text(raw.Applicazione),practice:text(raw['Numero Pratica']),subject:text(raw.Oggetto),date:text(raw['Data Protocollo']),protocol:text(raw['Numero Protocollo']),office:text(raw['Ufficio Responsabile'])};
  const occurrences=raw.occurrences??1;if(!Number.isSafeInteger(occurrences)||Number(occurrences)<1)throw Error('Conteggio righe non valido');
  const id=text(raw.sample_row_id??raw._id);if(!/^\d+$/.test(id))throw Error('Identificativo sorgente non valido');
  return {...row,sourceRowId:id,occurrences:Number(occurrences)};
 }
 for(const raw of rows){
  const row=normalize(raw);
  // Missing administrative identifiers never justify merging independent rows.
  const key=hash([row.application,row.practice,row.subject,row.date,row.protocol,row.office,
   row.application&&row.practice&&row.protocol&&date(row.date)?null:row.sourceRowId]);
  const prior=unique.get(key);if(prior){prior.occurrences+=row.occurrences;repeatedRows+=row.occurrences;}
  else {unique.set(key,{row,occurrences:row.occurrences});repeatedRows+=row.occurrences-1;}
 }
 const groups=[...unique.values()].map(({row,occurrences})=>{
  const topics:string[]=[];
  if(/frazionamento|(?:suddivisione|divisione)\s+in\s+(?:due|tre|\d+)\s+(?:unit[àa]|appartamenti|abitazioni)/i.test(row.subject))topics.push('SPLIT');
  if(/(?:cambio|cambiamento|mutamento|modifica)\s+(?:di\s+|della\s+)?destinazione\s+d['’]?uso/i.test(row.subject))topics.push('USE_CHANGE');
  if(/\b(?:non\s+)?edificabil[ei]|\binedificabil[ei]/i.test(row.subject))topics.push('BUILDABILITY_MENTION');
  if(/\bsuccession[ei]\b|\beredit[àa]\b|\bereditat[oaie]\b/i.test(row.subject))topics.push('INHERITANCE_MENTION');
  const access=/\baccesso\s+(?:(?:agli|ai|a|ad)\s+)?(?:atti|documenti|documentazione)|\baccesso\s+documentale/i.test(row.subject);
  const administrative=access||/idoneit[àa]\s+abitativa|numerazione\s+civica/i.test(row.subject);
  const officeAllowed=(BITONTO_PROTOCOL_OFFICES as readonly string[]).includes(row.office);
  const protocolDate=date(row.date),identityComplete=Boolean(row.application&&row.practice&&row.protocol&&protocolDate);
  const disposition=!officeAllowed?'OUT_OF_SCOPE':administrative||!topics.length?'ARCHIVE':!identityComplete?'DATA_REVIEW':'DOCUMENT_REVIEW';
  return {fingerprint:hash([row.application,row.practice,row.protocol,row.date,row.office,row.subject]),sourceRowId:row.sourceRowId,
   occurrences,protocolDate,identityComplete,officeAllowed,subjectHash:hash(row.subject),topics,disposition,
   reason:!officeAllowed?'OFFICE_NOT_ALLOWED':administrative?'ADMINISTRATIVE_REQUEST':!topics.length?'NO_TARGET_TRANSFORMATION':!identityComplete?'MISSING_ADMINISTRATIVE_IDENTITY':'PRIMARY_DOCUMENT_REQUIRED',
   evidenceGrade:'REGISTER_METADATA_ONLY',structuredTerritorialFields:false,
   localityMentioned:/\b(?:Bitonto|Palombaio|Mariotto)\b/i.test(row.subject)};
 });
 return {policy:'bitonto_protocol_qualification_v1',inputGroups:rows.length,groups:groups.length,
  sourceRows:groups.reduce((sum,g)=>sum+g.occurrences,0),repeatedRows,
  missingDates:groups.filter(g=>!g.protocolDate).length,
  dispositions:Object.fromEntries(['ARCHIVE','DATA_REVIEW','DOCUMENT_REVIEW','OUT_OF_SCOPE'].map(value=>[value,groups.filter(g=>g.disposition===value).length])),
  factsCreated:0,newsCreated:0,productionWrites:0,candidates:groups};
}
