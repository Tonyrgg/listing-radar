/**
 * Nessun link interno lascia l'applicazione.
 * Toglie target="_blank" (e il rel che lo accompagna) dai soli link interni:
 * quelli il cui href comincia con "/" o con un template `/...`.
 *
 *   node scripts/migrate-internal-links.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync('git ls-files "app/**/*.tsx" "src/**/*.tsx"', { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

/* Un elemento JSX che parte da <Link o <a fino alla chiusura del tag di apertura. */
const ELEMENT = /<(Link|a)\s([^>]*?)(\/?)>/gs;

const INTERNAL_HREF = /href=(?:"\/|\{`\/|\{"\/)/;

let touched = 0;
let stripped = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");

  const after = before.replace(ELEMENT, (match, tag, attributes, selfClose) => {
    if (!INTERNAL_HREF.test(`href=${attributes.split("href=")[1] ?? ""}`)) {
      // href non presente o non riconoscibile: lascia stare.
      if (!INTERNAL_HREF.test(match)) return match;
    }

    if (!INTERNAL_HREF.test(match)) return match;
    if (!/target=\{?"_blank"\}?/.test(attributes)) return match;

    const cleaned = attributes
      .replace(/\s*target=\{?"_blank"\}?/g, "")
      .replace(/\s*rel=\{?"noreferrer"\}?/g, "")
      .replace(/\s*rel=\{?"noopener noreferrer"\}?/g, "")
      .replace(/[ \t]+\n/g, "\n");

    stripped += 1;
    return `<${tag} ${cleaned}${selfClose}>`;
  });

  if (after !== before) {
    writeFileSync(file, after);
    touched += 1;
  }
}

console.log(`Rimosso target="_blank" da ${stripped} link interni in ${touched} file.`);
