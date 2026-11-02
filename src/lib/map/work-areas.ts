import "server-only";
import type {SupabaseClient} from '@supabase/supabase-js';
import {MAP_DATA_COLORS} from '@/lib/design/map-palette';
import type {GeoJsonGeometry,TerritoryWorkArea} from './types';

/** Read the original drawings; assignments are joined by ID, never guessed from names. */
export async function readTerritoryWorkAreas(db:SupabaseClient):Promise<TerritoryWorkArea[]> {
  const [areas,agents]=await Promise.all([
    db.from('map_areas').select('id,name,agent_id,color,geometry').order('name'),
    db.from('agents').select('id,name,color').order('name'),
  ]);
  if(areas.error)throw Error(areas.error.message);
  if(agents.error)throw Error(agents.error.message);
  const byId=new Map((agents.data??[]).map(agent=>[agent.id,agent]));
  return (areas.data??[]).map(area=>{
    const agent=byId.get(area.agent_id);
    return {id:area.id,name:area.name,agentId:area.agent_id,agentName:agent?.name??null,
      color:area.color??agent?.color??MAP_DATA_COLORS.accentuated,geometry:area.geometry as GeoJsonGeometry};
  });
}
