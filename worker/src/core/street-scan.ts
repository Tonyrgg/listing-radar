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
