import {describe,it,expect,vi} from "vitest";
import {readIntelligence,type IntelligenceRow} from "@/lib/property-lifecycle/read-models/intelligence";
import {intelligenceSort,compareUnitPrices} from "@/lib/property-lifecycle/read-models/intelligence-sorting";
import {dossierContext,dossierReturn} from "@/lib/property-lifecycle/read-models/dossier-context";
import type {SupabaseClient} from "@supabase/supabase-js";
describe("archive sorting and dossier context",()=>{
 it("sorts unit prices across all filtered pages before selecting forty results",async()=>{
  const rows=Array.from({length:501},(_,i)=>({row_id:"r"+String(i).padStart(3,"0"),property_id:"p"+i,latest_asking_price:(i+1)*1000,surface_sqm:100})) as IntelligenceRow[];
  const ranges:number[][]=[];
  const db={from:()=>{let fields="";const q={select:(v:string)=>{fields=v;return q},order:()=>q,range:async(a:number,b:number)=>{ranges.push([a,b]);return {data:rows.slice(a,b+1).map(r=>fields==="*"?r:{row_id:r.row_id,latest_asking_price:r.latest_asking_price,surface_sqm:r.surface_sqm}),error:null}},in:async(_key:string,ids:string[])=>({data:rows.filter(r=>ids.includes(r.row_id)).reverse(),error:null})};return q}} as unknown as SupabaseClient;
  const result=await readIntelligence(db,{view:"mercato",page:1,sort:"metro",direction:"desc"});
  expect(ranges).toEqual([[0,499],[500,999]]);
  expect(result.rows).toHaveLength(40);expect(result.rows[0].property_id).toBe("p500");expect(result.rows[39].property_id).toBe("p461");expect(result.hasNext).toBe(true);
 });
 it("keeps unknown unit prices last in either direction and handles zero asking prices",()=>{
  const rows=[{row_id:"unknown",latest_asking_price:100,surface_sqm:0},{row_id:"zero",latest_asking_price:0,surface_sqm:100},{row_id:"priced",latest_asking_price:100,surface_sqm:100}];
  expect([...rows].sort((a,b)=>compareUnitPrices(a,b,true)).map(r=>r.row_id)).toEqual(["zero","priced","unknown"]);
  expect([...rows].sort((a,b)=>compareUnitPrices(a,b,false)).map(r=>r.row_id)).toEqual(["priced","zero","unknown"]);
 });
 it("only accepts known sort keys",()=>{
  expect(intelligenceSort("anything","asc","mercato")).toMatchObject({key:"riscontro",field:"last_seen_at",ascending:true});
  expect(intelligenceSort(undefined,undefined,"opportunita")).toMatchObject({key:"indice",ascending:false});
 });
 it("keeps navigation context distinct from the sale classification",()=>{
  const context=dossierContext("opportunita","ACTIVE","UNKNOWN");
  expect(context.view).toBe("opportunita");expect(context.confirmed).toBe(false);
  expect(dossierContext("venduti","SOLD_PROBABLE","UNKNOWN")).toMatchObject({probable:true,confirmed:false,tone:"uncertain"});
  expect(dossierContext("venduti","SOLD_CONFIRMED","NOT_SOLD_CONFIRMED")).toMatchObject({confirmed:false,outcome:"Non venduto, confermato manualmente"});
 });
 it("preserves safe filtered return URLs and rejects external or malformed destinations",()=>{
  expect(dossierReturn("/intelligence?vista=opportunita&ordine=prezzo","opportunita")).toContain("ordine=prezzo");
  for(const url of ["https://example.org","//example.org","/intelligence/../settings","/intelligence?x=\\evil"])expect(dossierReturn(url,"usciti")).toBe("/intelligence?vista=usciti");
 });
});
