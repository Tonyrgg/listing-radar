import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
it('serializes workstations and refuses takeover until the interrupted device reconciles',async()=>{
 const db=new PGlite();const w='00000000-0000-0000-0000-000000000001',o='00000000-0000-0000-0000-000000000002',a='00000000-0000-0000-0000-000000000003',b='00000000-0000-0000-0000-000000000004',t='00000000-0000-0000-0000-000000000005',u='00000000-0000-0000-0000-000000000006';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table territory_lab_workspaces(id uuid primary key,owner_id uuid,profile_kind text,revision bigint);insert into territory_lab_workspaces values('${w}','${o}','live',10);set request.jwt.claim.role='service_role';`);
 await db.exec(await readFile('supabase/migrations/0082_worker_operation_lease.sql','utf8'));
 const claim=async(device:string,token:string)=>(await db.query<{v:{acquired:boolean}}>('select acquire_territory_operation($1,$2,$3,$4) v',[w,o,device,token])).rows[0].v;
 expect((await claim(a,t)).acquired).toBe(true);expect((await claim(b,u)).acquired).toBe(false);
 await db.exec("update territory_operation_leases set expires_at=now()-interval '1 second'");
 expect((await claim(b,u)).acquired).toBe(false);expect((await claim(a,u)).acquired).toBe(true);
 const renew=await db.query<{v:boolean}>('select renew_territory_operation($1,$2,$3,$4) v',[w,o,a,t]);expect(renew.rows[0].v).toBe(false);
 const release=async(rev:number)=>(await db.query<{v:boolean}>('select release_territory_operation($1,$2,$3,$4,$5) v',[w,o,a,u,rev])).rows[0].v;
 expect(await release(9)).toBe(false);expect(await release(10)).toBe(true);expect((await claim(b,t)).acquired).toBe(true);
 await db.exec("set request.jwt.claim.role='authenticated'");await expect(claim(a,u)).rejects.toThrow('Worker credentials required');
 }finally{await db.close();}
},30000);
