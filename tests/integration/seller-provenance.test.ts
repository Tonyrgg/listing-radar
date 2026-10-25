import {it,expect} from 'vitest';
import {sellerDb,inbound,login,other} from '../helpers/seller-db';
import {sourceReferenceSchema} from '@/lib/seller-intake/provenance';
const ref={module:'RADAR',sourceType:'public_news',sourceId:'news:fixture',sourceUrl:'https://example.test/proof',observedAt:'2026-10-25T10:00:00Z',publishedAt:null,evidenceSignature:'a'.repeat(64)};
it('conserva fonte e collegamento esplicito con RLS, replay e prova originale ignota',async()=>{
 const db=await sellerDb(['0047_seller_provenance.sql']);
 try {
  const id=await inbound(db);
  const property='30000000-0000-4000-8000-000000000003';await db.query('insert into properties values($1)',[property]);
  await login(db);
  const attach=async(v=ref)=>(await db.query<{id:string}>('select attach_seller_case_source($1,$2::jsonb) id',[id,JSON.stringify(v)])).rows[0].id;
  const source=await attach();expect(await attach()).toBe(source);
  await expect(attach({...ref,evidenceSignature:'b'.repeat(64)})).rejects.toMatchObject({code:'40001'});
  expect((await db.query<{reference:typeof ref}>('select reference from seller_case_sources')).rows[0].reference.publishedAt).toBeNull();
  await expect(db.query('update seller_case_sources set reference=$1',[JSON.stringify(ref)])).rejects.toThrow();
  const link=async()=>(await db.query<{id:string}>('select link_seller_case_property($1,$2,$3) id',[id,property,'Collegamento esplicitamente selezionato'])).rows[0].id;
  expect(await link()).toBe(await link());
  await login(db,other);expect((await db.query('select * from seller_case_sources')).rows).toHaveLength(0);
  await expect(attach()).rejects.toMatchObject({code:'42501'});
  await db.exec('reset role');
  for(const invalid of [{...ref,module:null},{...ref,sourceUrl:'javascript:bad'},{...ref,observedAt:'unknown'},{...ref,module:'VAB'}])
   expect((await db.query<{valid:boolean}>('select valid_seller_reference($1::jsonb) valid',[JSON.stringify(invalid)])).rows[0].valid).toBe(false);
  expect(sourceReferenceSchema.parse(ref).publishedAt).toBeNull();
  expect(()=>sourceReferenceSchema.parse({...ref,module:'VAB'})).toThrow();
 }finally{await db.close();}
},30000);
it('misura appuntamento fissato e svolto senza inventare passaggi o attribuzioni',async()=>{
 const db=await sellerDb(['0048_seller_outcomes.sql']);
 try{
  const a=await inbound(db,'a','meta_form','campaign-A'),b=await inbound(db,'b','local_test');
  await login(db);
  const review=(id:string,rev:number,status:string)=>db.query('select review_seller_case($1,$2,$3,$4,$5,$6)',[id,rev,status,status==='MANDATE'?'NONE':'FOLLOW_UP',status==='MANDATE'?null:'2026-10-26T10:00:00Z','Esito sintetico esplicito']);
  await review(a,0,'APPOINTMENT');await review(a,1,'APPOINTMENT_HELD');await review(a,2,'APPOINTMENT_HELD');await review(b,0,'MANDATE');
  const m=(await db.query<{m:Record<string,unknown>}>('select seller_workbench_metrics() m')).rows[0].m;
  expect(m).toMatchObject({received:2,contacted:0,appointments:1,appointmentsHeld:1,valuations:0,mandates:1});
  expect(m.bySource).toEqual(expect.arrayContaining([expect.objectContaining({source:'meta_form',campaignId:'campaign-A',appointmentsHeld:1}),expect.objectContaining({source:'local_test',campaignId:null,mandates:1})]));
  await login(db,other);expect((await db.query<{m:{received:number}}>('select seller_workbench_metrics() m')).rows[0].m.received).toBe(0);
 }finally{await db.close();}
},30000);
