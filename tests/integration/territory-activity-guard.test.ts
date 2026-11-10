import {PGlite}from'@electric-sql/pglite';
import {readFile}from'node:fs/promises';
import path from'node:path';
import {it,expect}from'vitest';
const workspace='fd2503de-cf17-4ed5-bac1-65a5c6d269ce',owner='be0e3d14-4b90-41b9-83b5-43a683fc2523';
const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
it('coordinates customer/day claims across workstations, retains uncertain writes and returns only verified proof',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create function auth.uid()returns uuid language sql stable as $$select(current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
   create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'role'$$;
   set request.jwt.claims='{"sub":"${owner}","role":"service_role"}';`);
  await db.exec(await readFile(path.resolve('supabase/migrations/0013_territory_lab_sync.sql'),'utf8'));
  await db.exec(await readFile(path.resolve('supabase/migrations/0063_territory_activity_write_guard.sql'),'utf8'));
  await db.query(`insert into public.territory_lab_workspaces(id,owner_id,profile_kind,revision,state)values($1,$2,'live',1,'{"version":1}')`,[workspace,owner]);
  const today=(await db.query<{activity_day:string}>(`select (now()at time zone'Europe/Rome')::date::text as activity_day`)).rows[0]!.activity_day;
  async function guard(action:string,operation=first,key='a'.repeat(64),proof:unknown=null,day=today,workspaceOwner=owner){
   const result=await db.query<{value:{granted:boolean;submitted:boolean;proof:Record<string,unknown>|null}}>('select public.territory_activity_write_guard($1::uuid,$2::uuid,$3::text,$4::date,$5::uuid,$6::text,$7::jsonb) value',[workspace,workspaceOwner,key,day,operation,action,proof===null?null:JSON.stringify(proof)]);
   return result.rows[0]!.value;
  }
  expect(await guard('reserve')).toMatchObject({granted:true,submitted:false,proof:null});
  expect(await guard('reserve',second)).toMatchObject({granted:false,submitted:false});
  expect(await guard('reserve')).toMatchObject({granted:true,submitted:false});
  await guard('submitted');await guard('release');
  expect(await guard('reserve',second)).toMatchObject({granted:false,submitted:true,proof:null});
  const proof={id:'00T000000000001AAA',propertyId:'a0V000000000001AAA',clientId:'001000000000001AAA',status:'Da eseguire',activityDate:null,createdAt:today,description:'Non conservare queste note nel controllo'};
  await guard('confirm',first,'a'.repeat(64),proof);
  const covered=await guard('reserve',second);
  expect(covered).toMatchObject({granted:false,submitted:true,proof:{id:proof.id,createdAt:today,description:''}});
  expect(JSON.stringify(covered)).not.toContain('Non conservare');
  expect(await guard('reserve',first,'b'.repeat(64))).toMatchObject({granted:true});
  await guard('release',first,'b'.repeat(64));
  expect(await guard('reserve',second,'b'.repeat(64))).toMatchObject({granted:true,submitted:false});
  await expect(guard('submitted',second,'b'.repeat(64),null,'2026-01-01')).rejects.toThrow('day changed');
  await expect(guard('confirm',second,'b'.repeat(64),{...proof,id:'not-a-task'})).rejects.toThrow('Invalid Task proof');
  await expect(guard('reserve',first,'c'.repeat(64),null,today,second)).rejects.toThrow('Workspace mismatch');
  await db.exec(`set request.jwt.claims='{"sub":"${second}","role":"authenticated"}';`);
  await expect(guard('reserve',first,'c'.repeat(64))).rejects.toThrow('Owner mismatch');
 }finally{await db.close();}
},30000);
