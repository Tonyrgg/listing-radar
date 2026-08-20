import { expect, test, type Page } from "@playwright/test";

const baseUrl = process.env.LIFECYCLE_E2E_BASE_URL;
const e2eEmail = process.env.LIFECYCLE_E2E_EMAIL;
const e2ePassword = process.env.LIFECYCLE_E2E_PASSWORD;
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

async function openAuthenticatedRoute(
  page: Page,
  route: (typeof routes)[number] | string,
) {
  let response = await page.goto(`${baseUrl}${route}`, {
    waitUntil: "domcontentloaded",
  });
  if (await page.getByRole("heading", { name: "Accesso privato" }).isVisible()) {
    expect(e2eEmail, "Set LIFECYCLE_E2E_EMAIL for authenticated UI validation.").toBeTruthy();
    expect(
      e2ePassword,
      "Set LIFECYCLE_E2E_PASSWORD for authenticated UI validation.",
    ).toBeTruthy();
    await page.getByLabel("Email").fill(e2eEmail ?? "");
    await page.getByLabel("Password").fill(e2ePassword ?? "");
    await page.getByRole("button", { name: "Entra" }).click();
    await expect(page.getByRole("heading", { name: "Accesso privato" })).toHaveCount(0);
    response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: "domcontentloaded",
    });
  }
  return response;
}

async function expectHealthyRoute(page: Page, route: (typeof routes)[number]) {
  const response = await openAuthenticatedRoute(page, route);
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

  await openAuthenticatedRoute(page, "/lifecycle/agencies");
  const agencyHref = await page.locator('a[href^="/lifecycle/agencies/"]').first().getAttribute("href");
  expect(agencyHref).toBeTruthy();
  const agencyResponse = await openAuthenticatedRoute(page, agencyHref ?? "");
  expect(agencyResponse?.status()).toBe(200);
  await expect(page.locator("h1")).toBeVisible();

  await openAuthenticatedRoute(page, "/lifecycle/archive");
  const propertyHref = await page.locator('a[href^="/lifecycle/archive/"]').first().getAttribute("href");
  expect(propertyHref).toBeTruthy();
  const propertyResponse = await openAuthenticatedRoute(page, propertyHref ?? "");
  expect(propertyResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Timeline completa" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedRoute(page, "/lifecycle");
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForTimeout(650);
  await page.screenshot({ path: testInfo.outputPath("lifecycle-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
