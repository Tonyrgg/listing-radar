import {it,expect} from 'vitest';
import {sellerDb,login,other} from '../helpers/seller-db';
import {normalizeTonySignal} from '@/lib/tonybook/signals';
const payload={id:'S007',state:'ACTIVE',fact:'Terreno sintetico dichiarato disponibile',unknowns:'Ruolo e data originale non verificati',reference:{module:'TONYBOOK',sourceType:'local_registry',sourceId:'S007',sourceUrl:'https://example.test/item',observedAt:'2026-10-24',publishedAt:null,evidenceSignature:'a'.repeat(64)}};
it('pianifica soltanto una selezione corrente esplicita, con RLS e replay senza riapertura',async()=>{
 const db=await sellerDb(['0047_seller_provenance.sql','0049_tonybook_verifications.sql']);
 try{
  await login(db);
  const register=async(v=payload)=>{const s=normalizeTonySignal(v);await db.query('select register_tonybook_signal($1,$2,$3::jsonb,$4,$5,$6)',[s.id,s.state,JSON.stringify(s.reference),s.fact,s.unknowns,s.signature]);return s;};
  const initial=await register();expect((await db.query('select * from seller_cases')).rows).toHaveLength(0);
  const plan=async(signature=initial.signature,confirmed=true)=>(await db.query<{id:string}>('select plan_tonybook_verification($1,$2,$3) id',[initial.id,signature,confirmed])).rows[0].id;
  await expect(plan(initial.signature,false)).rejects.toThrow();
  const id=await plan();expect(await plan()).toBe(id);
  expect((await db.query('select * from seller_delivery_outbox')).rows).toHaveLength(0);
  await expect(db.query("select review_seller_case($1,0,'TO_CALL','CALL',now(),'Non autorizzato')",[id])).rejects.toThrow();
  await db.query("select review_seller_case($1,0,'CLOSED','NONE',null,'Verifica sintetica chiusa')",[id]);
  expect(await plan()).toBe(id);expect((await db.query<{status:string}>('select status from seller_cases where id=$1',[id])).rows[0].status).toBe('CLOSED');
  const changed=await register({...payload,fact:'Nuova prova sintetica da rivedere'});
  await expect(plan()).rejects.toMatchObject({code:'40001'});
  expect(await plan(changed.signature)).not.toBe(id);
  await register({...payload,state:'REJECTED'});
  await expect(plan()).rejects.toThrow();
  await expect(register()).rejects.toThrow('Rejected signal');
  await login(db,other);expect((await db.query('select * from tonybook_signals')).rows).toHaveLength(0);
  await expect(plan()).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);
