import { buildPlan, sameCadastralIdentity, sameCrmPropertyAddress, splitSourcePersonName } from "../import-v2/identity.js";
import type { CrmPropertySummary, SourceProperty } from "../import-v2/model.js";
import type { Assessment } from "./model.js";

/** Search failures and partial inventories can never justify a creation. */
export function assess(source: SourceProperty, candidates: CrmPropertySummary[], searchComplete: boolean): Assessment {
  const base = { candidateId: null, checkedAt: new Date().toISOString(), sourceId: source.sourcePropertyId };
  try { const plan = buildPlan(source); for (const owner of plan.source.owners) splitSourcePersonName(owner.fullName, owner.taxCode); } catch (error) { return { ...base, kind: "review", reason: error instanceof Error ? error.message : "Dati da completare" }; }
  if (!searchComplete) return { ...base, kind: "unknown", reason: "Ricerca nel gestionale incompleta: presenza non determinata." };
  const unique = [...new Map(candidates.map(c => [c.id.slice(0, 15), c])).values()];
  const identity = { ...source.cadastral, income: null };
  const exact = unique.filter(c => c.cadastral?.sheet && c.cadastral.parcel && c.cadastral.subaltern && sameCadastralIdentity(identity, { ...c.cadastral, income: null }));
  if (exact.length > 1) return { ...base, kind: "review", reason: "Più schede condividono i dati catastali. Serve una scelta esplicita." };
  if (exact.length === 1) return { ...base, kind: "update", candidateId: exact[0]!.id, reason: sameCrmPropertyAddress(source.fullAddress, exact[0]!) ? "Scheda identificata tramite catasto e indirizzo. Intestatari e recapiti saranno riletti prima dell'aggiornamento." : "Catasto corrispondente, indirizzo diverso: controlla la scheda prima di applicare." };
  const incomplete = unique.filter(c => sameCrmPropertyAddress(source.fullAddress, c) && !(c.cadastral?.sheet && c.cadastral.parcel && c.cadastral.subaltern));
  if (incomplete.length) return { ...base, kind: "review", reason: "Indirizzo presente ma catasto incompleto. Nessuna sovrascrittura automatica." };
  return { ...base, kind: "create", reason: "Ricerca completa della via e del catasto: nessuna scheda corrispondente." };
}
