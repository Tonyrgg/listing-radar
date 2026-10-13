import { icon } from './icons.js';
import { ownerListHtml, unitHeadingHtml } from './unit-card.js';

export const importStageLabels = {
  queued: 'Confronto con Tecnocloud', planned: 'Verifico i proprietari', people_resolved: 'Aggiorno le anagrafiche',
  people_synced: 'Identifico la scheda immobile', property_resolved: 'Salvo i dati immobile',
  property_synced: 'Collego gli intestatari', ownerships_synced: 'Verifico la scheda salvata',
  verified: 'Compilo l’attività', activity_synced: 'Registro il risultato', completed: 'Import verificato',
};
export function currentImportHtml(item, run, { escape, date }) {
  if (!item) return '<p class="meta">Preparo il primo immobile della selezione…</p>';
  const source = item.source;
  const facts = [['Comune', source.municipality], ['Classe', source.propertyClass], ['Consistenza', source.consistency],
    ['Rendita', source.cadastral.income == null ? null : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(source.cadastral.income)],
    ['Acquisito', item.acquiredAt ? date(item.acquiredAt) : null], ['Scheda Cloud', item.crmId]];
  return `<section class="current-import" aria-label="Immobile in lavorazione"><header class="current-import-status"><span class="eyebrow icon-label">${icon('building')}${run.waiting ? 'Immobile in attesa' : 'Sto importando…'}</span><span class="status icon-label">${icon(run.waiting ? 'info' : 'refresh')}${escape(run.waiting ? 'Attendo Tecnocloud' : importStageLabels[item.stage] || 'Import in corso')}</span></header>${unitHeadingHtml(item, escape)}<dl class="current-import-facts">${facts.filter(([, value]) => value != null && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>${ownerListHtml(source.owners, escape, true)}<div class="current-import-activity icon-label">${icon('note')}<div><strong>Attività prevista</strong><p>${source.activity.enabled ? `${escape(source.activity.contactMode)} · ${escape(source.activity.status)} · ${escape(source.activity.description || 'Inserire attività')}` : 'Nessuna attività'}</p></div></div>${item.note ? `<p class="current-import-note">${escape(item.note)}</p>` : ''}${item.attempt > 1 ? `<p class="meta">Recupero automatico · tentativo ${item.attempt}</p>` : ''}</section>`;
}
