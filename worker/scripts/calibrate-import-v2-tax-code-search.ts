import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import { connectToCrmChrome } from "../src/services/chrome.js";

// A deliberately synthetic value keeps this read-only calibration independent
// from any person's data while exercising the real Lightning search widget.
const calibrationTaxCode = "ZZZZZZ99Z99Z999Z";
const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const originalUrl = page.url();

try {
  const matches = await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(calibrationTaxCode);
  const route = decodeURIComponent(new URL(page.url()).pathname).replace(calibrationTaxCode, "[CF]");
  process.stdout.write(JSON.stringify({ route, verifiedEmpty: matches.length === 0, matchCount: matches.length }));
} finally {
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await tabs.browser.close().catch(() => undefined);
}
