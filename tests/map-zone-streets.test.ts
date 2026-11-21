import {describe,it,expect} from 'vitest';
import {buildZoneStreetDirectory,clipStreetToAreas,type DirectoryStreet,type StreetArea} from '../worker/src/territory/zone-streets';
const ring=[[0,0],[2,0],[2,2],[0,2],[0,0]];
const area:StreetArea={id:'a',name:'Zona A',color:'#aabbcc',agentName:'Tony',geometry:{type:'Polygon',coordinates:[ring]}};
const street=(id:string,coordinates:unknown):DirectoryStreet=>({id,name:`Via ${id}`,sisterName:`VIA ${id}`,locality:'Bitonto',geometry:{type:'LineString',coordinates}});
describe('zone di lavoro e vie condivise',()=>{
 it('excludes up to 15 percent and retains the predominant zone',()=>{
  const left={...area,id:'left',geometry:{type:'Polygon',coordinates:[[[0,0],[1.5,0],[1.5,2],[0,2],[0,0]]]}};
  const right={...area,id:'right',geometry:{type:'Polygon',coordinates:[[[1.5,0],[10,0],[10,2],[1.5,2],[1.5,0]]]}};
  const rows=buildZoneStreetDirectory([street('boundary',[[0,1],[10,1]]),street('above',[[0,1],[9,1]])],[left,right]).streets;
  expect(rows.find(s=>s.id==='boundary')?.areaIds).toEqual(['right']);
  expect(rows.find(s=>s.id==='above')?.areaIds).toEqual(['left','right']);
 });
 it('includes a crossing even when both endpoints are outside, but not a corner touch',()=>{
  const data=buildZoneStreetDirectory([street('cross',[[-1,1],[3,1]]),street('touch',[[-1,-1],[0,0]]),street('inside',[[.5,.5],[1,1]])],[area]);
  expect(data.streets.find(s=>s.id==='cross')?.areaIds).toEqual(['a']);expect(data.streets.find(s=>s.id==='touch')?.areaIds).toEqual([]);expect(data.areas[0]?.streetCount).toBe(2);
 });
 it('excludes polygon holes and supports MultiPolygon',()=>{
  const hole={...area,geometry:{type:'MultiPolygon',coordinates:[ [ring,[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]], [[[5,5],[6,5],[6,6],[5,6],[5,5]]] ]}};
  const rows=buildZoneStreetDirectory([street('hole',[[.7,.7],[1.3,1.3]]),street('second',[[5.2,5.2],[5.8,5.8]])],[hole]).streets;
  expect(rows.find(s=>s.id==='hole')?.areaIds).toEqual([]);expect(rows.find(s=>s.id==='second')?.areaIds).toEqual(['a']);
 });
 it('keeps multiple memberships and explicit unlocated rows, excluding retired and alias streets',()=>{
  const data=buildZoneStreetDirectory([street('shared',[[.5,.5],[1,1]]),{...street('unknown',[]),geometry:null},{...street('alias',[[0,1],[1,1]]),linkedOfficialId:'shared'},{...street('outside',[[0,1],[1,1]]),outsideUrbanArea:true}],[area,{...area,id:'b'}]);
  expect(data.streets).toHaveLength(2);expect(data.streets.find(s=>s.id==='shared')?.areaIds).toEqual(['a','b']);expect(data.streets.find(s=>s.id==='unknown')?.unlocated).toBe(true);
 });
});

it('excludes nameless traces without excluding named streets',()=>{expect(buildZoneStreetDirectory([{...street('unnamed',[[0,1],[1,1]]),name:'Tratto senza nome 123'},street('real',[[0,1],[1,1]])],[area]).streets.map(s=>s.id)).toEqual(['real']);});

it('clips painted roads exactly to selected zones without changing stored geometry',()=>{const g={type:'LineString',coordinates:[[-1,1],[3,1]]};expect(clipStreetToAreas(g,[area])).toEqual({type:'MultiLineString',coordinates:[[[0,1],[2,1]]]});expect(g.coordinates).toEqual([[-1,1],[3,1]]);expect(clipStreetToAreas({type:'LineString',coordinates:[[4,4],[5,5]]},[area])).toBeNull();});
