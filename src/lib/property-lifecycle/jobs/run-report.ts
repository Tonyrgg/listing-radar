import { appendFileSync } from 'node:fs';
import type { SyncResult } from '../sync/engine';

const cell = (value: unknown) => String(value ?? '—').replace(/[|\r\n]/g, ' ');

export function agencyRunReport(agency: string, result: SyncResult): string {
  return `\n### ${cell(agency)}\n\n` +
    `| Esito | Inventario | Letti | In zona | Errori | Valutazione assenze |\n|---|---|---:|---:|---:|---|\n` +
    `| ${cell(result.healthState)} | ${result.inventoryComplete ? 'Completo' : 'Incompleto'} | ${result.counts.normalizedCount}/${result.counts.discoveredCount} | ${result.counts.inScopeCount} | ${result.counts.errorCount} | ${result.absenceEvaluationAllowed ? 'Consentita' : 'Bloccata'} |\n` +
    (result.sourceReasons?.length ? `\nDiagnostica: ${result.sourceReasons.map(cell).join(', ')}.\n` : '') +
    (result.healthState !== 'HEALTHY' ? '\nLettura parziale o non disponibile: i dati precedenti restano conservati e non attestano un aggiornamento completo.\n' : '');
}

export function writeAgencyRunReport(agency: string, result: SyncResult): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, agencyRunReport(agency, result));
}
