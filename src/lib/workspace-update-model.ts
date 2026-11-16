export type RecordFields=Record<string,string|number|null>;
export type RecordVersion=string|{hash:string;fields:RecordFields};
export type UpdateRecap={hash:string;changes:{field:string;label:string;before:string|number|null;after:string|number|null}[];previousUnavailable:boolean;current:RecordFields};
export type WorkspacePreference={key:string;value:unknown;updated_at?:string};
export const updateFieldLabels:Record<string,string>={address:'Indirizzo',latest_asking_price:'Prezzo richiesto',exit_classification:'Esito',sale_status:'Stato della vendita',agency_name:'Agenzia',agency_role:'Rapporto con l’agenzia',private_seller_type:'Tipo di venditore',opportunity_score:'Indice di priorità',drop_count:'Ribassi registrati',earliest_market_evidence_at:'Prima presenza documentata',surface_sqm:'Superficie',rooms:'Locali',property_type:'Tipologia',latitude:'Latitudine',longitude:'Longitudine',street_number:'Civico'};
export function versionHash(value:unknown):string|null{return typeof value==='string'?value:value&&typeof value==='object'&&'hash'in value&&typeof value.hash==='string'?value.hash:null;}
export function versionFields(value:unknown):RecordFields|null{return value&&typeof value==='object'&&'fields'in value&&value.fields&&typeof value.fields==='object'&&!Array.isArray(value.fields)?Object.fromEntries(Object.entries(value.fields).filter(([,v])=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v))) as RecordFields:null;}
export function previousReceipt(prefs:WorkspacePreference[]|Map<string,WorkspacePreference>,prefix:string,tab:string,id:string):unknown{
 const get=(key:string)=>prefs instanceof Map?prefs.get(key):prefs.find(r=>r.key===key);
 const baseline=get(`${prefix}:read:${tab}`),individual=get(`${prefix}:record:${tab}:${id}`);
 const baseValue=baseline?.value&&typeof baseline.value==='object'?(baseline.value as Record<string,unknown>)[id]:undefined;
 if(individual&&(!baseValue||Date.parse(individual.updated_at??'')>=Date.parse(baseline?.updated_at??'')||!baseline?.updated_at))return individual.value;
 return baseValue;
}
export function updateRecap(previous:unknown,current:RecordVersion):UpdateRecap{
 const before=versionFields(previous),after=versionFields(current)??{};
 return{hash:versionHash(current)!,previousUnavailable:!before,current:after,changes:before?Object.entries(updateFieldLabels).filter(([key])=>!(key==='agency_name'&&'agency_id'in before&&'agency_id'in after&&before.agency_id===after.agency_id)&&(before[key]??null)!==(after[key]??null)).map(([field,label])=>({field,label,before:before[field]??null,after:after[field]??null})):[]};
}
