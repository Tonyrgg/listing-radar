export function agencyTenureLabel(firstSeen:string,end:string|number=Date.now(),active=true){
 const from=Date.parse(firstSeen),until=typeof end==='number'?end:Date.parse(end);
 if(!Number.isFinite(from)||!Number.isFinite(until)||until<from)return 'Durata con questa agenzia non ricostruibile';
 const days=Math.floor((until-from)/86400000);
 return active?`Osservata con questa agenzia da almeno ${days} giorni`:`Presenza osservata con questa agenzia: ${days} giorni`;
}
export function currentAgencyAssignment(overrides:Array<{key:string;value:unknown;effectiveAt:string}>){
 const row=overrides.filter(r=>r.key==='current_agency'&&Date.parse(r.effectiveAt)<=Date.now()).sort((a,b)=>Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt))[0];
 const value=row?.value as {role?:string;agencyName?:string;startedAt?:string|null}|undefined;
 return value?.role==='OUR_AGENCY'?value:null;
}
