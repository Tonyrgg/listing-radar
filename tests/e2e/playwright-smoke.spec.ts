import { expect, test } from "@playwright/test";

test("Chromium launches and loads a known-safe page", async ({ page }) => {
  await page.goto("data:text/html,<title>Listing Radar smoke</title><main>ready</main>");

  await expect(page).toHaveTitle("Listing Radar smoke");
  await expect(page.locator("main")).toHaveText("ready");
});
