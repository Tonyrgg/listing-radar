// Isolated local PostgreSQL only. Creates a disposable database, never a remote connection.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const name=`territory_delta_test_${Date.now()}`;
const options={host:'127.0.0.1',port:54322,user:'postgres',password:'postgres',database:'postgres'};
const admin=new pg.Client(options);await admin.connect();
await admin.query(`create database ${name}`);
const db=new pg.Client({...options,database:name});await db.connect();
const workspace='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
const args=[workspace,owner,'live'];
const save=(client,revision,patch)=>client.query('select public.save_territory_workspace_changes($1,$2,$3,$4,$5::jsonb) revision',[...args,revision,JSON.stringify(patch)]);
const snapshot=()=>db.query('select revision,state from public.territory_lab_workspaces where id=$1',[workspace]);
const consistent=async()=>{const r=await db.query(`select count(*)::int n from (
 select collection,record_key,value from public.territory_state_records((select state from public.territory_lab_workspaces where id=$1))
 except select collection,record_key,value from public.territory_workspace_records where workspace_id=$1 and not deleted
 ) diff`,[workspace]);assert.equal(r.rows[0].n,0);const s=await db.query(`select count(*)::int n from (
 select collection,record_key,value from public.territory_workspace_records where workspace_id=$1 and not deleted
 except select collection,record_key,value from public.territory_state_records((select state from public.territory_lab_workspaces where id=$1))
 ) diff`,[workspace]);assert.equal(s.rows[0].n,0);};
