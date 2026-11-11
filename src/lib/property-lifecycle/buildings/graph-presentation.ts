/** Browser-safe labels and precision classification. */
export const activityLabel=(score:number)=>score>=50?'Alta':score>=25?'Moderata':score>0?'Limitata':'Nessuna recente';
export const buildingPointPrecision=(hasCoordinates:boolean,sourcePrecision:string)=>!hasCoordinates?'STREET':sourcePrecision==='EXACT_COORDINATES'?'BUILDING':sourcePrecision==='STREET_ONLY'?'STREET':'APPROXIMATE';
