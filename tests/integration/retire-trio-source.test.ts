import{PGlite}from'@electric-sql/pglite';import{readFile}from'node:fs/promises';import{it,expect}from'vitest';
it('retires Trio and cancels only its pending work while preserving historical properties',async()=>{
 const db=new PGlite();try{
  await db.exec(`create table agencies(id integer primary key,adapter_key text,enabled boolean,settings jsonb);create table lifecycle_jobs(agency_id integer,status text,finished_at timestamptz,last_error jsonb);create table publications(id integer);insert into agencies values(1,'trio',true,'{}'),(2,'studiocasa',true,'{}');insert into lifecycle_jobs(agency_id,status)values(1,'QUEUED'),(1,'RETRY'),(2,'QUEUED');insert into publications values(1);`);
  await db.exec(await readFile('supabase/migrations/0077_retire_trio_source.sql','utf8'));
  expect((await db.query('select enabled from agencies order by id')).rows).toEqual([{enabled:false},{enabled:true}]);
  expect((await db.query('select status from lifecycle_jobs order by agency_id,status')).rows).toEqual([{status:'CANCELLED'},{status:'CANCELLED'},{status:'QUEUED'}]);
  expect((await db.query('select count(*)::int n from publications')).rows).toEqual([{n:1}]);
 }finally{await db.close();}
},15000);
