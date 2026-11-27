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

const agencyVerification: Record<string,string> = {
 "ad-maiora-bitonto":"Incrocia la scheda WordPress con la pubblicazione della stessa agenzia sul portale. Per il civico confronta indirizzo, riferimento e caratteristiche.",
 "futura-immobiliare-bitonto":"Confronta il pin del dettaglio Agesta con la via dichiarata. Per la data cerca la pubblicazione dell’articolo.",
 "vistocasa-bitonto":"Usa il pin della singola scheda e confrontalo con l’indirizzo. Per datare la presenza cerca una pubblicazione datata dello stesso riferimento.",
 "studi-santi-bitonto":"Confronta riferimento MioGest e indirizzo della scheda. La data nel nome di una foto riguarda il file fotografico.",
 "studio-casa-bitonto":"Confronta la scheda dell’agenzia con quella del portale usando il riferimento. Verifica separatamente indirizzo e data di pubblicazione.",
 "puntocasa-bitonto":"Verifica la via nella scheda WordPress. Il mese nella cartella delle foto data il caricamento del file.",
 "garofalo-immobiliare-bitonto":"Verifica indirizzo e riferimento nella scheda Flazio. La data di creazione documenta l’età della scheda.",
 "iconacasa-bitonto":"Confronta indirizzo e riferimento nella scheda ufficiale. La data di pubblicazione documenta la presenza sul sito.",
 "momento-casa-bitonto":"Verifica che la scheda TrovaCasa indichi Momento Casa e lo stesso immobile. Confronta indirizzo e data dichiarati dal portale.",
};
export function agencyVerificationMethod(slug:string) {
 return agencyVerification[slug] ?? "Confronta riferimento, indirizzo e data nella pubblicazione originale della stessa agenzia.";
}
