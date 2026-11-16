import {describe,it,expect} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readSavedSnapshots} from '@/lib/property-lifecycle/read-models/saved-snapshots';
describe('saved publication snapshots',()=>{
 it('reads the last successful payload of a removed publication without fetching its website',async()=>{
  const tables:string[]=[];const filters:string[]=[];
  const db={from:(name:string)=>{tables.push(name);const value=name==='agency_listings'?[{id:'agency-listing'}]:name==='publications'?[{id:'publication',state:'REMOVED',canonical_url:'https://example.org/removed'}]:{id:'snapshot',normalized_payload:{commercial:{description:'Retained description',features:{adMaioraCrossCheck:{conflicts:[]}}}}};const q:Record<string,unknown>={};for(const method of ['select','eq','in','order','limit','maybeSingle'])q[method]=(...args:unknown[])=>{filters.push(method+':'+String(args[0]));return q;};q.then=(resolve:(x:unknown)=>unknown)=>Promise.resolve(resolve({data:value,error:null}));return q;}} as unknown as SupabaseClient;
  const rows=await readSavedSnapshots(db,'property');expect(rows[0]?.state).toBe('REMOVED');expect(rows[0]?.snapshot?.normalized_payload.commercial.description).toBe('Retained description');expect(tables).toEqual(['agency_listings','publications','snapshots']);expect(filters).toContain('eq:publication_id');
 });
 it('does not pretend missing history is a successful empty read',async()=>{
  const q={select:()=>q,eq:()=>q,then:(resolve:(x:unknown)=>unknown)=>Promise.resolve(resolve({data:null,error:{message:'timeout'}}))};
  await expect(readSavedSnapshots({from:()=>q} as unknown as SupabaseClient,'property')).rejects.toThrow('non disponibile');
 });
});
