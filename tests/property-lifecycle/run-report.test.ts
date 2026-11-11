import { expect, it } from 'vitest';
import { agencyRunReport } from '@/lib/property-lifecycle/jobs/run-report';
it('reports incomplete sources and preserves the distinction between reads and discoveries', () => {
  const report = agencyRunReport('test|source', {syncRunId:'r', healthState:'DEGRADED', inventoryComplete:false, absenceEvaluationAllowed:false,
    counts:{discoveredCount:80,normalizedCount:79,inScopeCount:79,excludedCount:0,errorCount:1,missingCount:0,transitionedCount:0},sourceReasons:['detail_error']});
  expect(report).toContain('79/80'); expect(report).toContain('Bloccata'); expect(report).toContain('Incompleto');
  expect(report).toContain('test source'); expect(report).toContain('non attestano un aggiornamento completo');
});
