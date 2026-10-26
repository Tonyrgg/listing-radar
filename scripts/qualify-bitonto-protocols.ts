import {writeFile} from 'node:fs/promises';
import {BITONTO_PROTOCOL_OFFICES,BITONTO_PROTOCOL_RESOURCE,qualifyProtocolRows} from '../src/lib/property-lifecycle/buildings/protocol-register';
const args=process.argv.slice(2),value=(name:string)=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
async function json(url:URL){
 const response=await fetch(url,{signal:AbortSignal.timeout(25_000)});
 if(!response.ok)throw Error('Fonte non disponibile: HTTP '+response.status);
 const body=await response.text();if(Buffer.byteLength(body)>1_500_000)throw Error('Risposta oltre il limite');
 const result=JSON.parse(body);if(result.success!==true)throw Error('Il servizio CKAN non ha confermato la risposta');return result.result;
}
async function main(){
 if(args.some(arg=>!/^--(?:output|limit)=.+$/.test(arg)))throw Error('Usa --output=<nuovo report.json> [--limit=20]');
 const output=value('output'),limit=Number(value('limit')??20);
 if(!output||!Number.isInteger(limit)||limit<1||limit>30)throw Error('Output obbligatorio; limite intero da 1 a 30');
 const resource='"'+BITONTO_PROTOCOL_RESOURCE+'"';
 const fields=['Applicazione','Numero Pratica','Oggetto','Data Protocollo','Numero Protocollo','Ufficio Responsabile'].map(field=>'"'+field+'"').join(', ');
 const office='"Ufficio Responsabile" IN ('+BITONTO_PROTOCOL_OFFICES.map(name=>"'"+name.replaceAll("'","''")+"'").join(',')+')';
 const base='SELECT MIN("_id") AS sample_row_id, COUNT(*) AS occurrences, '+fields+' FROM '+resource+' WHERE '+office;
 const grouped=' GROUP BY '+fields+' ORDER BY "Data Protocollo" DESC NULLS LAST, MIN("_id") DESC LIMIT ';
 const targeted=`(lower("Oggetto") LIKE '%frazion%' OR lower("Oggetto") LIKE '%destinaz%' OR lower("Oggetto") LIKE '%edificabil%' OR lower("Oggetto") LIKE '%division%' OR lower("Oggetto") LIKE '%succession%' OR lower("Oggetto") LIKE '%eredit%')`;
 const query=async(sql:string)=>{const url=new URL('https://dati.puglia.it/ckan/api/3/action/datastore_search_sql');url.searchParams.set('sql',sql);const result=await json(url);if(!Array.isArray(result.records))throw Error('Schema CKAN non valido');return result.records;};
 // Queries are sequential and bounded. No credentials, CRM or production database.
 const recent=await query(base+' AND "Data Protocollo" IS NOT NULL'+grouped+limit);
 const target=await query(base+' AND '+targeted+grouped+limit);
 const undated=await query(base+' AND "Data Protocollo" IS NULL'+grouped+'5');
 // The same aggregate can be returned by multiple sampling strata: count it once.
 const sample=[...new Map([...recent,...target,...undated].map(row=>[String(row.sample_row_id),row])).values()];
 const report={sourceUrl:'https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche',resourceId:BITONTO_PROTOCOL_RESOURCE,
  observedAt:new Date().toISOString(),sampling:{recentGroups:recent.length,targetedGroups:target.length,undatedGroups:undated.length,limitPerDatedStratum:limit,representative:false},
  ...qualifyProtocolRows(sample)};
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({groups:report.groups,sourceRows:report.sourceRows,repeatedRows:report.repeatedRows,dispositions:report.dispositions,missingDates:report.missingDates,productionWrites:0,factsCreated:0,newsCreated:0}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Fonte non qualificata');process.exitCode=1;});
