import { connectToCrmChrome } from "../src/services/chrome.js";

const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const originalUrl = page.url();
const target = new URL("/CRMImmobiliareLightning/s/immobile/Immobile__c/Default?queryId=a0Q3Y00000cBbmoUAC", page.url()).toString();

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const view = page.locator('input[placeholder="--- Seleziona ---"]').filter({ visible: true }).first();
  await view.waitFor({ state: "visible", timeout: 20_000 });
  const samples: Array<{ elapsedMs: number; value: string; busy: number; options: string[] }> = [];
  for (const elapsedMs of [0, 250, 500, 1_000, 2_000]) {
    if (elapsedMs) await page.waitForTimeout(elapsedMs - samples.at(-1)!.elapsedMs);
    samples.push({
      elapsedMs,
      value: await view.inputValue(),
      busy: await page.locator('lightning-spinner:visible, .slds-spinner:visible, [role="progressbar"]:visible, [aria-busy="true"]:visible').count(),
      options: await page.locator('[role="option"]').filter({ visible: true }).allTextContents(),
    });
  }
  await view.click({ force: true });
  for (const elapsedMs of [2_250, 2_500, 3_000, 4_000, 6_000, 10_000, 14_000]) {
    await page.waitForTimeout(elapsedMs - samples.at(-1)!.elapsedMs);
    samples.push({
      elapsedMs,
      value: await view.inputValue(),
      busy: await page.locator('lightning-spinner:visible, .slds-spinner:visible, [role="progressbar"]:visible, [aria-busy="true"]:visible').count(),
      options: await page.locator('[role="option"]').filter({ visible: true }).allTextContents(),
    });
  }
  process.stdout.write(JSON.stringify({ route: new URL(page.url()).pathname, samples }, null, 2));
} finally {
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await tabs.browser.close().catch(() => undefined);
}
