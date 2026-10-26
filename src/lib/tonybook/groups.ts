import type {TonyRegistry} from './registry';
export interface GroupObservation {name:string;url:string;description?:string;membership:'JOINED'|'UNKNOWN'}
export interface GroupSnapshot {version:1;sourceUrl:string;observedAt:string;groups:GroupObservation[];reportedTotal:number|null;hasNextPage:boolean|null;endObserved:boolean}
const reserved=new Set(['joins','feed','discover','create','search','notifications','membership']);
export function groupUrl(raw:string){
 const u=new URL(raw);
 if(u.protocol!=='https:'||!['facebook.com','www.facebook.com','m.facebook.com','mbasic.facebook.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('URL gruppo Facebook non valido');
 const match=u.pathname.match(/^\/groups\/([A-Za-z0-9._-]{2,128})\/?$/);
 if(!match||reserved.has(match[1]!.toLowerCase()))throw Error('Serve il collegamento diretto al gruppo');
 return 'https://www.facebook.com/groups/'+match[1]!.toLowerCase()+'/';
}
export function groupRelevance(name:string,description=''){
 const text=(name+' '+description).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const localities=[...text.matchAll(/\b(?:bitont(?:o|ini|ino|ina|ine)|palombaio|mariotto)\b/g)].map(match=>match[0]!);
 const property=/\b(?:immobil\w*|case|casa|appartament\w*|affitt\w*|locazion\w*|proprietar\w*)\b/.test(text);
 if(localities.length)return {geography:'EXPLICIT_LOCAL' as const,topic:property?'PROPERTY':'LOCAL_COMMUNITY',evidence:[...new Set(localities)]};
 if(/\b(?:bari|puglia|provincia di bari|citta metropolitana di bari)\b/.test(text))return {geography:'REGIONAL_REVIEW' as const,topic:property?'PROPERTY':'GENERAL',evidence:[]};
 return {geography:'UNCLEAR' as const,topic:property?'PROPERTY':'GENERAL',evidence:[]};
}
export function proposeGroupEnvironments(snapshot:GroupSnapshot,previous:TonyRegistry|null=null){
 const source=new URL(snapshot.sourceUrl);
 if(snapshot.version!==1||source.origin!=='https://www.facebook.com'||source.pathname!=='/groups/joins/'||source.search||source.hash||!Number.isFinite(Date.parse(snapshot.observedAt))||!Array.isArray(snapshot.groups)||typeof snapshot.endObserved!=='boolean'||![true,false,null].includes(snapshot.hasNextPage)||!(snapshot.reportedTotal===null||Number.isInteger(snapshot.reportedTotal)&&snapshot.reportedTotal>=0))throw Error('Snapshot dei gruppi non valido');
 if(previous&&(previous.version!==1||!Array.isArray(previous.records)))throw Error('Registro precedente non valido');
 const environments=(previous?.records??[]).filter(row=>row.kind==='environments').map(row=>structuredClone(row.data));
 const known=new Set(environments.flatMap(row=>{try{return [groupUrl(row.url??'')];}catch{return [];}}));
 let nextId=Math.max(0,...environments.map(row=>Number(row.id?.match(/^E(\d+)$/)?.[1]??0)))+1;
 const grouped=new Map<string,GroupObservation>();let duplicates=0;
 for(const row of snapshot.groups){
  if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>500||typeof row.url!=='string'||!['JOINED','UNKNOWN'].includes(row.membership)||row.description!==undefined&&(typeof row.description!=='string'||row.description.length>5000))throw Error('Osservazione gruppo non valida');
  const canonical=groupUrl(row.url),prior=grouped.get(canonical);if(prior){duplicates++;if(prior.membership==='JOINED'||row.membership!=='JOINED')continue;}
  grouped.set(canonical,{...row,url:canonical});
 }
 const candidates=[...grouped.values()].map(row=>{
  const relevance=groupRelevance(row.name,row.description),alreadyKnown=known.has(row.url);
  const proposed=!alreadyKnown&&row.membership==='JOINED'&&relevance.geography==='EXPLICIT_LOCAL';
  if(proposed){
   if(nextId>999999)throw Error('Spazio ID ambienti esaurito');
   environments.push({id:'E'+String(nextId++).padStart(3,'0'),nome:row.name,url:row.url,tipo:'GRUPPO',regole_osservate:'',regole_verificate_il:'',ultimo_esame:'',pertinenza:relevance.geography,decisione:'DA VALUTARE',note:'Proposta da snapshot gruppi del '+snapshot.observedAt+'. Contenuti e regole del gruppo ancora da esaminare.'});
  }
  return {name:row.name,url:row.url,membershipDeclared:row.membership,...relevance,alreadyKnown,proposed};
 });
 const joinedDeclared=candidates.filter(row=>row.membershipDeclared==='JOINED').length;
 const declaredComplete=snapshot.reportedTotal!==null&&snapshot.reportedTotal===grouped.size&&snapshot.hasNextPage===false&&snapshot.endObserved&&joinedDeclared===grouped.size;
 return {sourceUrl:snapshot.sourceUrl,observedAt:snapshot.observedAt,collectionVerified:false,coverage:declaredComplete?'DECLARED_COMPLETE':'PARTIAL',reportedTotal:snapshot.reportedTotal,uniqueGroups:grouped.size,joinedDeclared,duplicates,proposed:candidates.filter(row=>row.proposed).length,candidates,environments};
}
