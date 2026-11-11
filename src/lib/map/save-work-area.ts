import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {MapArea} from './types';
import {workAreaInput} from './work-area-input';

/** Edit only the drawing metadata; keep notes, status and related records. */
export async function saveWorkArea(db:SupabaseClient,input:unknown):Promise<MapArea>{
  const parsed=workAreaInput.safeParse(input);
  if(!parsed.success)throw Error(parsed.error.issues[0]?.message??'Controlla i dati della zona.');
  const value=parsed.data;
  const payload={name:value.name,agent_id:value.agentId,color:value.color,geometry:value.geometry};
  if(value.agentId){
    const agent=await db.from('agents').select('id').eq('id',value.agentId).maybeSingle();
    if(agent.error)throw Error('Non è stato possibile verificare l’assegnazione. Riprova.');
    if(!agent.data)throw Error('L’agente selezionato non è più disponibile. Scegli un’altra assegnazione.');
  }
  let query;
  if(value.id){
    const update=db.from('map_areas').update(payload).eq('id',value.id);
    query=value.expectedUpdatedAt===null?update.is('updated_at',null):update.eq('updated_at',value.expectedUpdatedAt!);
  }else query=db.from('map_areas').insert({id:value.creationId,...payload,status:'not_started',notes:null});
  const {data,error}=await query.select('*').maybeSingle();
  // A response may be lost after an insert. Retry with the same draft ID,
  // without replacing a drawing that has since been changed elsewhere.
  if(!value.id&&error?.code==='23505'){
    const previous=await db.from('map_areas').select('*').eq('id',value.creationId!).maybeSingle();
    const row=previous.data;
    if(!previous.error&&row&&row.name===payload.name&&row.agent_id===payload.agent_id&&row.color===payload.color&&isDeepStrictEqual(row.geometry,payload.geometry)){
      return {id:row.id,name:row.name,agentId:row.agent_id,color:row.color,geometry:row.geometry,
        status:row.status,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at};
    }
    throw Error('Questo disegno risulta già salvato con dati diversi. Ricarica le zone prima di riprovare.');
  }
  if(error)throw Error('Salvataggio della zona non riuscito. Il disegno resta disponibile: riprova.');
  if(!data)throw Error('La zona è stata modificata da un’altra postazione o non è più disponibile. Ricarica prima di salvare.');
  return {id:data.id,name:data.name,agentId:data.agent_id,color:data.color,geometry:data.geometry,
    status:data.status,notes:data.notes,createdAt:data.created_at,updatedAt:data.updated_at};
}
