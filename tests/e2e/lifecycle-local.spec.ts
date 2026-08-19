import { expect, test, type Page } from "@playwright/test";

const baseUrl = process.env.LIFECYCLE_E2E_BASE_URL;
const routes = [
  "/lifecycle",
  "/lifecycle/opportunities",
  "/lifecycle/agencies",
  "/lifecycle/archive",
  "/lifecycle/review",
  "/lifecycle/private",
] as const;

test.skip(!baseUrl, "Set LIFECYCLE_E2E_BASE_URL to validate the local Lifecycle workspace.");

function captureRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectHealthyRoute(page: Page, route: (typeof routes)[number]) {
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  expect(response?.status(), route).toBe(200);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(`a[aria-current="page"][href="${route}"]`)).toBeVisible();
  await expect(page.getByText("Dati Lifecycle non caricati")).toHaveCount(0);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow, `${route} should not overflow the viewport`).toBe(false);
}

test("renders every Lifecycle surface on desktop without runtime errors", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = captureRuntimeErrors(page);
  for (const route of routes) await expectHealthyRoute(page, route);
  expect(errors).toEqual([]);
});

test("keeps every Lifecycle surface usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = captureRuntimeErrors(page);
  for (const route of routes) await expectHealthyRoute(page, route);
  expect(errors).toEqual([]);
});

test("opens agency and physical-property dossiers", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = captureRuntimeErrors(page);

  await expectHealthyRoute(page, "/lifecycle");
  await page.waitForTimeout(650);
  await page.screenshot({ path: testInfo.outputPath("lifecycle-desktop.png"), fullPage: true });

  await page.goto(`${baseUrl}/lifecycle/agencies`, { waitUntil: "domcontentloaded" });
  const agencyHref = await page.locator('a[href^="/lifecycle/agencies/"]').first().getAttribute("href");
  expect(agencyHref).toBeTruthy();
  const agencyResponse = await page.goto(`${baseUrl}${agencyHref}`, { waitUntil: "domcontentloaded" });
  expect(agencyResponse?.status()).toBe(200);
  await expect(page.locator("h1")).toBeVisible();

  await page.goto(`${baseUrl}/lifecycle/archive`, { waitUntil: "domcontentloaded" });
  const propertyHref = await page.locator('a[href^="/lifecycle/archive/"]').first().getAttribute("href");
  expect(propertyHref).toBeTruthy();
  const propertyResponse = await page.goto(`${baseUrl}${propertyHref}`, { waitUntil: "domcontentloaded" });
  expect(propertyResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Timeline completa" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/lifecycle`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForTimeout(650);
  await page.screenshot({ path: testInfo.outputPath("lifecycle-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
