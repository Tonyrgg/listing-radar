/**
 * Migrazione una tantum dei token di design verso la sorgente unica.
 * Eseguito durante il redesign; conservato per tracciabilità.
 *
 *   node scripts/migrate-design-tokens.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

import { execSync } from "node:child_process";

const files = execSync(
  'git ls-files "app/**/*.tsx" "app/**/*.css" "src/**/*.tsx" "src/**/*.css"',
  { encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

/* I confini di un componente devono restare leggibili (>= 3:1).
 * I divisori interni a una superficie restano decorativi. */
const BOUNDARY = [
  [/\bborder border-\[var\(--line-soft\)\]/g, "border border-[var(--lr-line)]"],
  [/\bborder-\[var\(--line-soft\)\]\s+border\b/g, "border-[var(--lr-line)] border"],
];

const DIVIDER = [
  [/\bborder-(t|b|l|r|y|x)(-\d+)? border-\[var\(--line-soft\)\]/g, "border-$1$2 border-[var(--lr-line-quiet)]"],
  [/\bdivide-\[var\(--line-soft\)\]/g, "divide-[var(--lr-line-quiet)]"],
  [/\bdivide-y divide-\[var\(--line-soft\)\]/g, "divide-y divide-[var(--lr-line-quiet)]"],
];

/* Rinomina generale. L'ordine conta: prima i nomi più lunghi. */
const RENAME = [
  ["--surface-accent-hover", "--lr-accent-hover"],
  ["--surface-accent-soft", "--lr-accent-soft"],
  ["--surface-elevated", "--lr-raised"],
  ["--surface-accent", "--lr-accent"],
  ["--surface-canvas", "--lr-canvas"],
  ["--surface-panel", "--lr-surface"],
  ["--surface-muted", "--lr-raised"],
  ["--surface-strong", "--lr-line"],
  ["--status-warning", "--lr-warn"],
  ["--status-error", "--lr-danger"],
  ["--shadow-panel", "--lr-floating"],
  ["--line-strong", "--lr-line"],
  ["--line-soft", "--lr-line-quiet"],
  ["--button-ink", "--lr-accent-ink"],
  ["--ink-strong", "--lr-ink"],
  ["--ink-subtle", "--lr-ink-3"],
  ["--ink-soft", "--lr-ink-2"],
  ["--focus-ring", "--lr-accent"],
  ["--radar-quiet", "--lr-raised"],
  ["--radar-hot", "--lr-warn"],
  ["--radar-high", "--lr-warn"],
  ["--radar-cool", "--lr-info"],
];

let touched = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;

  for (const [pattern, replacement] of BOUNDARY) after = after.replace(pattern, replacement);
  for (const [pattern, replacement] of DIVIDER) after = after.replace(pattern, replacement);
  for (const [from, to] of RENAME) after = after.split(from).join(to);

  if (after !== before) {
    writeFileSync(file, after);
    touched += 1;
  }
}

console.log(`Token migrati in ${touched} file su ${files.length}.`);
