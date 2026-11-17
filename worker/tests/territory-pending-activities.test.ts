import {it,expect} from 'vitest';
import {pendingRunActivities} from '../src/territory/activity-plan.js';
import {simulationSource} from '../src/territory/providers.js';
import {unitKey,type TerritoryState,type Run,type Street} from '../src/territory/model.js';
it('separates a saved Task pending readback from a skipped item and never counts another run',()=>{
 const street={id:'test',name:'Via Test',locality:'Bitonto'} as Street,source=simulationSource(street,1,'job');source.activity.enabled=true;
 const key=unitKey(source),run={startedAt:'2026-11-16T16:20:00Z',endedAt:'2026-11-16T19:28:00Z',applySources:{[key]:source},imports:{}} as unknown as Run;
 const cp={plan:{source},activityWrite:{submittedAt:'2026-11-16T17:00:00Z',saveAcknowledgedAt:'2026-11-16T17:00:01Z',savedActivityId:'task'}};
 const state={checkpoints:{[source.sourcePropertyId]:cp}} as unknown as TerritoryState;
 expect(pendingRunActivities(state,run)).toEqual([expect.objectContaining({key,acknowledged:true,savedActivityId:'task'})]);
 cp.activityWrite.submittedAt='2026-11-15T17:00:00Z';expect(pendingRunActivities(state,run)).toEqual([]);
});
