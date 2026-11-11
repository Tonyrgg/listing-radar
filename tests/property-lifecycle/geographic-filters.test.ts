import {describe,it,expect,vi} from "vitest";
import {readIntelligence} from "@/lib/property-lifecycle/read-models/intelligence";
import type {SupabaseClient} from "@supabase/supabase-js";
function database(){
 const calls:unknown[][]=[];
 const q:Record<string,unknown>={};
 for(const method of ["select","not","neq","or","eq","order","in"]){q[method]=(...args:unknown[])=>{calls.push([method,...args]);return q;};}
 q.range=vi.fn().mockResolvedValue({data:[],error:null});
 return {db:{from:()=>q} as unknown as SupabaseClient,calls};
}
describe("geographic filters before sorting and pagination",()=>{
 it("combines civic, street and coordinates without assuming coordinates are exact",async()=>{
 const {db,calls}=database();await readIntelligence(db,{view:"mercato",page:1,civic:"yes",street:"yes",coordinates:"yes"});
 expect(calls).toContainEqual(["not","street_number","is",null]);expect(calls).toContainEqual(["neq","street_number",""]);
 expect(calls).toContainEqual(["not","street_name","is",null]);expect(calls).toContainEqual(["not","longitude","is",null]);
 expect(calls.some(c=>c[0]==="eq"&&c[1]==="location_precision")).toBe(false);
 });
 it("includes missing and empty civic values and partially missing coordinates",async()=>{
 const {db,calls}=database();await readIntelligence(db,{view:"mercato",page:1,civic:"no",coordinates:"no",locationPrecision:"UNKNOWN"});
 expect(calls).toContainEqual(["or","street_number.is.null,street_number.eq."]);
 expect(calls).toContainEqual(["or","latitude.is.null,longitude.is.null"]);
 expect(calls).toContainEqual(["or","location_precision.is.null,location_precision.eq.UNKNOWN"]);
 });
 it("applies geographical filtering to the full unit-price sort and validates precision values",async()=>{
 const {db,calls}=database();await readIntelligence(db,{view:"mercato",page:1,sort:"metro",street:"yes",locationPrecision:"EXACT_ADDRESS"});
 expect(calls).toContainEqual(["eq","location_precision","EXACT_ADDRESS"]);
 const other=database();await readIntelligence(other.db,{view:"mercato",page:1,locationPrecision:"untrusted"});
 expect(other.calls.some(c=>c[0]==="eq"&&c[1]==="location_precision")).toBe(false);
 });
});
