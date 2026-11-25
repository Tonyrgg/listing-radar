export type SisterStreetVariant = {
  key: string;
  value: string;
  text: string;
  sourceId: string;
  occurrence: number;
};

export function normalizeSisterStreet(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function splitSisterStreetInput(
  input: string,
  toponyms: Array<{ text: string; value: string }>,
): { requestedStreet: string; toponymValue: string; toponymText: string; addressText: string } {
  const requestedStreet = normalizeSisterStreet(input);
  if (!requestedStreet) throw new Error("Inserisci una via precisa");

  const candidates = toponyms
    .map((item) => ({ ...item, normalized: normalizeSisterStreet(item.text) }))
    .filter((item) => item.normalized && item.normalized !== "TUTTI")
    .filter((item) => requestedStreet === item.normalized || requestedStreet.startsWith(`${item.normalized} `))
    .sort((left, right) => right.normalized.length - left.normalized.length);
  const selected = candidates[0];
  if (selected) {
    const addressText = requestedStreet.slice(selected.normalized.length).trim();
    if (!addressText) throw new Error("Il nome della via è incompleto");
    return {
      requestedStreet,
      toponymValue: selected.value,
      toponymText: selected.normalized,
      addressText,
    };
  }

  const all = toponyms.find((item) => normalizeSisterStreet(item.text) === "TUTTI");
  if (!all) throw new Error("Toponimo TUTTI non disponibile nella pagina SISTER");
  return { requestedStreet, toponymValue: all.value, toponymText: "TUTTI", addressText: requestedStreet };
}

export function exactStreetVariants(
  requestedStreet: string,
  options: Array<{ text: string; value: string }>,
): SisterStreetVariant[] {
  const requested = normalizeSisterStreet(requestedStreet);
  const occurrences = new Map<string, number>();
  return options.flatMap((option) => {
    if (normalizeSisterStreet(option.text) !== requested) return [];
    const sourceId = option.value.split("#", 1)[0]?.trim() || option.value;
    const occurrence = (occurrences.get(sourceId) ?? 0) + 1;
    occurrences.set(sourceId, occurrence);
    return [{
      key: `${sourceId}:${occurrence}`,
      value: option.value,
      text: option.text.trim(),
      sourceId,
      occurrence,
    }];
  });
}

const streetAliases: Record<string, string> = {
  "VIA ACQUAFREDDA": "VIA VITO ACQUAFREDDA",
  "PIAZZA CADUTI TERRORISMO": "PIAZZA CADUTI DEL TERRORISMO",
  "LARGO CALDAROLA": "LARGO ORONZO CALDAROLA",
};

function streetAlias(name: string) {
  const normalized = normalizeSisterStreet(name).replace(/^LARGO (?:MONS|MONSIGNOR|MONSIGNORE) /, "LARGO ");
  return streetAliases[normalized] ?? normalized;
}

/** Choose a whole address label. A common search word is never proof of identity. */
export function matchingStreetVariants(requested: string, options: Array<{ text: string; value: string }>) {
  const exact = exactStreetVariants(requested, options);
  if (exact.length) return exact;
  const labels = new Set(options.filter(option => option.value && streetAlias(option.text) === streetAlias(requested))
    .map(option => normalizeSisterStreet(option.text)));
  return labels.size === 1 ? exactStreetVariants([...labels][0]!, options) : [];
}

export function sisterStreetKeywords(address: string) {
  const ignored = new Set(["DEL", "DEI", "DELLE", "DELLA", "DEGLI", "MONS", "MONSIGNOR", "MONSIGNORE",
    "VIA", "LARGO", "PIAZZA", "PIAZZALE", "VIALE", "CORSO", "VICO", "TRAVERSA", "CONTRADA", "STRADA", "TRAV"]);
  return [...new Set(normalizeSisterStreet(address).split(" ").reverse()
    .filter(word => word.length >= 3 && /[A-Z]/.test(word) && !/^[IVXLCDM]+$/.test(word) && !ignored.has(word)))];
}

export function updateVerifiedEmptyCounters(
  counters: Record<string, number>,
  variantKey: string,
  outcome: "empty" | "found" | "failed",
): Record<string, number> {
  return {
    ...counters,
    [variantKey]: outcome === "empty" ? (counters[variantKey] ?? 0) + 1 : 0,
  };
}

export function hasReachedStreetEnd(
  variants: SisterStreetVariant[],
  counters: Record<string, number>,
  emptyWindow: number,
): boolean {
  return variants.length > 0 && variants.every((variant) => (counters[variant.key] ?? 0) >= emptyWindow);
}

export function shouldStopStreetRun(
  variants: SisterStreetVariant[],
  counters: Record<string, number>,
  emptyWindow: number,
  currentVariantIndex: number,
): boolean {
  return currentVariantIndex === 0 && hasReachedStreetEnd(variants, counters, emptyWindow);
}
