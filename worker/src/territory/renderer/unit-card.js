export function comparisonLabel(unit) {
  if (!unit.assessment) return "Confronto da eseguire";
  return { unknown: "Confronto incompleto", create: "Da creare nel CRM", update: "Da aggiornare nel CRM", unchanged: "Già coerente", review: "Corrispondenza da chiarire", synced: "Import verificato" }[unit.assessment.kind] || "Confronto da eseguire";
}
export function ownerListHtml(owners, escape, extended = false) {
  return `<section class="unit-owners" aria-label="Intestatari"><h4 class="icon-label">${icon("users")}Intestatari <span>${owners.length}</span></h4><ul>${owners.map(owner => `<li><div class="owner-name"><strong>${escape(owner.fullName || "Nome non disponibile")}</strong><span class="owner-share">${owner.sharePercentage == null ? "Quota non rilevata" : `${escape(owner.sharePercentage)}%`}</span></div><div class="owner-details"><span>${escape(owner.rightType || "Diritto non rilevato")}</span><span class="mono">${escape(owner.taxCode || "CF non rilevato")}</span></div>${owner.contacts?.phones?.length ? `<p class="owner-contacts">Tel. ${escape(owner.contacts.phones.join(" · "))}</p>` : ""}${extended && owner.contacts?.emails?.length ? `<p class="owner-contacts">${escape(owner.contacts.emails.join(" \u00b7 "))}</p>` : ""}${extended && (owner.birthDate || owner.birthPlace) ? `<p class="meta">Nascita: ${escape([owner.birthDate, owner.birthPlace, owner.birthProvince].filter(Boolean).join(" \u00b7 "))}</p>` : ""}</li>`).join("") || '<li class="meta">Nessun intestatario disponibile</li>'}</ul></section>`;
}
export function unitHeadingHtml(unit, escape) {
  const source = unit.source, position = unit.position;
  const civic = position?.civic === "." ? "Senza civico" : position?.civic ? `Civico ${position.civic}` : "Civico non rilevato";
  const floors = position?.floors ?? [];
  const floorLabel = floors.length ? floors.map(f => f === 0 ? "Terra" : f < 0 ? `S${Math.abs(f)}` : String(f)).join(" / ") : "non rilevato";
  return `<div class="unit-location"><span class="icon-label">${icon("pin")}${escape(civic)}</span><span class="unit-floor icon-label">${icon("layers")}Piano ${escape(floorLabel)}</span></div><h3>${escape(source.fullAddress)}</h3><dl class="unit-cadastral">${[["Foglio", source.cadastral.sheet], ["Particella", source.cadastral.parcel], ["Sub", source.cadastral.subaltern], ...(source.cadastral.urbanSection ? [["Sezione", source.cadastral.urbanSection]] : [])].map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value || "N/D")}</dd></div>`).join("")}<div><dt>Categoria</dt><dd>${escape(source.category || "N/D")}</dd></div></dl>`;
}
export function comparisonHtml(unit, escape) {
  const glyph = { create: "plus", update: "refresh", unchanged: "check", synced: "check", review: "warning" }[unit.assessment?.kind] || "search";
  return `<section class="unit-comparison" aria-label="Confronto con il gestionale"><span class="status icon-label" data-decision="${escape(unit.assessment?.kind || "unknown")}">${icon(glyph)}${escape(comparisonLabel(unit))}</span>${unit.origin === "simulation" ? '<span class="unit-origin">Dati di prova</span>' : ""}<p class="reason">${escape(unit.assessment?.reason || "Dati SISTER conservati. Il confronto cerca la scheda nel CRM, senza modificarla.")}</p></section>`;
}
import { icon } from "./icons.js";

import { unitHistoryHtml } from "./unit-history.js";
export function unitImportTone(unit, now = Date.now()) {
  if (!unit.memory?.statistics.verifiedImports) return 'acquired';
  const at = unit.memory.statistics.lastImportedAt;
  const age = at ? Math.floor((now - Date.parse(at)) / 86400000) : null;
  return age === null || !Number.isFinite(age) || age < 0 ? 'never' : age <= 30 ? 'recent' : age <= 90 ? 'aging' : 'stale';
}
export function unitImportHtml(unit, escape, date) {
  const stats = unit.memory?.statistics, at = stats?.lastImportedAt;
  const tone = unitImportTone(unit);
  const age = tone !== 'never' && at ? Math.floor((Date.now() - Date.parse(at)) / 86400000) : null;
  const recency = age === null ? '' : age === 0 ? ' · oggi' : age === 1 ? ' · ieri' : ` · ${age} giorni fa`;
  return `<div class="unit-import-fact" data-import-tone="${tone}"><strong class="icon-label">${icon(stats?.verifiedImports ? 'check' : 'download')}${stats?.verifiedImports ? 'Import riuscito' + recency : 'Mai importato in Cloud'}</strong><span>${stats?.verifiedImports ? at ? date(at) : 'Data non disponibile' : 'Dati SISTER conservati'}</span></div>`;
}
export function cloudPresenceHtml(unit, escape, date) {
  const cloud = unit.cloud;
  if (!cloud || !cloud.property && !cloud.people.some(p => p.evidence)) return '';
  const state = evidence => !evidence ? 'Non ancora verificato' : evidence.status === 'found' ? evidence.crmIds.length > 1 ? 'Più schede trovate' : 'Già presente' : evidence.status === 'not_found' ? 'Non trovato nell’ultima ricerca' : 'Presenza da riconfermare';
  const facts = evidence => evidence ? `<dl class="cloud-verification"><div><dt>Ultima verifica positiva</dt><dd>${evidence.lastVerifiedAt ? date(evidence.lastVerifiedAt) : 'Non disponibile'}</dd></div>${evidence.lastCheckedAt !== evidence.lastVerifiedAt ? `<div><dt>Ultimo controllo</dt><dd>${date(evidence.lastCheckedAt)}</dd></div>` : ""}${evidence.crmIds.length ? `<div><dt>${evidence.status === 'found' ? 'ID Cloud' : 'ID trovati in precedenza'}</dt><dd class="mono">${evidence.crmIds.map(escape).join(' · ')}</dd></div>` : ''}</dl>` : '';
  const label = unit.origin === 'simulation' ? 'Gestionale simulato' : 'Tecnocloud';
  const evidence = cloud.property;
  return `${evidence?.status === 'found' ? `<p class="unit-cloud-fact meta icon-label">${icon('link')}Scheda già trovata in ${label}${evidence.lastVerifiedAt ? ' · ' + date(evidence.lastVerifiedAt) : ''}</p>` : ''}<details data-disclosure="${escape(unit.key)}:cloud"><summary>Presenza in ${label}</summary><div class="unit-detail-body"><h4 class="icon-label">${icon('building')}Immobile: ${state(evidence)}</h4>${facts(evidence)}<h4 class="icon-label">${icon('users')}Intestatari</h4><ul class="cloud-people">${cloud.people.map(p => `<li><strong>${escape(p.fullName)}</strong><span class="meta">${state(p.evidence)}</span>${facts(p.evidence)}</li>`).join('')}</ul><p class="meta">Le schede già trovate si aprono direttamente per ID. Il worker ne conferma l’identità prima di modificarle.</p></div></details>`;
}
export function unitRecordHtml(u, { escape, date, selected = false, selectionDisabled = false, editDisabled = false, allowTestChoice = false, footer = "" }) {
    const s = u.source,
      decision = u.assessment?.kind || "unknown";
    editDisabled ||= Boolean(u.writePending);
    const enabled = !selectionDisabled;
    return `<article class="unit" data-unit="${escape(u.key)}" data-selected="${selected}"><div class="unit-head"><label class="unit-select-label"><input type="checkbox" aria-label="Seleziona ${escape(s.fullAddress)}" data-unit-select="${escape(u.key)}" ${selected ? "checked" : ""} ${enabled ? "" : "disabled"}></label><div>${unitHeadingHtml(u, escape)}</div></div>${unitImportHtml(u, escape, date)}${ownerListHtml(s.owners, escape)}${cloudPresenceHtml(u, escape, date)}${allowTestChoice && !u.canWrite && ["create", "update"].includes(decision) ? '<p class="meta">Scheda non autorizzata al collaudo</p><button class="quiet" data-authorize-key="' + escape(u.key) + '">Scegli per il collaudo</button>' : ""}<details data-disclosure="${escape(u.key)}:record"><summary>Dati immobile e acquisizioni</summary><div class="unit-detail-body">${comparisonHtml(u, escape)}<table><tr><th scope="row">Categoria</th><td>${escape(s.category)}</td></tr><tr><th scope="row">Consistenza</th><td>${escape(s.consistency)}</td></tr><tr><th scope="row">Ultima acquisizione</th><td>${date(u.observations.at(-1)?.at)}</td></tr>${u.crmId ? `<tr><th scope="row">Scheda gestionale</th><td>${escape(u.crmId)}</td></tr><tr><th scope="row">Ultimo import concluso</th><td>${u.importedAt ? date(u.importedAt) : "Data non disponibile"}</td></tr>` : ""}</table><p>${escape(u.note)}</p><details data-disclosure="${escape(u.key)}:observations"><summary>Acquisizioni precedenti (${u.observations.length})</summary>${[
      ...u.observations,
    ]
      .reverse()
      .map(
        (o) =>
          `<p class="explanation">${date(o.at)} · ${escape(o.source.fullAddress)} · ${o.source.owners.length} intestatari</p>`,
      )
      .join(
        "",
      )}</details></div></details>${unitHistoryHtml(u, escape, date)}<details data-disclosure="${escape(u.key)}:edit"><summary>Correggi i dati conservati</summary><div class="unit-detail-body">${u.writePending ? `<p class="queue-card-problem">${escape(u.writeIssue || "Scrittura da verificare: il prossimo avvio dalla coda recupera il piano originale. Le correzioni sono protette fino alla verifica.")}</p>` : ""}<p class="explanation">La lettura originale resta nello storico. Le correzioni manuali saranno conservate anche alla prossima acquisizione.</p><form class="edit-form" data-edit="${escape(u.key)}"><fieldset class="unit-edit-fields" ${editDisabled ? "disabled" : ""}><div class="field"><label>Indirizzo<input name="address" required value="${escape(s.fullAddress)}"></label></div><div class="field"><label>Categoria<input name="category" required value="${escape(s.category)}"></label></div>${s.owners.map((owner, i) => `<div class="owner-edit"><label>Nome intestatario<input name="name-${i}" aria-label="Nome intestatario ${i + 1}" required value="${escape(owner.fullName)}"></label><label>Codice fiscale<input name="cf-${i}" aria-label="Codice fiscale intestatario ${i + 1}" value="${escape(owner.taxCode)}"></label><label>Quota (%)<input name="share-${i}" type="number" min="0" max="100" step="0.001" aria-label="Quota intestatario ${i + 1}" value="${owner.sharePercentage ?? ""}"></label></div>`).join("")}<div class="field"><label>Annotazioni<textarea name="note" rows="2">${escape(u.note)}</textarea></label></div><div class="form-actions"><button ${editDisabled ? "disabled" : ""}>Salva correzioni</button><button type="button" data-cancel>Annulla</button></div></fieldset></form></div></details>${footer}</article>`;
  }
