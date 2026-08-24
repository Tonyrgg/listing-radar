/**
 * Verifica che la palette rispetti le soglie dichiarate in DESIGN.md.
 * Legge i valori direttamente da src/styles/tokens.css, così il documento
 * e il codice non possono più divergere in silenzio.
 *
 *   npm run design:check
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src", "styles", "tokens.css"), "utf8");

function readBlock(selector) {
  const index = css.indexOf(selector);
  if (index === -1) throw new Error(`Blocco non trovato: ${selector}`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

function readTokens(block) {
  const tokens = {};
  for (const match of block.matchAll(/(--lr-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function channels(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return (high + 0.05) / (low + 0.05);
}

/* Le regole del sistema, in forma eseguibile.
 * Le superfici restano vicine: è la linea a separarle, e per questo deve
 * rispettare la soglia dei confini di WCAG 1.4.11. */
const RULES = [
  ["--lr-surface", "--lr-canvas", 1.2, "canvas / superficie"],
  ["--lr-raised", "--lr-surface", 1.2, "superficie / rialzata"],
  ["--lr-line", "--lr-surface", 3, "linea su superficie"],
  ["--lr-line", "--lr-canvas", 3, "linea su canvas"],
  ["--lr-ink", "--lr-surface", 4.5, "testo forte"],
  ["--lr-ink-2", "--lr-surface", 4.5, "testo corrente"],
  ["--lr-ink-3", "--lr-surface", 4.5, "metadato su superficie"],
  ["--lr-ink-3", "--lr-raised", 4.5, "metadato su rialzata"],
  ["--lr-accent", "--lr-surface", 4.5, "accento"],
  ["--lr-accent-ink", "--lr-accent", 4.5, "testo sul bottone primario"],
  ["--lr-warn", "--lr-surface", 4.5, "attenzione"],
  ["--lr-danger", "--lr-surface", 4.5, "critico"],
  ["--lr-info", "--lr-surface", 4.5, "informativo"],
];

const themes = [
  ["scuro", readTokens(readBlock(":root {"))],
  ["chiaro", readTokens(readBlock(':root[data-theme="light"]'))],
];

let failures = 0;

for (const [name, tokens] of themes) {
  console.log(`\n=== tema ${name} ===`);

  for (const [foreground, background, minimum, label] of RULES) {
    const first = tokens[foreground];
    const second = tokens[background];

    if (!first || !second) {
      console.error(`  ?      manca un token per «${label}»`);
      failures += 1;
      continue;
    }

    const ratio = contrast(first, second);
    const ok = ratio + 1e-9 >= minimum;
    if (!ok) failures += 1;

    console.log(
      `  ${ok ? "OK" : "NO"}  ${ratio.toFixed(2).padStart(6)}  (min ${minimum})  ${label}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} soglie non rispettate. La palette non può essere pubblicata così.`);
  process.exit(1);
}

console.log("\nTutte le soglie rispettate in entrambi i temi.");
