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

export function unitTableState(unit, meta={}) {
  return meta.stateLabel || (unit.writePending?'Da verificare':({unknown:'Da confrontare',create:'Da creare',update:'Da aggiornare',unchanged:'Allineato',review:'Da verificare',synced:'Verificato'}[unit.assessment?.kind||'unknown']||'Da confrontare'));
}
const collator=new Intl.Collator('it',{numeric:true,sensitivity:'base'});
const absent=value=>value===null||value===undefined||String(value).trim()===''||value==='—';
export function sortUnits(units, sort={key:'civic',direction:'asc'}, meta=()=>({})) {
  const value=(u,key)=>{
    const f=unitTableFields(u),s=u.source;
    return ({address:s.fullAddress,civic:f.civic==='S.n.c.'?null:u.position?.civic,floor:u.position?.floors?.length?Math.min(...u.position.floors):null,
      type:f.type==='Non rilevata'?null:f.type+' '+f.category,sheet:s.cadastral.sheet,parcel:s.cadastral.parcel,sub:s.cadastral.subaltern,
      owner:s.owners[0]?.fullName,state:unitTableState(u,meta(u))})[key];
  };
  return units.map((unit,index)=>({unit,index})).sort((a,b)=>{
    const av=value(a.unit,sort.key),bv=value(b.unit,sort.key);
    if(absent(av)!==absent(bv))return absent(av)?1:-1;
    const compared=absent(av)?0:typeof av==='number'&&typeof bv==='number'?av-bv:collator.compare(String(av),String(bv));
    if(compared)return compared*(sort.direction==='desc'?-1:1);
    return a.index-b.index;
  }).map(row=>row.unit);
}
export function nextUnitSort(current,key){return{key,direction:current.key===key&&current.direction==='asc'?'desc':'asc'};}

/** Same columns for every acquired unit; full address belongs to the opened record. */
export function unitTableHtml(units, {escape, selected, disabled, queued, expandedKey, renderDetails, sort={key:"civic",direction:"asc"}, showAddress=false, rowMeta=()=>({}), selectAttribute="unit-select", openAttribute="unit-open", queryRows=false}) {
  const columns=[['',''],...(showAddress?[['address','Immobile']]:[]),['civic','Civico'],['floor','Piano'],['type','Tipologia'],['sheet','Foglio'],['parcel','Particella'],['sub','Sub'],['owner','Intestatario'],['state','Stato'],['','']];
  return `<div class="unit-table-scroll"><table class="unit-table"><caption class="sr-only">Immobili, ordinabili per colonna</caption><colgroup>${['select',...(showAddress?['address']:[]),'civic','floor','type','sheet','parcel','sub','owner','state','open'].map(name=>`<col class="col-${name}">`).join('')}</colgroup><thead><tr>${columns.map(([key,label],i)=>`<th scope="col" ${key?`aria-sort="${sort.key===key?(sort.direction==='asc'?'ascending':'descending'):'none'}"`:''}>${key?`<button class="table-sort" data-unit-sort="${key}" aria-label="Ordina per ${label}">${label}<span aria-hidden="true">${sort.key===key?(sort.direction==='asc'?'↑':'↓'):'↕'}</span></button>`:`<span class="sr-only">${i===0?'Selezione':'Dettagli'}</span>`}</th>`).join('')}</tr></thead><tbody>${units.map(unit=>{
    const f=unitTableFields(unit),s=unit.source,owners=s.owners,open=expandedKey===unit.key,meta=rowMeta(unit);
    const decision=meta.decision||(unit.writePending?'review':unit.assessment?.kind||'unknown');
    const label=meta.stateLabel||(queued.has(unit.key)?'In coda':unitTableState(unit));
    const id=`unit-panel-${unit.key}`;
    return `<tr class="unit unit-register unit-table-row" data-unit="${escape(unit.key)}" ${queryRows?`data-query-unit="${escape(unit.key)}"`:""} data-selected="${selected.has(unit.key)}" data-expanded="${open}"><td><input type="checkbox" aria-label="Seleziona ${escape(s.fullAddress)}, subalterno ${escape(s.cadastral.subaltern||'non rilevato')}" data-${selectAttribute}="${escape(unit.key)}" ${selected.has(unit.key)?'checked':''} ${disabled||meta.disabled||queued.has(unit.key)?'disabled':''}></td>${showAddress?`<td class="table-address"><span title="${escape(s.fullAddress)}">${escape(s.fullAddress)}</span></td>`:""}<th scope="row" title="${escape(s.fullAddress)}">${escape(f.civic)}</th><td>${escape(f.floor)}</td><td><span class="table-type">${escape(f.type)}</span><small>${escape(f.category)}</small></td><td class="cat-number">${escape(s.cadastral.sheet||'—')}</td><td class="cat-number">${escape(s.cadastral.parcel||'—')}</td><td class="cat-number">${escape(s.cadastral.subaltern||'—')}</td><td class="table-owner"><span title="${escape(owners.map(o=>o.fullName).join(', '))}">${escape(owners[0]?.fullName||'Non rilevato')}</span>${owners.length>1?`<small>+${owners.length-1} ${owners.length===2?'intestatario':'intestatari'}</small>`:''}</td><td><span class="table-state" data-decision="${escape(decision)}">${escape(label)}</span>${unit.writePending?`<small class="table-warning">Salvataggio da verificare</small>`:''}</td><td><button class="table-open quiet" data-${openAttribute}="${escape(unit.key)}" aria-expanded="${open}" ${open?`aria-controls="${escape(id)}"`:""} aria-label="${open?'Chiudi':'Apri'} immobile ${escape(s.fullAddress)}, subalterno ${escape(s.cadastral.subaltern||'non rilevato')}">${open?'Chiudi':'Apri'}${icon(open?'chevron-up':'chevron-right')}</button></td></tr>${open?`<tr class="unit-table-detail" id="${escape(id)}"><td colspan="${columns.length}"><header><strong>${escape(s.fullAddress)}</strong><span>Subalterno ${escape(s.cadastral.subaltern||'non rilevato')}</span></header>${renderDetails(unit)}</td></tr>`:''}`;
  }).join('')}</tbody></table></div>`;
}