try{
 await db.query(`create schema auth;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;set request.jwt.claim.role='service_role';`);
 for(const file of ['0013_territory_lab_sync.sql','0027_territory_incremental_sync.sql','0088_territory_index_single_projection.sql'])await db.query(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const state={version:1,streets:[],runs:[],events:[],history:[],memories:{},units:{},checkpoints:{},virtualCrm:{},virtualPeople:{},cloudMemory:{people:{},properties:{}}};
 for(let i=0;i<6000;i++)state.units['unit-'+i]={id:'unit-'+i,observations:[{id:'observation-'+i,description:'Fixture locale '.repeat(20)}],journal:[]};
 await db.query('select public.save_territory_lab_workspace($1,$2,$3,0,$4::jsonb)',[...args,JSON.stringify(state)]);
 const patch=[{collection:'units',key:'unit-1',value:{...state.units['unit-1'],verified:true}}];
 let start=performance.now();await save(db,1,patch);const beforeMs=performance.now()-start;
 const bulk=Object.entries(state.units).map(([key,value])=>({collection:'units',key,value:{...value,offline:true}}));
 for(let i=0;i<2000;i++)bulk.push({collection:'memories',key:'street-'+i,value:{note:'Offline '+i}});
 for(let i=0;i<2000;i++)bulk.push({collection:'streets',key:'street-'+i,value:{id:'street-'+i,name:'Via test '+i}});
 for(let i=0;i<200;i++)bulk.push({collection:'events',key:'event-'+i,value:{id:'event-'+i,at:'2026-11-12'}});
 await db.query('begin');start=performance.now();await save(db,2,bulk);const bulkBeforeMs=performance.now()-start;await db.query('rollback');
 await db.query(await readFile(new URL('../supabase/migrations/0089_territory_atomic_delta_index.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../supabase/migrations/0091_territory_single_pass_upload.sql',import.meta.url),'utf8'));
 start=performance.now();await save(db,2,[{...patch[0],value:{...patch[0].value,verified:false}}]);const afterMs=performance.now()-start;
 await db.query('begin');start=performance.now();await save(db,3,bulk);const bulkAfterMs=performance.now()-start;await db.query('rollback');
 await consistent();
 assert.equal((await save(db,3,[])).rows[0].revision,'3');
 await save(db,3,[{collection:'units',key:'unit-2',deleted:true,value:null},{collection:'events',key:'new-event',value:{id:'new-event',at:'2026-11-12'}},{collection:'cloud:people',key:'person-1',value:{id:'person-1'}}]);
 await consistent();
 const tombstone=await db.query("select deleted,revision,value from public.territory_workspace_records where workspace_id=$1 and collection='units' and record_key='unit-2'",[workspace]);assert.equal(tombstone.rows[0].deleted,true);assert.equal(tombstone.rows[0].value,null);
 const before=await snapshot();
 await assert.rejects(save(db,3,patch),e=>e.code==='40001');
 await assert.rejects(save(db,4,[{collection:'unknown',key:'bad',value:1}]),e=>e.code==='22023');
 assert.deepEqual((await snapshot()).rows,before.rows);
 // Force a failure after the snapshot write. Its revision and index must roll back together.
 await db.query(`create function public.reject_test_record() returns trigger language plpgsql as $$begin if new.record_key='force-rollback' then raise exception 'test rollback';end if;return new;end$$;create trigger reject_test_record before insert on public.territory_workspace_records for each row execute function public.reject_test_record();`);
 await assert.rejects(save(db,4,[{collection:'units',key:'force-rollback',value:{id:'force-rollback'}}]),/test rollback/);
 assert.deepEqual((await snapshot()).rows,before.rows);await consistent();
 // Legacy full snapshot saves still index all records and create tombstones.
 const full=structuredClone(before.rows[0].state);delete full.units['unit-3'];full.memories.test={note:'Compatibility'};
 await db.query('select public.save_territory_lab_workspace($1,$2,$3,4,$4::jsonb)',[...args,JSON.stringify(full)]);await consistent();
 const other=new pg.Client({...options,database:name});await other.connect();await other.query("set request.jwt.claim.role='service_role'");
 try{const outcomes=await Promise.allSettled([save(db,5,[{collection:'memories',key:'one',value:{note:'A'}}]),save(other,5,[{collection:'memories',key:'two',value:{note:'B'}}])]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);}finally{await other.end();}
 await consistent();
 await db.query(await readFile(new URL('../supabase/migrations/0090_territory_paged_recovery.sql',import.meta.url),'utf8'));
 let cursor=null,total=0,pages=0;
 do{const r=await db.query('select public.read_territory_workspace_changes($1,$2,$3,0,$4::jsonb,6) result',[...args,cursor?JSON.stringify(cursor):null]);const page=r.rows[0].result;assert.equal(page.revision,6);assert.ok(page.changes.length<=100);total+=page.changes.length;cursor=page.next;pages++;}while(cursor);
 assert.ok(total>=6000);assert.ok(pages>60);
 const first=(await db.query('select public.read_territory_workspace_changes($1,$2,$3,0,null,null) result',args)).rows[0].result;
 await save(db,6,[{collection:'meta',key:'version',value:1}]);
 await assert.rejects(db.query('select public.read_territory_workspace_changes($1,$2,$3,0,$4::jsonb,6)',[...args,JSON.stringify(first.next)]),e=>e.code==='40001');
 await db.query(await readFile(new URL('../supabase/migrations/0092_territory_records_authority.sql',import.meta.url),'utf8'));
 const frozen=(await snapshot()).rows[0].state;
 start=performance.now();await save(db,7,bulk);const canonicalBulkMs=performance.now()-start;
 const label=(await db.query('select revision,snapshot_revision,state from public.territory_lab_workspaces where id=$1',[workspace])).rows[0];
 assert.equal(label.revision,'8');assert.equal(label.snapshot_revision,'7');assert.deepEqual(label.state,frozen);
 const indexed=(await db.query("select collection,record_key,value from public.territory_workspace_records where workspace_id=$1 and not deleted",[workspace])).rows;
 const index=new Map(indexed.map(r=>[JSON.stringify([r.collection,r.record_key]),r.value]));
 for(const record of bulk)assert.deepEqual(index.get(JSON.stringify([record.collection,record.key])),record.value);
 await assert.rejects(db.query('select public.save_territory_lab_workspace($1,$2,$3,8,$4::jsonb)',[...args,JSON.stringify(frozen)]),e=>e.code==='40001');
 await assert.rejects(save(db,8,[{collection:'units',key:'force-rollback',value:{id:'force-rollback'}}]),/test rollback/);
 assert.equal((await snapshot()).rows[0].revision,'8');
 await assert.rejects(save(db,7,patch),e=>e.code==='40001');
 await assert.rejects(save(db,null,patch),e=>e.code==='40001');
 await assert.rejects(db.query('select public.save_territory_workspace_changes($1,$2,null,8,$3::jsonb)',[workspace,owner,JSON.stringify(patch)]),e=>e.code==='40001');
 console.log(JSON.stringify({ok:true,syntheticUnits:6000,beforeMs,afterMs,bulkRecords:bulk.length,bulkBeforeMs,bulkAfterMs,canonicalBulkMs,atomicRollback:true,revisionConflict:true,tombstones:true,fullSnapshotCompatibility:true,concurrentWriters:true,pages,total,pagedRevisionGuard:true,canonicalRecords:true,staleSnapshotProtected:true}));
}finally{await db.end();await admin.query(`drop database ${name}`);await admin.end();}

