/** Date/status filter shared with the browser. Keep this module free of server imports. */
export function territorialRecordRecent(date:string|null|undefined,status:string|null|undefined,now:number,days:number){
 const day=Math.floor(now/86400000)*86400000,value=date?Date.parse(date):NaN;
 return !/annull|revocat|revok|cancel/i.test(status??'')&&Number.isFinite(value)&&value<=day&&day-value<=days*86400000;
}
