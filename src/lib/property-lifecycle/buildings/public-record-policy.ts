/** Single versioned policy. None of these signals imply a commercial lead or legal conformity. */
export const PUBLIC_RECORD_POLICY = Object.freeze({
  version: "bitonto_public_records_v2", classifierVersion: "territorial_rules_v1", matcherVersion: "official_street_civic_v1",
  alboSource: "comune-bitonto-albo", alboUrl: "https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio",
  requestTimeoutMs: 25_000, maxHtmlBytes: 1_500_000, maxPdfBytes: 8_000_000,
  delayMs: 450, retries: 2, maxPages: 60, deepRotationDays: 7,
  alboIntervalHours: 20, staticIntervalHours: 24 * 7 - 1, recentDays: 90, newSignalDays: 30, // weekly, with scheduling tolerance
  confidence: { explicit: 0.95, contextual: 0.7, building: 0.95, street: 0.65, unknown: 0.4 },
});
export const PRACTICES_2025 = {
  key: "comune-bitonto-elenco-pratiche-2025",
  url: "https://www.opendata.maggioli.cloud/dataset/eec7cd4f-6059-433d-82ee-e09b9f881064/resource/a987f1b8-6c59-4703-bb84-f65fb5f60a6b/download/comune-di-bitonto-elenco-pratiche-edilizie-2025.csv",
};
export const RECORD_TYPES: Record<string, string> = {
  BUILDING_PERMIT: "Permesso di costruire", CILA: "CILA", SCIA: "SCIA", AGIBILITY_SIGNAL: "Segnale di agibilità",
  SANATORIA: "Sanatoria", CONDONO: "Condono", DEMOLITION_ORDER: "Ordinanza di demolizione",
  SAFETY_ORDER: "Ordinanza di sicurezza", PROPERTY_ORDER: "Ordinanza su edificio", OCCUPANCY: "Occupazione e accesso",
  SUAP: "Atto SUAP", URBAN_PLAN: "Piano e cartografia", URBAN_VARIANT: "Variante urbanistica",
  PUBLIC_WORK: "Lavoro pubblico", ROAD_WORK: "Lavoro stradale", VIABILITY: "Viabilità", EXPROPRIATION: "Esproprio",
  HERITAGE: "Tutela e vincoli", DELIBERA: "Delibera", DETERMINA: "Determina", ORDINANZA: "Ordinanza", OTHER: "Altro atto territoriale",
};
export function classifyPublicRecord(text: string, category = "") {
  const rules: Array<[string, RegExp]> = [
    ["DEMOLITION_ORDER", /ordin\w*[^.;]{0,60}demoliz|demoliz\w*[^.;]{0,60}ordin/i],
    ["SAFETY_ORDER", /incolumit|messa in sicurezza|immobile pericolante/i],
    ["SANATORIA", /\bsanatoria\b/i], ["CONDONO", /\bcondono\b/i],
    ["SCIA", /\bSCIA\b|segnalazione certificata.*inizio/i], ["CILA", /\bCILA\b/i],
    ["AGIBILITY_SIGNAL", /\bSCA\b|agibilit|abitabilit/i], ["BUILDING_PERMIT", /permesso (?:di )?costruire/i],
    ["URBAN_VARIANT", /variante urbanistic|variante.{0,20}\b(?:prg|pug)\b/i],
    ["URBAN_PLAN", /piano regolatore|\bPRG\b|\bPUG\b|\bDPP\b|urbanistic/i],
    ["EXPROPRIATION", /espropri/i], ["HERITAGE", /vincolo paesagg|vincolo archeolog|beni culturali/i],
    ["ROAD_WORK", /manomissione.{0,30}(?:suolo|sede)|rete idrica|asfalt|lavori stradal/i],
    ["VIABILITY", /divieto di (?:sosta|circolazione)|prescrizioni alla circolazione|viabilit|senso unico/i],
    ["OCCUPANCY", /occupazione.{0,30}suolo pubblico|accesso carrabile/i],
    ["PUBLIC_WORK", /lavori pubblici|riqualificazione|recupero strutturale|opera pubblica/i], ["SUAP", /\bSUAP\b/i],
  ];
  const hit = rules.find(([, r]) => r.test(text));
  const type = hit?.[0] ?? (/ordinanz/i.test(category) ? "ORDINANZA" : /deliber/i.test(category) ? "DELIBERA" : /determin/i.test(category) ? "DETERMINA" : "OTHER");
  return { type, confidence: hit ? PUBLIC_RECORD_POLICY.confidence.explicit : PUBLIC_RECORD_POLICY.confidence.contextual, version: PUBLIC_RECORD_POLICY.classifierVersion };
}
export function territorialSignalType(type: string) {
  if (["SCIA", "CILA", "BUILDING_PERMIT", "AGIBILITY_SIGNAL", "SANATORIA", "CONDONO"].includes(type)) return "NEW_BUILDING_PRACTICE";
  if (["URBAN_PLAN", "URBAN_VARIANT", "HERITAGE"].includes(type)) return "NEW_URBAN_DOCUMENT";
  if (type === "ROAD_WORK" || type === "VIABILITY") return "NEW_ROAD_WORK";
  if (type === "PUBLIC_WORK") return "NEW_PUBLIC_WORK";
  if (type === "SUAP") return "NEW_SUAP_RECORD";
  return "NEW_PUBLIC_ORDER";
}
