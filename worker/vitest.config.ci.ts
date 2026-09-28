import { defineConfig } from "vitest/config";

/**
 * Configurazione per la CI.
 *
 * I test elencati qui sotto lanciano Chrome reale con `channel: "chrome"`,
 * decine di istanze per file. Su un runner GitHub non si limitano a essere
 * lenti: restano appesi finche' il job non scade. Non sono test da CI, sono
 * test da macchina di lavoro, dove Chrome e' quello che il worker usa davvero.
 *
 * In CI vengono quindi esclusi, e la loro esecuzione resta parte della verifica
 * su macchina pulita prevista prima di una release. Chi aggiunge un nuovo test
 * che apre un browser deve aggiungerlo a questa lista.
 */
const browserBackedTests = [
  "tests/adapters.test.ts",
  "tests/chrome-tab-driveability.test.ts",
  "tests/crm-person-seeds.test.ts",
  "tests/import-v2-collapsed-merge.test.ts",
  "tests/import-v2-filter-drawer.test.ts",
  "tests/import-v2-person-search.test.ts",
  "tests/import-v2-tecnocloud-ui-port.test.ts",
  "tests/import-v2-workflows.test.ts",
  "tests/mandates.test.ts",
  "tests/portoni.test.ts",
  "tests/requests.test.ts",
  "tests/sister-keepalive.test.ts",
  "tests/sister-owner-expansion.test.ts",
  "tests/sister-physical-person-navigation.test.ts",
  "tests/sister-street-run.test.ts",
];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", ...browserBackedTests],
  },
});
