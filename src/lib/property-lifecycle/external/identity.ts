import { decidePropertyIdentity, identityCandidateIncompatibilities, scoreIdentityCandidate,
  type IdentityCandidate, type IdentityDecision, type IdentityObservation } from "@/lib/property-lifecycle/identity/scoring";

const key=(value:string)=>value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");

/** A large portal price mismatch must not create a duplicate with the same explicit reference and full civic address. */
export function decideExternalPropertyIdentity(observation:IdentityObservation,candidates:IdentityCandidate[]):IdentityDecision {
  const decision=decidePropertyIdentity(observation,candidates);
  if(decision.outcome!=="NEW_PROPERTY" || !observation.agencyReference || !observation.address || !/\d/.test(observation.address)) return decision;
  const possible=candidates.filter(candidate=>candidate.address && key(candidate.address)===key(observation.address!) &&
    candidate.knownAgencyReferences.some(ref=>key(ref)===key(observation.agencyReference!)) &&
    identityCandidateIncompatibilities(observation,candidate).every(reason=>reason==="price_hard_conflict"));
  if(possible.length!==1) return decision;
  const scored=scoreIdentityCandidate(observation,possible[0]);
  return {...decision,outcome:"REVIEW_REQUIRED",propertyId:null,score:scored.score,margin:0,
    candidates:[{...scored,rank:1,contradictions:[...new Set([...scored.contradictions,"external_price_mismatch_requires_review"])]}]};
}

export function externalReviewResolution(review: {status:string;details:{agencyId?:string;candidates?:Array<{propertyId:string}>}|null;
  resolution:{decision?:string;candidatePropertyId?:string}|null}|null,agencyId:string) {
  if(review?.status!=="RESOLVED" || review.details?.agencyId!==agencyId) return {propertyId:null,excluded:[] as string[]};
  const resolution=review.resolution;
  const valid=(value:unknown):value is string=>typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if(resolution?.decision==="SAME" && valid(resolution.candidatePropertyId)) return {propertyId:resolution.candidatePropertyId,excluded:[] as string[]};
  return {propertyId:null,excluded:resolution?.decision==="DIFFERENT" ?
    (valid(resolution.candidatePropertyId) ? [resolution.candidatePropertyId] : (review.details.candidates ?? []).map(c=>c.propertyId).filter(valid)) : []};
}
