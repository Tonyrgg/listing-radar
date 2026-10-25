import {describe,it,expect} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {deliveryStatusLabel} from '@/lib/seller-intake/delivery-status';
import {readSellerCases,casePageNumber} from '@/lib/seller-intake/repository';
function client(rows:Array<{id:string;owner_id:string;status:string;next_action_at:string|null}>,fail=false) {
 const calls:Array<unknown>=[];
 return {calls,db:{from:()=> {
  let owner='',closed=false,start=0,end=0;
  const q={
   select:()=>q,eq:(_key:string,v:string)=>{owner=v;return q;},
   order:(key:string,options:unknown)=>{calls.push([key,options]);return q;},
   range:(a:number,b:number)=>{start=a;end=b;return q;},
   in:()=>{closed=true;return q;},not:()=>q,
   then:(resolve:(value:unknown)=>void)=> {
    const visible=rows.filter(r=>r.owner_id===owner&&(['CLOSED','MANDATE','DO_NOT_CONTACT'].includes(r.status)===closed))
      .sort((a,b)=>(a.next_action_at??'z').localeCompare(b.next_action_at??'z')||a.id.localeCompare(b.id));
    return Promise.resolve(resolve({data:visible.slice(start,end+1),count:visible.length,error:fail?{}:null}));
   }
  };return q;
 }} as unknown as SupabaseClient};
}
describe('consegne e paginazione richieste',()=>{
 it('non dichiara inviata una consegna ignota, fallita o in attesa',()=>{
  for(const status of ['FAILED','PENDING','CLAIMED','RETRY','unknown','toString'])expect(deliveryStatusLabel(status)).not.toMatch(/inviata/);
  expect(deliveryStatusLabel('SENT')).toMatch(/confermata/);
 });
 it('attraversa oltre cento pratiche con ordine deterministico e isolamento owner',async()=>{
  const rows=Array.from({length:241},(_,i)=>({id:String(i).padStart(4,'0'),owner_id:i===240?'other':'owner',status:'NEW',next_action_at:i>219?null:'2026-10-25'}));
  const {db,calls}=client(rows.reverse()),seen:string[]=[];
  for(let page=1;page<=5;page++){const r=await readSellerCases(db,'owner',false,page);seen.push(...r.items.map(v=>v.id));expect(r.total).toBe(240);expect(r.hasNext).toBe(page<5);}
  expect(new Set(seen).size).toBe(240);expect(seen).toEqual([...seen].sort());
  expect(calls).toContainEqual(['id',{ascending:true}]);
 });
 it('gestisce pagine fuori intervallo, filtri chiuse e guasti senza coda vuota presunta',async()=>{
  const rows=[{id:'a',owner_id:'o',status:'CLOSED',next_action_at:null}];
  const {db}=client(rows);
  expect((await readSellerCases(db,'o',true,999)).page).toBe(1);
  expect((await readSellerCases(db,'o',false)).items).toEqual([]);
  await expect(readSellerCases(client(rows,true).db,'o')).rejects.toThrow('Coda non disponibile');
  for(const v of ['bad',-1,Infinity,'1.5',null])expect(casePageNumber(v)).toBe(1);
 });
});
