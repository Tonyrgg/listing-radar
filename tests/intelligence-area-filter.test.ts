import {it,expect} from 'vitest';
import {areaBounds,inSavedArea} from '@/lib/property-lifecycle/read-models/area-filter';
import {readIntelligence} from '@/lib/property-lifecycle/read-models/intelligence';
const geometry={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]};
it('uses geographic boundaries and excludes unknown locations and polygon holes',()=>{
 expect(areaBounds(geometry)).toEqual({west:0,east:4,south:0,north:4});
 expect(inSavedArea({latitude:.5,longitude:.5},geometry)).toBe(true);
 expect(inSavedArea({latitude:2,longitude:2},geometry)).toBe(false);
 expect(inSavedArea({latitude:null,longitude:.5},geometry)).toBe(false);
 expect(inSavedArea({latitude:5,longitude:5},geometry)).toBe(false);
});
it('filters the ordered stream before paginating, including matching rows beyond the first batch',async()=>{
 const records=Array.from({length:550},(_,i)=>({property_id:String(i),row_id:String(i),latitude:i<500?2:.5,longitude:i<500?2:.5}));
 const query={gte:()=>query,lte:()=>query,order:()=>query,range:async(a:number,b:number)=>({data:records.slice(a,b+1),error:null})};
 const area={eq:()=>area,maybeSingle:async()=>({data:{geometry},error:null})};
 const db={from:(table:string)=>({select:()=>table==='map_areas'?area:query})} as never;
 const first=await readIntelligence(db,{view:'mercato',page:1,workArea:'6603644b-0ba0-4020-990b-34d17d0ac624'});
 expect(first.rows).toHaveLength(40);expect(first.rows[0].property_id).toBe('500');expect(first.hasNext).toBe(true);
 const second=await readIntelligence(db,{view:'mercato',page:2,workArea:'6603644b-0ba0-4020-990b-34d17d0ac624'});
 expect(second.rows).toHaveLength(10);expect(second.rows[0].property_id).toBe('540');expect(second.hasNext).toBe(false);
});
