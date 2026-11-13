import {it,expect} from 'vitest';
import {agencyTenureLabel,currentAgencyAssignment} from '@/lib/property-lifecycle/read-models/agency-tenure';
it('distinguishes observed agency tenure from total market age',()=>{
 expect(agencyTenureLabel('2026-11-01','2026-11-13')).toBe('Osservata con questa agenzia da almeno 12 giorni');
 expect(agencyTenureLabel('2026-11-01','2026-11-05',false)).toBe('Presenza osservata con questa agenzia: 4 giorni');
 expect(agencyTenureLabel('invalid')).toContain('non ricostruibile');
});
it('does not invent an entry date for a human confirmed own agency assignment',()=>{
 expect(currentAgencyAssignment([{key:'current_agency',effectiveAt:'2026-01-01',value:{role:'OUR_AGENCY',startedAt:null}}])?.startedAt).toBeNull();
});
