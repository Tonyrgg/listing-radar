import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildRegistry,registrySummary,type RegistryKind,type TonyRegistry} from '../src/lib/tonybook/registry';
const arg=(name:string)=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
async function main(){
const input=arg('input'),output=arg('output'),previous=arg('previous');
if(!input||!output)throw Error('Usa --input=<cartella CSV> --output=<nuova cartella privata> [--previous=<registry.json>]');
const names={environments:'ambienti.csv',relationships:'relazioni.csv',actions:'azioni.csv',signals:'segnali.csv'};
const csv=Object.fromEntries(await Promise.all(Object.entries(names).map(async([key,file])=>[key,await readFile(path.join(input,file),'utf8')]))) as Record<RegistryKind,string>;
const prior=previous?JSON.parse(await readFile(previous,'utf8')) as TonyRegistry:null;
const registry=buildRegistry(csv,prior),summary=registrySummary(registry);
await mkdir(output,{recursive:false});
await writeFile(path.join(output,'registry.json'),JSON.stringify(registry,null,2)+'\n');
await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
await writeFile(path.join(output,'SESSIONE.md'),'# TonyBook — riepilogo locale\n\nSegnali attivi: '+summary.activeSignals.join(', ')+'. Proposte non inviate: '+summary.draftActions.join(', ')+'.\n\nScarti/rifiuti conservati: '+summary.rejected.join(', ')+'. Date originali ignote: '+summary.unknownPublicationDates+'.\n\nAzioni indicate come eseguite nel CSV: '+summary.actionsDeclaredDone.join(', ')+'. Sono dichiarazioni del registro, non verifiche di invio.\n\nNessun accesso Facebook o invio eseguito da questo comando. I CSV sorgenti non sono modificati; registry.json contiene dati operativi e deve restare privato e fuori Git.\n');
console.log(JSON.stringify({records:summary.total,activeSignals:summary.activeSignals.length,drafts:summary.draftActions.length}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Registro non elaborato');process.exitCode=1;});
