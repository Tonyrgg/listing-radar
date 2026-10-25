import {it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {parseCsv,buildRegistry,HEADERS,registrySummary,type RegistryKind} from '@/lib/tonybook/registry';
const encode=(fields:string[])=>fields.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',');
function sample(){
 const values={environments:'E001',relationships:'R001',actions:'A001',signals:'S001'};
 return Object.fromEntries((Object.keys(HEADERS) as RegistryKind[]).map(kind=>{
  const row=Object.fromEntries(HEADERS[kind].map(key=>[key,key==='id'?values[kind]:key==='stato_qualifica'?'SCARTATO':key==='stato'&&kind==='actions'?'NON INVIATA':key==='contenuto_del'?'18 ore fa':'']));
  return [kind,encode([...HEADERS[kind]])+'\n'+encode(HEADERS[kind].map(key=>row[key]))+'\n'];
 })) as Record<RegistryKind,string>;
}
it('legge CSV quotati Unicode, virgole e nuove righe senza campi persi',()=>{
 expect(parseCsv('\uFEFF"id","nota"\r\n"S001","Città, ""prova""\r\nseconda riga"\r\n')).toEqual([{id:'S001',nota:'Città, "prova"\nseconda riga'}]);
 expect(()=>parseCsv('id,nota\nS001,"non chiuso')).toThrow();
 expect(()=>parseCsv('id,id\n1,2')).toThrow();
});
it('il replay non duplica e gli scarti non si riattivano dopo la reimportazione',()=>{
 const csv=sample(),first=buildRegistry(csv,null,'2026-10-25T12:00:00Z');
 const replay=buildRegistry(csv,first,'2026-10-26T12:00:00Z');expect(replay.records).toEqual(first.records);
 csv.signals=csv.signals.replace('SCARTATO','DA APPROFONDIRE');
 const changed=buildRegistry(csv,replay,'2026-10-26T12:00:00Z');
 expect(changed.records.find(r=>r.kind==='signals')).toMatchObject({state:'REJECTED',history:[expect.any(Object)]});
 expect(registrySummary(changed).activeSignals).toEqual([]);
 expect(registrySummary(changed).draftActions).toEqual(['A001']);
 expect(changed.records.find(r=>r.kind==='actions')!.publishedAt).toBeNull();
});
it('rifiuta ID duplicati, non tratta il momento di importazione come data originale',()=>{
 const csv=sample();const line=csv.signals.split('\n')[1];csv.signals+=line+'\n';
 expect(()=>buildRegistry(csv)).toThrow('ID duplicato');
 const clean=buildRegistry(sample());expect(clean.records.every(r=>r.publishedAt===null)).toBe(true);
});
it('esegue il comando reale su fixture senza sovrascrivere output o sorgenti',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tony-cli-')),input=path.join(root,'input'),output=path.join(root,'output');
 try{
  await mkdir(input);const csv=sample(),names={environments:'ambienti.csv',relationships:'relazioni.csv',actions:'azioni.csv',signals:'segnali.csv'};
  for(const kind of Object.keys(names) as RegistryKind[])await writeFile(path.join(input,names[kind]),csv[kind]);
  const args=['node_modules/tsx/dist/cli.mjs','scripts/tonybook-session.ts','--input='+input,'--output='+output];
  const run=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});expect(run.status,run.stderr).toBe(0);
  expect(JSON.parse(await readFile(path.join(output,'summary.json'),'utf8')).total).toBe(4);
  expect((await readFile(path.join(input,'segnali.csv'),'utf8'))).toBe(csv.signals);
  expect(spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true}).status).not.toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
},15000);
