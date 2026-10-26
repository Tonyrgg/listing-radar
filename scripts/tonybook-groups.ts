import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {proposeGroupEnvironments,type GroupSnapshot} from '../src/lib/tonybook/groups';
import {HEADERS,type TonyRegistry} from '../src/lib/tonybook/registry';
const value=(name:string)=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
async function main(){
 const input=value('input'),output=value('output'),prior=value('registry');
 if(!input||!output)throw Error('Usa --input=<snapshot.json> --output=<nuova cartella privata> [--registry=<registro.json>]');
 const snapshot=JSON.parse(await readFile(input,'utf8')) as GroupSnapshot,registry=prior?JSON.parse(await readFile(prior,'utf8')) as TonyRegistry:null;
 const report=proposeGroupEnvironments(snapshot,registry);
 await mkdir(output,{recursive:false});
 const csv=(fields:string[])=>fields.map(value=>'"'+value.replaceAll('"','""')+'"').join(',');
 await writeFile(path.join(output,'group-candidates.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 await writeFile(path.join(output,'ambienti-proposti.csv'),[csv([...HEADERS.environments]),...report.environments.map(row=>csv(HEADERS.environments.map(key=>row[key]??'')))].join('\n')+'\n',{mode:0o600});
 console.log(JSON.stringify({uniqueGroups:report.uniqueGroups,proposed:report.proposed,coverage:report.coverage,collectionVerified:false,externalActions:0}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Snapshot non elaborato');process.exitCode=1;});
