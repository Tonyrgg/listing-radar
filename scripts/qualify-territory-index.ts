import {readTerritoryProtocolIndex} from '../src/lib/property-lifecycle/buildings/protocol-index';
import {normalizeBuildingPracticeRows,parseBuildingPracticeCsv} from '../src/lib/property-lifecycle/buildings/practices';
async function main(){
 if(process.argv.length>2)throw Error('This command only qualifies the public source; no arguments or writes.');
 const index=await readTerritoryProtocolIndex();
 const normalized=normalizeBuildingPracticeRows(parseBuildingPracticeCsv(index.csv),{applicationCode:null,includeProtocolIdentity:true});
 const topics:Record<string,number>={};
 for(const record of normalized.records)for(const topic of record.sanitizedPayload.documentSearchTopics as string[])topics[topic]=(topics[topic]??0)+1;
 console.log(JSON.stringify({sourceRows:index.inputRows,pages:index.pages,practiceGroups:normalized.records.length,dataQuality:normalized.dataQuality,topics,
  documentSearchCandidates:normalized.records.filter(record=>(record.sanitizedPayload.documentSearchTopics as string[]).length>0&&record.sanitizedPayload.treatment!=='ARCHIVE_ONLY_JUDICIAL').length,
  coherentIdentities:normalized.records.filter(record=>record.sanitizedPayload.registryIdentity).length,productionWrites:0,factsCreated:0,rawRetained:false}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Protocol qualification failed');process.exitCode=1;});
