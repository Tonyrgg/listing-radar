import { icon } from './icons.js';

export function unitTableFields(unit) {
  const category=(unit.source.category||'').trim().toUpperCase();
  const type=/^A\/(?:[1-9]|11)$/.test(category)?'Abitazione':({'A/10':'Ufficio','C/1':'Negozio','C/2':'Deposito','C/6':'Autorimessa'}[category]||'Non rilevata');
  return {
    civic:unit.position?.civic==='.'?'S.n.c.':unit.position?.civic||'—',
    floor:unit.position?.floors?.length?unit.position.floors.map(f=>f===0?'Terra':f<0?`S${Math.abs(f)}`:`${f}°`).join(' / '):'—',
    category:category||'—',type,
  };
}

/** Same columns for every acquired unit; full address belongs to the opened record. */
export function unitTableHtml(units, {escape, selected, disabled, queued, expandedKey, renderDetails}) {
  const columns=['','Civico','Piano','Tipologia','Foglio','Particella','Sub','Intestatario','Stato',''];
  return `<div class="unit-table-scroll"><table class="unit-table"><caption class="sr-only">Immobili della via, ordinati per civico, piano e catasto</caption><colgroup>${['select','civic','floor','type','sheet','parcel','sub','owner','state','open'].map(name=>`<col class="col-${name}">`).join('')}</colgroup><thead><tr>${columns.map((label,i)=>`<th scope="col">${label||`<span class="sr-only">${i===0?'Selezione':'Dettagli'}</span>`}</th>`).join('')}</tr></thead><tbody>${units.map(unit=>{
    const f=unitTableFields(unit),s=unit.source,owners=s.owners,open=expandedKey===unit.key;
    const decision=unit.writePending?'review':unit.assessment?.kind||'unknown';
    const label=queued.has(unit.key)?'In coda':({unknown:'Da confrontare',create:'Da creare',update:'Da aggiornare',unchanged:'Allineato',review:'Da verificare',synced:'Verificato'}[decision]||'Da confrontare');
    const id=`unit-panel-${unit.key}`;
    return `<tr class="unit unit-register unit-table-row" data-unit="${escape(unit.key)}" data-selected="${selected.has(unit.key)}" data-expanded="${open}"><td><input type="checkbox" aria-label="Seleziona ${escape(s.fullAddress)}, subalterno ${escape(s.cadastral.subaltern||'non rilevato')}" data-unit-select="${escape(unit.key)}" ${selected.has(unit.key)?'checked':''} ${disabled||queued.has(unit.key)?'disabled':''}></td><th scope="row" title="${escape(s.fullAddress)}">${escape(f.civic)}</th><td>${escape(f.floor)}</td><td><span class="table-type">${escape(f.type)}</span><small>${escape(f.category)}</small></td><td class="cat-number">${escape(s.cadastral.sheet||'—')}</td><td class="cat-number">${escape(s.cadastral.parcel||'—')}</td><td class="cat-number">${escape(s.cadastral.subaltern||'—')}</td><td class="table-owner"><span title="${escape(owners.map(o=>o.fullName).join(', '))}">${escape(owners[0]?.fullName||'Non rilevato')}</span>${owners.length>1?`<small>+${owners.length-1} ${owners.length===2?'intestatario':'intestatari'}</small>`:''}</td><td><span class="table-state" data-decision="${escape(decision)}">${escape(label)}</span>${unit.writePending?`<small class="table-warning">Salvataggio da verificare</small>`:''}</td><td><button class="table-open quiet" data-unit-open="${escape(unit.key)}" aria-expanded="${open}" ${open?`aria-controls="${escape(id)}"`:""} aria-label="${open?'Chiudi':'Apri'} immobile ${escape(s.fullAddress)}, subalterno ${escape(s.cadastral.subaltern||'non rilevato')}">${open?'Chiudi':'Apri'}${icon(open?'chevron-up':'chevron-right')}</button></td></tr>${open?`<tr class="unit-table-detail" id="${escape(id)}"><td colspan="10"><header><strong>${escape(s.fullAddress)}</strong><span>Subalterno ${escape(s.cadastral.subaltern||'non rilevato')}</span></header>${renderDetails(unit)}</td></tr>`:''}`;
  }).join('')}</tbody></table></div>`;
}
