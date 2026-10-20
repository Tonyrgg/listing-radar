/** Conservative policy: candidate review only; never merges buildings or properties. */
export const BUILDING_IDENTITY_VERSION='building_identity_v1';
export type StreetOverride={inputHash:string;decision:string;streetId:string|null};
export function applyStreetOverrides<T extends {inputHash:string;references:Array<{streetId:string|null}>;buildingIds:string[];candidateBuildingIds:string[]}>(r:T,overrides:Record<string,StreetOverride>){
 for(const [index,decision] of Object.entries(overrides)){
  const ref=r.references[Number(index)];if(!ref||decision.inputHash!==r.inputHash)continue;
  ref.streetId=decision.decision==='SAME_STREET'?decision.streetId:null;
  r.buildingIds=[];r.candidateBuildingIds=[]; // Human street choice is never proof of building or unit.
 }
 return r;
}
export function buildingIdentity(input:{sameUniqueStreet:boolean;exactCivic:boolean;compatibleLocality:boolean;coordinateConflict:boolean;cadastralConflict:boolean;independentCorroboration:boolean}){
 if(input.coordinateConflict||input.cadastralConflict||!input.compatibleLocality)return {version:BUILDING_IDENTITY_VERSION,classification:'DIFFERENT',mergeAllowed:false,reason:'contradictory_evidence'};
 const exact=input.sameUniqueStreet&&input.exactCivic;
 return {version:BUILDING_IDENTITY_VERSION,classification:exact?(input.independentCorroboration?'AUTO_SAME_BUILDING':'PROBABLE_SAME_BUILDING'):'REVIEW_REQUIRED',mergeAllowed:false,reason:exact?'same_street_civic_requires_preservation_plan':'insufficient_identity'};
}
export function streetAmbiguityOutcome(candidateIds:string[],independentId:string|null=null){
 const ids=[...new Set(candidateIds)];
 if(ids.length===1)return {classification:'AUTO_RESOLVED_HIGH',streetId:ids[0],reason:'unique_official_street'};
 if(independentId&&ids.includes(independentId))return {classification:'PROBABLE',streetId:null,reason:'independent_reference_needs_review'};
 return {classification:ids.length?'REVIEW_REQUIRED':'UNRESOLVABLE',streetId:null,reason:ids.length?'official_codes_indistinguishable':'no_official_candidate'};
}
