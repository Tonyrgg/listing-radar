import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({range:vi.fn(),select:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({unstable_cache:(fn:unknown)=>fn}));
vi.mock("@/lib/supabase/service",()=>({getSupabaseServiceClient:()=>({from:()=>({select:(fields:string)=>{mocks.select(fields);return {order:()=>({range:mocks.range})};}})})}));
import {readTerritoryProperties} from "@/lib/property-lifecycle/read-models/territory-server";

describe("territorial map projection",()=>{
 beforeEach(()=>vi.clearAllMocks());
 it("reads beyond the first API page and keeps only map attributes",async()=>{
  const row={property_id:"test",attributes:{floor:0,features:{garden:true},sourcePayload:{large:"unused"}}};
  mocks.range.mockResolvedValueOnce({data:Array.from({length:1000},()=>row),error:null}).mockResolvedValueOnce({data:[{...row,property_id:"last"}],error:null});
  const rows=await readTerritoryProperties();
  expect(rows).toHaveLength(1001);
  expect(rows.at(-1)?.property_id).toBe("last");
  expect(mocks.range.mock.calls).toEqual([[0,999],[1000,1999]]);
  expect(rows[0].attributes).toEqual({floor:0,features:{garden:true}});
  expect(mocks.select.mock.calls[0][0]).not.toContain("*");
 });
 it("rejects incomplete reads instead of presenting a partial archive as complete",async()=>{
  mocks.range.mockResolvedValueOnce({data:Array.from({length:1000},()=>({property_id:"test"})),error:null}).mockResolvedValueOnce({data:null,error:{message:"source unavailable"}});
  await expect(readTerritoryProperties()).rejects.toThrow("source unavailable");
 });
});
