import {describe,it,expect,vi} from "vitest";
import {readIntelligence} from "@/lib/property-lifecycle/read-models/intelligence";
import {intelligenceSort,compareUnitPrices} from "@/lib/property-lifecycle/read-models/intelligence-sorting";
import {dossierContext,dossierReturn} from "@/lib/property-lifecycle/read-models/dossier-context";
import type {SupabaseClient} from "@supabase/supabase-js";
describe("archive sorting and dossier context",()=>{
 it("orders unit prices in the indexed database before requesting a single page",async()=>{
  const order=vi.fn().mockReturnThis(),range=vi.fn().mockResolvedValue({data:Array.from({length:41},(_,i)=>({property_id:'p'+i})),error:null});
  const from=vi.fn(()=>({select:()=>({order,range})}));
  const result=await readIntelligence({from} as unknown as SupabaseClient,{view:'mercato',page:2,sort:'metro',direction:'desc'});
  expect(from).toHaveBeenCalledWith('radar_property_live_archive');
  expect(order).toHaveBeenCalledWith('unit_asking_price',{ascending:false,nullsFirst:false});
  expect(range).toHaveBeenCalledExactlyOnceWith(40,80);
  expect(result.rows).toHaveLength(40);expect(result.hasNext).toBe(true);
 });
 it("keeps unknown unit prices last in either direction and handles zero asking prices",()=>{
  const rows=[{row_id:"unknown",latest_asking_price:100,surface_sqm:0},{row_id:"zero",latest_asking_price:0,surface_sqm:100},{row_id:"priced",latest_asking_price:100,surface_sqm:100}];
  expect([...rows].sort((a,b)=>compareUnitPrices(a,b,true)).map(r=>r.row_id)).toEqual(["zero","priced","unknown"]);
  expect([...rows].sort((a,b)=>compareUnitPrices(a,b,false)).map(r=>r.row_id)).toEqual(["priced","zero","unknown"]);
 });
 it("only accepts known sort keys",()=>{
  expect(intelligenceSort('giorni_agenzia','desc','opportunita')).toMatchObject({field:'days_with_agency',ascending:false});
  expect(intelligenceSort("anything","asc","mercato")).toMatchObject({key:"riscontro",field:"last_seen_at",ascending:true});
  expect(intelligenceSort(undefined,undefined,"opportunita")).toMatchObject({key:"indice",ascending:false});
 });
 it("keeps navigation context distinct from the sale classification",()=>{
  const context=dossierContext("opportunita","ACTIVE","UNKNOWN");
  expect(dossierContext("opportunita","SOLD_CONFIRMED","SOLD_CONFIRMED").view).toBe("venduti");
  expect(context.view).toBe("opportunita");expect(context.confirmed).toBe(false);
  expect(dossierContext("venduti","SOLD_PROBABLE","UNKNOWN")).toMatchObject({probable:true,confirmed:false,tone:"uncertain"});
  expect(dossierContext("venduti","SOLD_CONFIRMED","NOT_SOLD_CONFIRMED")).toMatchObject({confirmed:false,outcome:"Non venduto, confermato manualmente"});
 });
 it("preserves safe filtered return URLs and rejects external or malformed destinations",()=>{
  expect(dossierReturn("/intelligence?vista=opportunita&ordine=prezzo","opportunita")).toContain("ordine=prezzo");
  for(const url of ["https://example.org","//example.org","/intelligence/../settings","/intelligence?x=\\evil"])expect(dossierReturn(url,"usciti")).toBe("/intelligence?vista=usciti");
 });
});
