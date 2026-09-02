import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runTecnocloudV2ReadOnlyDiagnostic } from "../src/import-v2/diagnostics.js";
import { connectToChrome } from "../src/services/chrome.js";

const cdpUrl = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
const outputPath = path.resolve(process.cwd(), "..", ".runtime", "tecnocloud-import-v2-diagnostic.json");
const tabs = await connectToChrome(cdpUrl, "sister", "crmimmobiliarelightning");

try {
  const report = await runTecnocloudV2ReadOnlyDiagnostic(tabs.crmPage);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify({
    outputPath,
    snapshots: report.snapshots.length,
    networkContracts: report.network.length,
  }));
} finally {
  await tabs.browser.close().catch(() => undefined);
}
