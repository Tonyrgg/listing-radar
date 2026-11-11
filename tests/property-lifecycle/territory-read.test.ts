import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({range:vi.fn(),select:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({unstable_cache:(fn:unknown)=>fn}));
vi.mock("@/lib/supabase/service",()=>({getSupabaseServiceClient:()=>({from:(view:string)=>({select:(fields:string)=>{mocks.select(view,fields);return {order:()=>({range:(from:number,to:number)=>mocks.range(view,from,to)})};}})})}));
import {readTerritoryProperties} from "@/lib/property-lifecycle/read-models/territory-server";
const propertyView="radar_property_live_archive";
const graphView="market_observer_graph_property_context";
const documentView="market_observer_property_public_record_summary";
describe("territorial map projection",()=>{
 beforeEach(()=>vi.resetAllMocks());
 function fixture(failedView?:string){
  const rows=Array.from({length:1001},(_,i)=>({property_id:"p"+i,attributes:{floor:0,features:{garden:true},sourcePayload:{large:"unused"}}}));
  const datasets:Record<string,unknown[]>={[propertyView]:rows,[graphView]:rows.map(r=>({property_id:r.property_id,building_record_count:1})),[documentView]:[]};
  mocks.range.mockImplementation(async(view:string,from:number,to:number)=>view===failedView?{data:null,error:{message:"source unavailable"}}:{data:datasets[view].slice(from,to+1),error:null});
 }
 it("reads the indexed snapshot in bounded pages without rebuilding any graph",async()=>{
  fixture();
  const rows=await readTerritoryProperties();
  expect(rows).toHaveLength(1001);
  expect(rows.at(-1)?.property_id).toBe("p1000");
  expect(mocks.range).toHaveBeenCalledWith(propertyView,0,999);
  expect(mocks.range).toHaveBeenCalledWith(propertyView,1000,1999);
  expect(mocks.range).toHaveBeenCalledTimes(2);
  expect(rows[0].attributes).toEqual({floor:0,features:{garden:true}});
  expect(mocks.select.mock.calls.every(([view])=>view===propertyView)).toBe(true);
  expect(mocks.select.mock.calls.every(([,fields])=>!fields.includes("*"))).toBe(true);
 });
 it.each([propertyView])("rejects an incomplete %s branch instead of showing a partial map",async(view)=>{
  fixture(view);
  await expect(readTerritoryProperties()).rejects.toThrow("source unavailable");
 });
});
