export async function streetSearchReady(page) {
  await page.waitForFunction(() => Boolean(window.territory && document.querySelector("#search") && !document.querySelector("#search").disabled));
}
export async function selectStreet(page, street) {
  await page.locator("#search").fill(street.name);
  await page.locator(`[data-street="${street.id}"]`).click();
  await page.locator(`#hover [data-open="${street.id}"]`).waitFor();
}
export async function openStreet(page, street) {
  await selectStreet(page, street);
  await page.locator(`#hover [data-open="${street.id}"]`).click();
  await page.locator("#detail-dialog[open]").waitFor();
}
export async function openStreetSettings(page) {
  const settings = page.locator(".street-settings");
  if (!await settings.evaluate(element => element.open)) await settings.locator(":scope > summary").click();
}
