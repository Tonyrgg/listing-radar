import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

it('keeps archive price, agent and canonical street lookup results unchanged with noisy history',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create table evidence_rows(publication_id uuid,source_recorded_at timestamptz,observed_at timestamptz,claim_key text,confidence numeric);
   create table street_registry_streets(id uuid primary key);
   insert into street_registry_streets values('00000000-0000-0000-0000-000000000001');
   insert into evidence_rows select '00000000-0000-0000-0000-000000000001',now(),now(),'status',1 from generate_series(1,2000);
   insert into evidence_rows values
   ('00000000-0000-0000-0000-000000000001','2026-10-01','2026-11-10','publication.askingPrice',.9),
   ('00000000-0000-0000-0000-000000000001','2026-10-01','2026-11-10','publication.askingPrice',.5),
   ('00000000-0000-0000-0000-000000000001',null,'2026-11-10','publication.agentIdentity',1);`);
  const queries=[
   `select * from evidence_rows where publication_id='00000000-0000-0000-0000-000000000001' and claim_key='publication.askingPrice' and confidence>=.85 and source_recorded_at<=observed_at order by source_recorded_at`,
   `select * from evidence_rows where publication_id='00000000-0000-0000-0000-000000000001' and claim_key='publication.agentIdentity' order by observed_at desc`,
   `select r.id from (values('invalid'),('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002')) ref(id) join street_registry_streets r on r.id::text=ref.id`
  ];
  const before=await Promise.all(queries.map(async q=>(await db.query(q)).rows));
  await db.exec(await readFile('supabase/migrations/0064_archive_read_indexes.sql','utf8'));
  for(let i=0;i<queries.length;i++)expect((await db.query(queries[i]!)).rows).toEqual(before[i]);
  expect(before.map(rows=>rows.length)).toEqual([1,1,1]);
  expect((await db.query('select count(*)::int n from evidence_rows')).rows).toEqual([{n:2003}]);
 }finally{await db.close();}
},15000);
