import { describe, expect, it } from "vitest";
import { isDedicatedSoldGraphicUrl } from "@/lib/property-lifecycle/lifecycle/status-evidence";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import { emptyHealthBaseline, evaluateHealthBaseline } from "@/lib/property-lifecycle/health/baseline";
import { decidePropertyIdentity, type IdentityCandidate, type IdentityObservation } from "@/lib/property-lifecycle/identity/scoring";

describe("Market Observer evidence boundaries",()=>{
  it("recognizes dedicated graphics without interpreting street names or generic sales pages as sold",()=>{
    expect(isDedicatedSoldGraphicUrl("https://agency.test/gallery/Venduto.jpg")).toBe(true);
    expect(isDedicatedSoldGraphicUrl("https://agency.test/gallery/sold-banner.png")).toBe(true);
    expect(isDedicatedSoldGraphicUrl("https://agency.test/gallery/via-soldati-8.jpg")).toBe(false);
    expect(isDedicatedSoldGraphicUrl("https://agency.test/gallery/vendita-appartamento.jpg")).toBe(false);
  });
  it("allows future monitored municipalities without changing the current Bitonto scope",()=>{
    expect(resolveMonitoredGeography({municipality:"Bari"}).scope).toBe("OUT_OF_SCOPE");
    const other=resolveMonitoredGeography({municipality:"Example City"},{municipality:"Example City",localities:["Example City"],outOfScopePlaces:[],postalCodes:[]});
    expect(other).toMatchObject({scope:"IN_SCOPE",municipality:"Example City",locality:"Example City"});
  });
  it("keeps suspicious count collapses frozen and only rewarms a corroborated complete inventory",()=>{
    const baseline={...emptyHealthBaseline(),schemaFingerprint:"schema",recentInventoryCounts:[100,100,100],rollingMedian:100,consecutiveHealthyRuns:3};
    const input={baseline,sourceState:"HEALTHY" as const,sourceComplete:true,observedCount:50,structureFingerprint:"schema"};
    expect(evaluateHealthBaseline(input)).toMatchObject({effectiveState:"DEGRADED",absenceEvaluationAllowed:false});
    expect(evaluateHealthBaseline({...input,corroboratedLowerInventory:true})).toMatchObject({effectiveState:"HEALTHY",absenceEvaluationAllowed:false,next:{rollingMedian:50,consecutiveHealthyRuns:1}});
    expect(evaluateHealthBaseline({...input,sourceState:"FAILED",corroboratedLowerInventory:true})).toMatchObject({effectiveState:"FAILED",absenceEvaluationAllowed:false});
  });
  it("does not auto-merge distant precise locations or treat approximate map pins as identity proof",()=>{
    const observation:IdentityObservation={agencyReference:null,address:"Via Test 10",locality:"Bitonto",propertyType:"Appartamento",surfaceSqm:90,rooms:3,
      latitude:41.1,longitude:16.6,coordinatesExact:true,imageFingerprints:["same"],floorplanFingerprints:[]};
    const candidate:IdentityCandidate={...observation,latitude:41.2,propertyId:"candidate",knownAgencyReferences:[]};
    expect(decidePropertyIdentity(observation,[candidate]).outcome).toBe("NEW_PROPERTY");
    const approximate={...observation,coordinatesExact:false,imageFingerprints:[]};
    expect(decidePropertyIdentity(approximate,[{...candidate,coordinatesExact:false,imageFingerprints:[]}]).outcome).not.toBe("AUTO_MATCH");
  });
});
