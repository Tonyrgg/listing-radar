import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),select:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({unstable_cache:(fn:unknown)=>fn}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseServiceClient:()=>({from:(view:string)=>({select:(fields:string)=>{mocks.select(view,fields);return {order:()=>({range:(from:number,to:number)=>mocks.read(view,from,to)})};}})})}));
import {readTerritoryProperties} from '@/lib/property-lifecycle/read-models/territory-server';

describe('territorial map projection',()=>{
 const properties=Array.from({length:65},(_,n)=>({property_id:String(n),attributes:{floor:0,features:{garden:true},sourcePayload:{large:'unused'}}}));
 const graph=properties.map(p=>({property_id:p.property_id,building_record_count:3,specific_record_count:0,recent_street_count:2}));
 const docs=[{property_id:'0',public_record_count:4,latest_public_record_type:'SCIA',latest_public_record_date:'2026-11-10'}];
 const rowsFor=(view:string)=>view==='market_observer_property_archive'?properties:view==='market_observer_graph_property_context'?graph:docs;
 beforeEach(()=>{vi.clearAllMocks();mocks.read.mockImplementation(async(view:string,from:number,to:number)=>({data:rowsFor(view).slice(from,to+1),error:null}));});
 it('paginates properties separately from graph aggregates and retains exact context and zero-valued attributes',async()=>{
  const rows=await readTerritoryProperties();
  expect(rows).toHaveLength(65);
  expect(rows.at(-1)?.property_id).toBe('64');
  expect(mocks.read.mock.calls.filter(c=>c[0]==='market_observer_property_archive').map(c=>c.slice(1))).toEqual([[0,63],[64,127]]);
  expect(mocks.read.mock.calls.filter(c=>c[0]==='market_observer_graph_property_context')).toHaveLength(1);
  expect(rows[0]).toMatchObject({public_record_count:4,building_record_count:3,recent_street_count:2,latest_public_record_type:'SCIA',attributes:{floor:0,features:{garden:true}}});
  expect(rows[0].attributes).not.toHaveProperty('sourcePayload');
  expect(rows[1]).toMatchObject({public_record_count:0,latest_public_record_type:null,latest_public_record_date:null});
  expect(mocks.select.mock.calls.every(c=>!c[1].includes('*'))).toBe(true);
 });
 it.each(['market_observer_property_archive','market_observer_graph_property_context','market_observer_property_public_record_summary'])('rejects incomplete %s instead of caching a partial archive',async view=>{
  mocks.read.mockImplementation(async(v:string,from:number,to:number)=>v===view?{data:null,error:{message:'source unavailable'}}:{data:rowsFor(v).slice(from,to+1),error:null});
  await expect(readTerritoryProperties()).rejects.toThrow('source unavailable');
 });
 it('rejects a truncated later property page',async()=>{
  mocks.read.mockImplementation(async(v:string,from:number,to:number)=>v==='market_observer_property_archive'&&from>0?{data:null,error:{message:'later page failed'}}:{data:rowsFor(v).slice(from,to+1),error:null});
  await expect(readTerritoryProperties()).rejects.toThrow('later page failed');
 });
 it('does not invent a zero context if the archive changed during the separate reads',async()=>{
  mocks.read.mockImplementation(async(v:string,from:number,to:number)=>({data:(v==='market_observer_graph_property_context'?graph.slice(1):rowsFor(v)).slice(from,to+1),error:null}));
  await expect(readTerritoryProperties()).rejects.toThrow('context changed');
 });
});
