import {describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
vi.mock('server-only',()=>({}));
import {readTerritoryWorkAreas} from '@/lib/map/work-areas';

const geometry={type:'Polygon',coordinates:[[[16.68,41.10],[16.69,41.10],[16.69,41.11],[16.68,41.10]]]};
const areas=[
  {id:'first',name:'Perimetro A',agent_id:'a',color:'#123456',geometry},
  {id:'second',name:'Perimetro B',agent_id:'b',color:null,geometry},
  {id:'shared',name:'Area condivisa',agent_id:null,color:null,geometry},
];
function database(failingTable?:string) {
  return createClient('http://127.0.0.1:54321','test-key',{auth:{persistSession:false},global:{fetch:async input=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    const table=url.pathname.split('/').at(-1);
    if(table===failingTable)return new Response(JSON.stringify({message:'read unavailable'}),{status:403,headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify(table==='map_areas'?areas:[{id:'a',name:'Operatore A',color:'#654321'},{id:'b',name:'Operatore B',color:'#abcdef'}]),{headers:{'Content-Type':'application/json'}});
  }}});
}
describe('saved territory work areas',()=>{
  it('keeps original perimeters, explicit assignments and area colours',async()=>{
    const result=await readTerritoryWorkAreas(database());
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({id:'first',name:'Perimetro A',agentId:'a',agentName:'Operatore A',color:'#123456',geometry});
    expect(result[1]).toMatchObject({agentId:'b',agentName:'Operatore B',color:'#abcdef',geometry});
    expect(result[2]).toMatchObject({agentId:null,agentName:null,geometry});
  });
  it.each(['map_areas','agents'])('reports a failed %s read rather than declaring drawings missing or unassigned',async table=>{
    await expect(readTerritoryWorkAreas(database(table))).rejects.toThrow('read unavailable');
  });
});
