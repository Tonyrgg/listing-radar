import {expect,it} from 'vitest';
import {sortUnits,nextUnitSort,type TableUnit} from '../src/territory/renderer/unit-table.js';
function unit(key:string,civic:string|null,floor?:number):TableUnit{return{key,source:{fullAddress:key,category:'A/3',cadastral:{sheet:'48',parcel:'286',subaltern:key},owners:[{fullName:key}]},position:{civic,floors:floor===undefined?[]:[floor]}};}
it('sorts civic numbers naturally without mutating input; missing civics stay last in either direction',()=>{
 const rows=[unit('ten','10'),unit('missing',null),unit('two','2'),unit('nine','9'),unit('suffix','12/A')];
 expect(sortUnits(rows,{key:'civic',direction:'asc'}).map(u=>u.key)).toEqual(['two','nine','ten','suffix','missing']);
 expect(sortUnits(rows,{key:'civic',direction:'desc'}).map(u=>u.key)).toEqual(['suffix','ten','nine','two','missing']);
 expect(rows.map(u=>u.key)).toEqual(['ten','missing','two','nine','suffix']);
});
it('orders basement, ground and upper floors numerically, keeping unknown last',()=>{
 const rows=[unit('top','1',10),unit('unknown','1'),unit('ground','1',0),unit('basement','1',-1),unit('second','1',2)];
 expect(sortUnits(rows,{key:'floor',direction:'asc'}).map(u=>u.key)).toEqual(['basement','ground','second','top','unknown']);
});
it('keeps equal values stable and uses queue readiness labels when sorting its status',()=>{
 const rows=[unit('b','1'),unit('a','1')];
 expect(sortUnits(rows,{key:'civic',direction:'asc'}).map(u=>u.key)).toEqual(['b','a']);
 expect(sortUnits(rows,{key:'state',direction:'asc'},u=>({stateLabel:u.key==='b'?'Pronto':'Da verificare'})).map(u=>u.key)).toEqual(['a','b']);
});
it('toggles only the requested ordering direction',()=>{
 expect(nextUnitSort({key:'civic',direction:'asc'},'civic')).toEqual({key:'civic',direction:'desc'});
 expect(nextUnitSort({key:'civic',direction:'desc'},'owner')).toEqual({key:'owner',direction:'asc'});
});
