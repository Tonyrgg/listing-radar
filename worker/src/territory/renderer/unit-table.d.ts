export type UnitSort = {key:string;direction:'asc'|'desc'};
export type TableUnit = {
 key:string;source:{fullAddress?:string;category?:string;cadastral:{sheet?:string;parcel?:string;subaltern?:string};owners:{fullName:string}[]};
 position?:{civic?:string|null;floors?:number[]};writePending?:boolean;assessment?:{kind:string}|null;
};
export function unitTableFields(unit:TableUnit):{civic:string;floor:string;category:string;type:string};
export function unitTableState(unit:TableUnit,meta?:{stateLabel?:string}):string;
export function sortUnits<T extends TableUnit>(units:T[],sort?:UnitSort,meta?:(unit:T)=>{stateLabel?:string}):T[];
export function nextUnitSort(current:UnitSort,key:string):UnitSort;
export function unitTableHtml(units:TableUnit[],options:Record<string,unknown>):string;
