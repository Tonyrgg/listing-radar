import {createHash} from 'node:crypto';
export const HEADERS={
 environments:['id','nome','url','tipo','regole_osservate','regole_verificate_il','ultimo_esame','pertinenza','decisione','note'],
 relationships:['id','nome_pubblico','url','categoria','legame_bitonto_evidenza','contesto_conosciuto_da_antonio','fonte_url','osservato_il','stato','ultima_interazione_reale','prossimo_passo','data_eventuale'],
 actions:['id','relazione_id','contesto_url','contenuto_del','osservato_il','motivo','bozza','stato','eseguita_il','esito','prossimo_passo'],
 signals:['id','relazione_id','fonte_url','fatto_dichiarato','verifiche_mancanti','stato_qualifica','prossimo_passo','listing_radar_id'],
} as const;
export type RegistryKind=keyof typeof HEADERS;
export type RegistryRecord={id:string;kind:RegistryKind;data:Record<string,string>;state:'ACTIVE'|'REJECTED'|'DRAFT'|'DONE'|'UNKNOWN';signature:string;observedAt:string|null;publishedAt:string|null;importedAt:string;rejection:{declaredState:string;at:string}|null;history:{signature:string;at:string}[]};
export interface TonyRegistry{version:1;importedAt:string;records:RegistryRecord[]}
function csvDocument(input:string):{header:string[];records:Record<string,string>[]} {
 const text=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i]!;
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('Virgolette CSV non valide');quoted=true;continue;}
  if(c===','||c==='\n'){row.push(field);field='';closed=false;if(c==='\n'){if(row.some(v=>v!==''))rows.push(row);row=[];}continue;}
  if(closed)throw Error('Carattere dopo chiusura campo CSV');field+=c;
 }
 if(quoted)throw Error('Campo CSV non chiuso');
 if(field||row.length||closed){row.push(field);rows.push(row);}
 const header=rows.shift();if(!header?.length||new Set(header).size!==header.length||header.some(v=>!v))throw Error('Intestazioni CSV non valide');
 return {header,records:rows.map(values=>{if(values.length!==header.length)throw Error('Numero di campi CSV non coerente');return Object.fromEntries(header.map((key,i)=>[key,values[i]!]));})};
}
export function parseCsv(input:string):Record<string,string>[] {return csvDocument(input).records;}
const absolute=(value:string|undefined):string|null=>{
 if(!value||!/^\d{4}-\d{2}-\d{2}(T.*(Z|[+-]\d{2}:\d{2}))?$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 if(value.length===10)return new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;
 return new Date(value).toISOString();
};
function declaredState(value:string):RegistryRecord['state']{
 const s=value.trim().toUpperCase().replace(/_/g,' ');
 if(/^(SCARTAT|RIFIUTAT|REJECTED)/.test(s)||s==='NO')return 'REJECTED';
 if(/^(NON INVIAT|BOZZA|DA APPROVARE)/.test(s))return 'DRAFT';
 if(/^(ESEGUIT|INVIAT|DONE)/.test(s))return 'DONE';
 if(['ACTIVE','ATTIVO','ATTIVA','DA VERIFICARE','DA APPROFONDIRE','APPROFONDIRE'].includes(s))return 'ACTIVE';
 return 'UNKNOWN';
}
export function buildRegistry(csv:Record<RegistryKind,string>,previous:TonyRegistry|null=null,importedAt=new Date().toISOString()):TonyRegistry {
 if(previous&&(previous.version!==1||!Array.isArray(previous.records)))throw Error('Versione registro non supportata');
 const records=new Map((previous?.records??[]).map(record=>[record.kind+':'+record.id,structuredClone(record)]));
 for(const kind of Object.keys(HEADERS) as RegistryKind[]){
  const {header,records:rows}=csvDocument(csv[kind]),ids=new Set<string>();
  if(HEADERS[kind].some(key=>!header.includes(key))||header.some(key=>!(HEADERS[kind] as readonly string[]).includes(key)))throw Error('Schema CSV non supportato: '+kind);
  for(const data of rows){
   if(HEADERS[kind].some(key=>!Object.hasOwn(data,key))||Object.keys(data).some(key=>!(HEADERS[kind] as readonly string[]).includes(key)))throw Error('Schema CSV non supportato: '+kind);
   const prefix={environments:'E',relationships:'R',actions:'A',signals:'S'}[kind];
   if(!new RegExp('^'+prefix+'[0-9]{3,6}$').test(data.id!)||ids.has(data.id!))throw Error('ID duplicato o non valido: '+kind);
   ids.add(data.id!);
   const key=kind+':'+data.id,prior=records.get(key),rawState=data.stato_qualifica??data.stato??data.decisione??'';
   const state=prior?.state==='REJECTED'?'REJECTED':declaredState(rawState);
   const signature=createHash('sha256').update(JSON.stringify({kind,data})).digest('hex');
   if(prior?.signature===signature)continue;
   records.set(key,{id:data.id!,kind,data,state,signature,
    observedAt:absolute(data.osservato_il??data.ultimo_esame),publishedAt:absolute(data.contenuto_del),
    importedAt,rejection:prior?.rejection??(state==='REJECTED'?{declaredState:rawState,at:importedAt}:null),
    history:[...(prior?.history??[]),...(prior?[{signature:prior.signature,at:prior.importedAt}]:[])]});
  }
 }
 return {version:1,importedAt,records:[...records.values()].sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id))};
}
export function registrySummary(registry:TonyRegistry){
 const ids=(kind:RegistryKind,state:RegistryRecord['state'])=>registry.records.filter(r=>r.kind===kind&&r.state===state).map(r=>r.id);
 return {version:1,total:registry.records.length,activeSignals:ids('signals','ACTIVE'),
  draftActions:ids('actions','DRAFT'),actionsDeclaredDone:ids('actions','DONE'),rejected:registry.records.filter(r=>r.state==='REJECTED').map(r=>r.id),
  unknownPublicationDates:registry.records.filter(r=>!r.publishedAt).length,
  unknownStates:registry.records.filter(r=>r.state==='UNKNOWN').length};
}
