export const INTELLIGENCE_SORTS={
 immobile:{field:"address",label:"Immobile"},
 zona:{field:"zone_name",label:"Zona"},
 prezzo:{field:"latest_asking_price",label:"Prezzo richiesto"},
 metro:{field:"unit_asking_price",label:"Prezzo al m²"},
 giorni:{field:"known_market_age",label:"Giorni osservati"},
 ribassi:{field:"drop_count",label:"Ribassi"},
 fonte:{field:"agency_name",label:"Fonte"},
 stato:{field:"exit_classification",label:"Stato"},
 indice:{field:"opportunity_score",label:"Indice"},
 riscontro:{field:"last_seen_at",label:"Ultima presenza"},
} as const;
export type IntelligenceSort=keyof typeof INTELLIGENCE_SORTS;
export function intelligenceSort(key:string|undefined,direction:string|undefined,view:string){
 const fallback=view==="opportunita"?"indice":"riscontro";
 const sort: IntelligenceSort=key&&Object.hasOwn(INTELLIGENCE_SORTS,key)?key as IntelligenceSort:fallback;
 return {key:sort,field:INTELLIGENCE_SORTS[sort].field,label:INTELLIGENCE_SORTS[sort].label,ascending:direction==="asc"};
}
export function compareUnitPrices(a:{row_id:string;latest_asking_price:number|null;surface_sqm?:number|null},b:typeof a,ascending:boolean){
 const ratio=(r:typeof a)=>r.latest_asking_price!=null&&Number.isFinite(r.latest_asking_price)&&r.surface_sqm!=null&&Number.isFinite(r.surface_sqm)&&r.surface_sqm>0?r.latest_asking_price/r.surface_sqm:null;
 const av=ratio(a),bv=ratio(b);
 if(av==null||bv==null)return av==null&&bv==null?a.row_id.localeCompare(b.row_id):av==null?1:-1;
 return (ascending?av-bv:bv-av)||a.row_id.localeCompare(b.row_id);
}
