import { connectToCrmChrome } from "../src/services/chrome.js";

const requestedTaxCodes = process.argv.slice(2).map((value) => value.replace(/\s+/g, "").toUpperCase());
if (!requestedTaxCodes.length) throw new Error("Indica almeno un codice fiscale autorizzato");

const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const page = tabs.crmPage;
const originalUrl = page.url();
const results: Array<{
  index: number;
  accountLinks: number;
  detail?: {
    labels: string[];
    inlineEditButtons: number;
    relatedCard: boolean;
    relatedPropertyLinks: number;
    viewAll: boolean;
  };
}> = [];

try {
  for (const [index, taxCode] of requestedTaxCodes.entries()) {
    await page.goto(new URL("/CRMImmobiliareLightning/s/account/Account", page.url()).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const search = page.locator('input[title="Search..."]').filter({ visible: true });
    await search.first().waitFor({ state: "visible", timeout: 15_000 });
    if (await search.count() !== 1) throw new Error(`Barra di ricerca nominativi non univoca (${await search.count()})`);
    await search.fill(taxCode);
    await search.press("Enter");
    await page.waitForURL(/\/s\/global-search\//i, { timeout: 20_000 });
    await page.getByText("Risultati di ricerca", { exact: false }).first()
      .waitFor({ state: "visible", timeout: 20_000 });
    const links = page.locator('a[data-refid="recordId"][data-recordid][href*="/s/account/"]').filter({ visible: true });
    const ids = await links.evaluateAll((elements) => elements.flatMap((element) => {
      const href = element.getAttribute("href") ?? "";
      const match = href.match(/\/s\/account\/([^/?#]+)/i);
      return match?.[1] ? [match[1]] : [];
    }));
    const uniqueIds = [...new Set(ids)];
    const result: (typeof results)[number] = { index, accountLinks: uniqueIds.length };
    if (uniqueIds.length === 1) {
      await page.goto(new URL(`/CRMImmobiliareLightning/s/account/${uniqueIds[0]}`, page.url()).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const labels = (await page.locator("label:visible").allTextContents())
        .map((label) => label.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const relatedCard = page.locator('article:visible:has-text("Immobili/Notizie/Incarichi")');
      result.detail = {
        labels: [...new Set(labels)].sort(),
        inlineEditButtons: await page.locator("button.inline-edit-trigger").filter({ visible: true }).count(),
        relatedCard: await relatedCard.count() === 1,
        relatedPropertyLinks: await relatedCard.locator('a[href*="/s/immobile/"]').filter({ visible: true }).count(),
        viewAll: await relatedCard.getByText("Visualizza tutto", { exact: true }).filter({ visible: true }).count() > 0,
      };
    }
    results.push(result);
  }
  process.stdout.write(JSON.stringify({ checked: results.length, results }));
} finally {
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await tabs.browser.close().catch(() => undefined);
}
