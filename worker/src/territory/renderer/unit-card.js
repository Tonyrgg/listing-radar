export function comparisonLabel(unit) {
  if (!unit.assessment) return "Confronto da eseguire";
  return { unknown: "Confronto incompleto", create: "Da creare nel CRM", update: "Da aggiornare nel CRM", unchanged: "Già coerente", review: "Corrispondenza da chiarire", synced: "Import verificato" }[unit.assessment.kind] || "Confronto da eseguire";
}
export function ownerListHtml(owners, escape) {
  return `<section class="unit-owners" aria-label="Intestatari"><h4>Intestatari <span>${owners.length}</span></h4><ul>${owners.map(owner => `<li><div class="owner-name"><strong>${escape(owner.fullName || "Nome non disponibile")}</strong><span class="owner-share">${owner.sharePercentage == null ? "Quota non rilevata" : `${escape(owner.sharePercentage)}%`}</span></div><div class="owner-details"><span>${escape(owner.rightType || "Diritto non rilevato")}</span><span class="mono">${escape(owner.taxCode || "CF non rilevato")}</span></div>${owner.contacts?.phones?.length ? `<p class="owner-contacts">Tel. ${escape(owner.contacts.phones.join(" · "))}</p>` : ""}</li>`).join("") || '<li class="meta">Nessun intestatario disponibile</li>'}</ul></section>`;
}
export function unitHeadingHtml(unit, escape) {
  const source = unit.source, position = unit.position;
  const civic = position?.civic === "." ? "Senza civico" : position?.civic ? `Civico ${position.civic}` : "Civico non rilevato";
  const floors = position?.floors ?? [];
  const floorLabel = floors.length ? floors.map(f => f === 0 ? "Terra" : f < 0 ? `S${Math.abs(f)}` : String(f)).join(" / ") : "non rilevato";
  return `<div class="unit-location"><span>${escape(civic)}</span><span class="unit-floor">Piano ${escape(floorLabel)}</span></div><h3>${escape(source.fullAddress)}</h3><dl class="unit-cadastral">${[["Foglio", source.cadastral.sheet], ["Particella", source.cadastral.parcel], ["Sub", source.cadastral.subaltern], ...(source.cadastral.urbanSection ? [["Sezione", source.cadastral.urbanSection]] : [])].map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value || "N/D")}</dd></div>`).join("")}<div><dt>Categoria</dt><dd>${escape(source.category || "N/D")}</dd></div></dl>`;
}
export function comparisonHtml(unit, escape) {
  return `<section class="unit-comparison" aria-label="Confronto con il gestionale"><span class="status" data-decision="${escape(unit.assessment?.kind || "unknown")}">${escape(comparisonLabel(unit))}</span>${unit.origin === "simulation" ? '<span class="unit-origin">Dati di prova</span>' : ""}<p class="reason">${escape(unit.assessment?.reason || "Dati SISTER conservati. Il confronto cerca la scheda nel CRM, senza modificarla.")}</p></section>`;
}
