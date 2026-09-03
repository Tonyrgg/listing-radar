import os from "node:os";
import path from "node:path";

import { connectToCrmChrome } from "../src/services/chrome.js";

const mask = (value: string) => value
  .replace(/\b[A-Z0-9]{16}\b/gi, "[CF]")
  .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[EMAIL]")
  .replace(/\b(?:\+?39\s*)?(?:\d[\s.-]*){8,12}\b/g, "[TELEFONO]")
  .replace(/\b(?:001)?[A-Z0-9]{15,18}\b/gi, "[ID]");

const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const screenshotPath = path.join(os.tmpdir(), "listing-radar-live-crm.png");

try {
  const dialogs = page.locator('[role="dialog"]').filter({ visible: true });
  const headings = await page.locator("h1:visible, h2:visible, h3:visible").allTextContents();
  const buttons = await page.locator("button:visible").allTextContents();
  const alerts = await page.locator('[role="alert"]:visible, .slds-notify_toast:visible').allTextContents();
  const controls = await page.locator("input:visible, textarea:visible, select:visible").evaluateAll((elements) => elements.map((element) => ({
    tag: element.tagName.toLowerCase(),
    title: element.getAttribute("title"),
    placeholder: element.getAttribute("placeholder"),
    readonly: element.hasAttribute("readonly"),
    hasValue: "value" in element && String((element as HTMLInputElement).value ?? "").length > 0,
  })));
  const lookups = await page.locator('c-lookup:visible').evaluateAll((elements) => elements.map((element) => {
    const input = element.querySelector('input[placeholder="Cerca"]') as HTMLInputElement | null;
    const options = Array.from(element.querySelectorAll('[role="option"]')).map((option) => ({
      tag: option.tagName.toLowerCase(),
      selected: option.getAttribute('aria-selected'),
      selfRecordId: option.getAttribute('data-item-id') ?? option.getAttribute('data-recordid') ?? option.getAttribute('data-id'),
      descendantTag: option.querySelector('[data-item-id], [data-recordid], [data-id]')?.tagName.toLowerCase() ?? null,
    }));
    return {
      label: element.querySelector('label')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      valueLength: input?.value.length ?? 0,
      readonly: input?.hasAttribute('readonly') ?? false,
      selectionClass: element.querySelectorAll('.slds-combobox_container.slds-has-selection').length,
      options,
    };
  }));
  await page.screenshot({ path: screenshotPath, fullPage: false });
  process.stdout.write(JSON.stringify({
    route: mask(decodeURIComponent(new URL(page.url()).pathname)),
    title: mask(await page.title()),
    dialogCount: await dialogs.count(),
    headings: headings.map(mask).filter(Boolean),
    buttons: buttons.map(mask).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean),
    alerts: alerts.map(mask).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean),
    controls,
    lookups,
    busy: await page.locator('lightning-spinner:visible, .slds-spinner:visible, [role="progressbar"]:visible, [aria-busy="true"]:visible').count(),
    screenshotPath,
  }, null, 2));
} finally {
  await tabs.browser.close().catch(() => undefined);
}
