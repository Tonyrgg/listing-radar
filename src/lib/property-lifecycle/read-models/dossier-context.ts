import {EXIT_LABELS} from "./intelligence";
export type DossierView="mercato"|"opportunita"|"usciti"|"venduti";
export function dossierContext(requested:string|undefined,classification:string|undefined,saleStatus:string){
 const notSold=saleStatus==="NOT_SOLD_CONFIRMED";
 const confirmed=!notSold&&(classification==="SOLD_CONFIRMED"||saleStatus==="SOLD_CONFIRMED");
 const probable=!notSold&&!confirmed&&classification==="SOLD_PROBABLE";
 const exited=["WITHDRAWN","RELISTED","AGENCY_CHANGED","UNKNOWN_EXIT","MISSING_UNCONFIRMED"].includes(classification??"");
 const view:DossierView=confirmed||probable?"venduti":["mercato","opportunita","usciti","venduti"].includes(requested??"")?requested as DossierView:exited?"usciti":"mercato";
 const labels={mercato:"Mercato",opportunita:"Opportunità",usciti:"Usciti",venduti:"Venduti"};
 const titles={mercato:"Caratteristiche e presenza sul mercato",opportunita:"Analisi dell’opportunità",usciti:"Percorso di uscita dal mercato",venduti:"Esito della vendita"};
 const descriptions={mercato:"Prezzo richiesto, caratteristiche e pubblicazioni osservate.",opportunita:"Indizi che meritano una verifica, con le prove che li sostengono.",usciti:"Ultimo riscontro, classificazione dell’uscita ed eventuale ricomparsa.",venduti:"Distingui il segnale osservato dalla conferma di una vendita."};
 return {view,label:labels[view],title:titles[view],description:descriptions[view],confirmed,probable,tone:view==="opportunita"?"signal":view==="usciti"?"exit":view==="venduti"?(confirmed?"sold":"uncertain"):"market",outcome:notSold?"Non venduto, confermato manualmente":confirmed?"Vendita confermata":probable?"Vendita probabile, da confermare":EXIT_LABELS[classification??""]??"Esito non confermato"};
}
export function dossierReturn(value:string|undefined,view:DossierView){
 return value&&/^\/intelligence(?:\?|$)/.test(value)&&!/[\\\r\n]/.test(value)?value:"/intelligence?vista="+view;
}
