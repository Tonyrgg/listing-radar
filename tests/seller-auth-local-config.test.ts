import {it,expect} from 'vitest';
import {isolatedConfig,PROJECT,localMigration,LOCAL_MIGRATION_EXCEPTIONS} from '../scripts/check-seller-auth-local.mjs';
import {readFile} from 'node:fs/promises';
it('isola progetto e porte e disattiva seed e servizi non necessari',()=>{
 const result=isolatedConfig('project_id = "listing-radar"\n[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[db.seed]\nenabled = true\n[auth]\nsite_url = "http://127.0.0.1:3000"\n[studio]\nenabled = true');
 expect(result).toContain(PROJECT);expect(result).toContain('port = 55421');expect(result).not.toContain('5432');expect(result).toContain('enabled = false');
 expect(result).toContain('127.0.0.1:3149');
});
it('conserva Storage necessario alle migrazioni iniziali e disabilita soltanto i servizi opzionali',()=>{
 const result=isolatedConfig('project_id = "listing-radar"\n[api]\nport = 54321\n[db]\nport = 54322\n[storage]\nenabled = true\n[storage.s3_protocol]\nenabled = true\n[db.seed]\nenabled = true');
 expect(result).toContain('[storage]\nenabled = true');
 expect(result).toContain('[storage.s3_protocol]\nenabled = false');
 expect(result).toContain('[db.seed]\nenabled = false');
});
it('non fabbrica prove per il rollout storico e non elude modifiche di schema',async()=>{
 const name='0030_remax_verified_projection_rollout.sql',sql=await readFile('supabase/migrations/'+name,'utf8');
 expect(LOCAL_MIGRATION_EXCEPTIONS.map(item=>item.file)).toEqual([name]);
 expect(localMigration(name,sql)).toContain('enabled=false,projections_enabled=false,missing_enabled=false');
 expect(localMigration(name,sql)).not.toMatch(/insert\s+into|HEALTHY/i);
 expect(()=>localMigration(name,sql+'\ncreate table changed(id int);')).toThrow('LOCAL_ROLLOUT_EXCEPTION_CHANGED');
 const schema=await readFile('supabase/migrations/0051_property_fact_transitions_v2.sql','utf8');
 expect(localMigration('0051_property_fact_transitions_v2.sql',schema)).toBe(schema);
});
