/** Explicit, backed-up recovery for a CLOSED desktop profile. Never overwrites an archive. */
import {copyFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TerritoryStore} from '../src/territory/store.js';
import {TerritorySync,onlineSyncConfig} from '../src/territory/sync.js';
import {lockTerritoryProfile} from '../src/territory/profile-lock.js';
import type {Street} from '../src/territory/model.js';
const apply=process.argv.includes('--apply');
const directory=path.join(process.env.APPDATA!,'ListingRadarTerritoryLab-live');
const identity=JSON.parse(await readFile(path.join(directory,'online-config.json'),'utf8'));
const approved=process.env.NEXT_PUBLIC_SUPABASE_URL!;
const config=onlineSyncConfig({...identity,key:process.env.SUPABASE_SERVICE_ROLE_KEY!},approved);
const confirmed=process.argv.find(arg=>arg.startsWith('--confirm-project='))?.split('=')[1];
if(apply&&confirmed!==new URL(approved).hostname.split('.')[0])throw Error('Explicit project confirmation required');
const ledger=JSON.parse(await readFile(path.join(directory,'territory-ledger.json'),'utf8'));
if(!apply){console.log(JSON.stringify({mode:'read-only',units:Object.keys(ledger.units).length,runs:ledger.runs.length,next:'Close Worker, then --apply --confirm-project=<configured project>'}));}
else{
 const release=lockTerritoryProfile(directory);
 try{
  const backup=path.join(directory,'sync-recovery',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(backup,{recursive:true});
  for(const file of ['territory-ledger.json','sync-state-online.json'])try{await copyFile(path.join(directory,file),path.join(backup,file));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const inventory=JSON.parse(await readFile(path.join(root,'dist-desktop/territory/renderer/inventory.json'),'utf8')) as {streets:Street[]};
  const store=await TerritoryStore.open(directory,inventory.streets);
  const sync=new TerritorySync(store,directory,config,undefined,approved);
  const started=performance.now();await sync.reconcile();const status=await sync.status();
  const state=store.read();
  console.log(JSON.stringify({mode:'reconciled',revision:status.revision,pending:status.pending,conflicts:status.conflicts.length,units:Object.keys(state.units).length,elapsedMs:performance.now()-started,backup,streets:state.streets.filter(s=>/gorizia|giotto/i.test(s.name)).map(s=>({name:s.name,units:Object.values(state.units).filter(u=>u.streetIds.includes(s.id)).length}))}));
  if(status.pending||status.conflicts.length)process.exitCode=2;
 }finally{release();}
}
