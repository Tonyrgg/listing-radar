import {it,expect} from 'vitest';
import data from '../src/territory/urban-scope-data.json' with {type:'json'};
import {applyUrbanScope} from '../src/territory/urban-scope.js';
import type {TerritoryState,Street} from '../src/territory/model.js';
it('removes external geometries from management without losing history and retains the documented clipped line',()=>{
 const entries=Object.entries(data.streets) as Array<[string,{outside:boolean;geometry?:unknown}]>;
 const outside=entries.find(([,s])=>s.outside)!,inside=entries.find(([,s])=>!s.outside)!;
 const street=(id:string)=>({id,name:'Test',sisterName:'TEST',locality:'Bitonto',geometry:null,geometryEvidence:null,needsReview:false}) as Street;
 const state={streets:[street(outside[0]),street(inside[0]),street('unknown')],runs:[{id:'preserved'}]} as unknown as TerritoryState;
 applyUrbanScope(state);
 expect(state.streets[0]?.outsideUrbanArea).toBe(true);expect(state.streets[0]?.geometry).toBeNull();
 expect(state.streets[1]?.geometry).toEqual(inside[1].geometry);expect(state.streets[2]?.outsideUrbanArea).toBeUndefined();
 expect(state.runs[0]?.id).toBe('preserved');
 expect(data.metadata.outside).toBe(449);expect(data.metadata.clipped).toBe(93);
});
