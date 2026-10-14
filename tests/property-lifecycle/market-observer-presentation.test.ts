import type { SupabaseClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
import { marketAgeLabel,readIntelligence } from "@/lib/property-lifecycle/read-models/intelligence";
import { claimKeyLabel,lifecycleEventLabel } from "@/lib/property-lifecycle/read-models/presentation";

describe("Market Observer dates and filters",()=>{
  it("does not turn a historical sale before monitoring into a zero-day marketing claim",()=>{
    expect(marketAgeLabel("2026-10-14T00:00:00Z",null,"2025-02-12T00:00:00Z")).toBe("Età mercato non ricostruibile");
  });
  it("distinguishes monitoring duration from an earlier source publication date",()=>{
    expect(marketAgeLabel("2026-09-01T00:00:00Z",null,"2026-09-11T00:00:00Z")).toBe("Monitorato da 10 giorni");
    expect(marketAgeLabel("2026-09-01T00:00:00Z","2026-09-01T00:00:00Z","2026-09-11T00:00:00Z")).toBe("Monitorato da 10 giorni");
    expect(marketAgeLabel("2026-09-01T00:00:00Z","2026-08-01T00:00:00Z","2026-09-11T00:00:00Z")).toBe("Sul mercato da almeno 41 giorni");
  });
  it("does not label a publication removal as an exit of the physical property",()=>{
    expect(lifecycleEventLabel("PUBLICATION_REMOVED")).toBe("Pubblicazione non più rilevata");
    expect(claimKeyLabel("publication.soldAt")).toBe("Data di vendita dichiarata dalla fonte");
  });
  it("applies the operational filters in the database and bounds numeric inputs",async()=>{
    const calls:Array<[string,...unknown[]]>=[];const builder:Record<string,unknown>={};
    for(const name of ["select","eq","in","gt","gte","neq","ilike","order","range"]){builder[name]=(...args:unknown[])=>{calls.push([name,...args]);return builder;};}
    builder.then=(resolve:(result:unknown)=>unknown)=>resolve({data:[],error:null});
    const db={from:()=>builder} as unknown as SupabaseClient;
    await readIntelligence(db,{view:"opportunita",page:2,agency:"11111111-1111-4111-8111-111111111111",zone:"Centro%_",locality:"Bitonto",state:"ACTIVE",minimumAge:150,minimumScore:300,minimumReduction:10});
    expect(calls).toContainEqual(["eq","state","ACTIVE"]);
    expect(calls).toContainEqual(["eq","locality","Bitonto"]);
    expect(calls).toContainEqual(["ilike","zone_name","%Centro%"]);
    expect(calls).toContainEqual(["gte","known_market_age",150]);
    expect(calls).toContainEqual(["gte","opportunity_score",100]);
    expect(calls).toContainEqual(["gte","reduction_percent",10]);
    expect(calls).toContainEqual(["range",40,80]);
  });
});
