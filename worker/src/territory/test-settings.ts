import { buildPlan } from "../import-v2/identity.js";
import { effectiveSource, unitKey, type TerritoryState } from "./model.js";
import { validateLiveConfig, type LiveConfig, type LiveBrowserConfig } from "./live-provider.js";

export function testSettings(state: TerritoryState, config: LiveConfig) {
  return { live: true, allowCreate: config.allowCreate, selected: [...config.allowedCadastralKeys], records: Object.values(state.units).map(unit => {
    const source = effectiveSource(unit);
    let reason: string | null = null;
    try {
      if (source.municipality.trim().toUpperCase() !== "BITONTO" || unitKey(source) !== unit.key || unit.observations.some(o => o.origin === "simulation")) throw new Error("Immobile fuori dal profilo reale");
      buildPlan(source);
    } catch (error) { reason = error instanceof Error ? error.message : "Dati incompleti"; }
    return { key: unit.key, address: source.fullAddress, cadastral: source.cadastral, owners: source.owners.map(owner => ({ fullName: owner.fullName, taxCode: owner.taxCode })), eligible: reason === null, reason };
  }) };
}
/** Selection of known records explicitly authorises their current owners only. */
export function configureTestSettings(state: TerritoryState, base: LiveConfig, keys: string[], allowCreate: boolean, workBrowser?: LiveBrowserConfig) {
  if (state.runs.some(run => run.state === "running")) throw new Error("Attendi la fine dell'operazione prima di cambiare le schede di prova");
  if (keys.length > 10 || new Set(keys).size !== keys.length) throw new Error("Scegli al massimo dieci schede distinte per il collaudo");
  const records = testSettings(state, base).records;
  const taxCodes = new Set<string>();
  for (const key of keys) {
    const record = records.find(record => record.key === key);
    if (!record?.eligible) throw new Error("Una scheda selezionata non è disponibile o richiede correzioni");
    for (const owner of record.owners) taxCodes.add(owner.taxCode);
  }
  return validateLiveConfig({ ...base, allowedCadastralKeys: keys, allowedTaxCodes: [...taxCodes], allowCreate: keys.length > 0 && allowCreate }, workBrowser);
}
