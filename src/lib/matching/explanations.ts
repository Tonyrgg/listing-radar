import type { MatchClassification } from "./types";

const labels: Record<MatchClassification, string> = {
  compatible: "Compatibile",
  almost_compatible: "Quasi compatibile",
  weak: "Compatibilità debole",
  not_relevant: "Poco pertinente",
};

export function buildExplanation(
  score: number,
  classification: MatchClassification,
  matched: string[],
  missing: string[],
  conflicts: string[],
) {
  const parts = [`Compatibilità ${score}% — ${labels[classification]}.`];
  if (matched.length) parts.push(`Rispetta: ${matched.join(", ")}.`);
  if (conflicts.length) parts.push(`Conflitti: ${conflicts.join(", ")}.`);
  if (missing.length) parts.push(`Preferenze mancanti: ${missing.join(", ")}.`);
  return parts.join(" ");
}

