import {expect,it} from 'vitest';
import {hasFinishedStreetTraversal,isCompleteStreetAcquisition,streetAcquisitionAnomalyCount,type SisterStreetRunCheckpoint} from '../src/services/sister-street-run.js';
it('distinguishes a finished traversal from fully verified individual rows',()=>{
 const cp={status:'completed',lastError:null,results:[{outcome:'found',recordLedger:[{status:'completed_with_anomalies'}]}]} as SisterStreetRunCheckpoint;
 expect(hasFinishedStreetTraversal(cp)).toBe(true);expect(isCompleteStreetAcquisition(cp)).toBe(false);expect(streetAcquisitionAnomalyCount(cp)).toBe(1);
 for(const status of ['paused','running','failed'] as const)expect(hasFinishedStreetTraversal({...cp,status})).toBe(false);
 expect(hasFinishedStreetTraversal({...cp,results:[]})).toBe(false);expect(hasFinishedStreetTraversal({...cp,results:[{outcome:'failed'} as never]})).toBe(false);
 expect(hasFinishedStreetTraversal({...cp,lastError:'Errore portale'})).toBe(false);
});
