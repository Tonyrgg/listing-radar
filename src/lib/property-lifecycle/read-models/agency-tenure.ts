export function agencyTenureLabel(start:string|null|undefined,end:string|number=Date.now(),active=true,exact=false){
 const from=Date.parse(start??''),until=typeof end==='number'?end:Date.parse(end);
 if(!Number.isFinite(from)||!Number.isFinite(until)||until<from)return 'Durata con questa agenzia non ricostruibile';
 const days=Math.floor((until-from)/86400000);
 return active?`Con questa agenzia da ${exact?'':'almeno '}${days} giorni`:`Periodo documentato con questa agenzia: ${exact?'':'almeno '}${days} giorni`;
}
export function agencyDateSource(source?:string|null){
 if(source==='WAYBACK_VERIFIED_PRESENCE')return 'Annuncio già presente nella cattura storica verificata; la firma dell’incarico non è datata';
 if(source==='MANUAL_CONFIRMATION')return 'Data di ingresso confermata manualmente';
 if(source==='CONFIRMED_ACQUISITION')return 'Data di acquisizione sostenuta da una prova specifica';
 if(source==='FLAZIO_PROPERTY_CREATED_AT')return 'Data di creazione della scheda sul sito di questa agenzia';
 return source?'Data di pubblicazione dell’annuncio associato a questa agenzia':'Nessuna data documentata per questa agenzia';
}
export function currentAgencyAssignment(overrides:Array<{key:string;value:unknown;effectiveAt:string}>){
 const row=overrides.filter(r=>r.key==='current_agency'&&Date.parse(r.effectiveAt)<=Date.now()).sort((a,b)=>Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt))[0];
 const value=row?.value as {role?:string;agencyName?:string;startedAt?:string|null}|undefined;
 return value?.role==='OUR_AGENCY'?value:null;
}
