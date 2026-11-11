import {expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {readFactNews} from "@/lib/property-lifecycle/buildings/facts-read-model";

it("does not load all territorial facts when a dossier has no linked buildings",async()=>{
 const from=vi.fn();
 expect(await readFactNews({from} as unknown as SupabaseClient,Date.now(),[])).toEqual([]);
 expect(from).not.toHaveBeenCalled();
});
it("restricts both facts and market context to the dossier buildings in SQL",async()=>{
 const calls:unknown[][]=[];
 const db={from:(table:string)=>{
  const q:Record<string,unknown>={};
  for(const method of ["select","order","range","in","overlaps"]){q[method]=(...args:unknown[])=>{calls.push([table,method,...args]);return q;};}
  q.then=(resolve:(r:unknown)=>unknown)=>resolve({data:[],error:null});
  return q;
 }} as unknown as SupabaseClient;
 await readFactNews(db,Date.now(),["building-one"]);
 expect(calls).toContainEqual(["market_observer_property_facts","in","building_id",["building-one"]]);
 expect(calls).toContainEqual(["radar_property_read_model","overlaps","context_building_ids",["building-one"]]);
});
