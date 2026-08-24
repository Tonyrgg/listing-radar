/**
 * Una sorgente sola di token, servita a tutte e tre le superfici.
 *
 *   src/styles/tokens.css   →   worker/src/desktop/renderer/tokens.css
 *                           →   extension/tokens.css
 *
 * Le copie generate non vanno modificate a mano: `npm run design:sync` le riscrive.
 * `npm run design:check` verifica che siano allineate (usato anche in CI).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "styles", "tokens.css");

const targets = [
  join(root, "worker", "src", "desktop", "renderer", "tokens.css"),
  join(root, "extension", "tokens.css"),
];

const banner = `/* GENERATO DA scripts/sync-design-tokens.mjs — NON MODIFICARE A MANO.
 * La sorgente è src/styles/tokens.css. Rigenera con: npm run design:sync
 */
`;

function build() {
  const tokens = readFileSync(source, "utf8");
  return `${banner}${tokens}`;
}

const checkOnly = process.argv.includes("--check");
const expected = build();
let drifted = false;

for (const target of targets) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;

  if (current === expected) {
    continue;
  }

  if (checkOnly) {
    console.error(`Token disallineati: ${target}`);
    drifted = true;
    continue;
  }

  writeFileSync(target, expected);
  console.log(`Aggiornato ${target}`);
}

if (checkOnly) {
  if (drifted) {
    console.error("\nEsegui `npm run design:sync` e ricommitta le copie generate.");
    process.exit(1);
  }

  console.log("Token allineati su tutte e tre le superfici.");
}
