import { connectToCrmChrome } from "../src/services/chrome.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

const birthPlace = process.argv[2]?.trim() || "BITONTO";
const birthProvince = process.argv[3]?.trim() || "BA";

const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const originalUrl = page.url();

try {
  await page.goto(new URL("/CRMImmobiliareLightning/s/account/Account", page.url()).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const launcher = page.locator("c-spotlight .icon_container").filter({ visible: true });
  await launcher.first().waitFor({ state: "visible", timeout: 15_000 });
  if (await launcher.count() !== 1) throw new Error(`Comando Nuovo non univoco (${await launcher.count()})`);
  await launcher.click();
  const personItem = page.locator('c-spotlight li.element:has-text("Nominativo")').filter({ visible: true });
  await personItem.first().waitFor({ state: "visible", timeout: 10_000 });
  if (await personItem.count() !== 1) throw new Error(`Voce Nominativo non univoca (${await personItem.count()})`);
  await personItem.click();

  const firstName = page.locator('.slds-form-element:has(label:text-is("Nome")) input').filter({ visible: true });
  await firstName.first().waitFor({ state: "visible", timeout: 15_000 });
  const save = page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true });
  const labels = (await page.locator("label:visible").allTextContents())
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const controls = await page.locator("input:visible, textarea:visible, select:visible").evaluateAll((elements) => elements.map((element) => ({
    tag: element.tagName.toLowerCase(),
    type: element.getAttribute("type"),
    role: element.getAttribute("role"),
    placeholder: element.getAttribute("placeholder"),
    labels: element instanceof HTMLInputElement
      ? Array.from(element.labels ?? []).map((label) => (label.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)
      : [],
  })));
  const birthComponent = page.locator('c-lookup:has(label:text-is("Luogo Di Nascita"))').filter({ visible: true });
  const birthInput = birthComponent.locator('input[placeholder="Cerca"]').filter({ visible: true });
  const port = new TecnocloudUiV2Port(page);
  await (port as unknown as { fillBirthPlace(value: string, province: string | null): Promise<void> })
    .fillBirthPlace(birthPlace, birthProvince);
  const birthOptions = birthComponent.locator('[role="option"]').filter({ visible: true });
  const birthSelection = {
    value: await birthInput.inputValue(),
    readonly: await birthInput.getAttribute("readonly") !== null,
    hasSelectionClass: await birthComponent.locator(".slds-combobox_container.slds-has-selection").count() === 1,
    optionCountAfterClick: await birthOptions.count(),
  };
  process.stdout.write(JSON.stringify({ route: new URL(page.url()).pathname, labels: [...new Set(labels)].sort(), controls, saveButtons: await save.count(), expectedBirthPlace: birthPlace, expectedBirthProvince: birthProvince, birthSelection }));
} finally {
  const cancel = page.getByRole("button", { name: "Annulla", exact: true }).filter({ visible: true });
  if (await cancel.count() === 1) await cancel.click().catch(() => undefined);
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await tabs.browser.close().catch(() => undefined);
}
