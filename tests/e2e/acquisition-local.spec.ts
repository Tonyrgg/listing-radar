import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.ACQUISITION_TEST_BASE_URL;
const email = process.env.ACQUISITION_TEST_EMAIL;
const password = process.env.ACQUISITION_TEST_PASSWORD;

function romeInput(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replace(" ", "T");
}

test("manual sign to today queue, follow-up, acquisition and mandate", async ({page}) => {
  test.skip(!baseUrl, "Set ACQUISITION_TEST_BASE_URL for isolated local Supabase validation.");
  const address = `Via collaudo ${randomUUID().slice(0,8)}`;
  await page.goto(`${baseUrl}/acquisition`);
  if (await page.getByRole("heading",{name:"Accesso privato"}).isVisible()) {
    expect(email,"Set ACQUISITION_TEST_EMAIL for authenticated validation.").toBeTruthy();
    expect(password,"Set ACQUISITION_TEST_PASSWORD for authenticated validation.").toBeTruthy();
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button",{name:"Entra"}).click();
    await expect(page.getByRole("heading",{name:"Accesso privato"})).toHaveCount(0);
    await page.goto(`${baseUrl}/acquisition`);
  }
  const quickAdd = page.locator("form").filter({has:page.getByRole("heading",{name:"Quick Add"})});
  await quickAdd.locator('[name="address"]').fill(address);
  await quickAdd.locator('[name="locality"]').selectOption("Palombaio");
  await quickAdd.locator('[name="source_type"]').selectOption("private_sign");
  await quickAdd.locator('[name="signal_type"]').fill("cartello vendesi");
  await quickAdd.locator('[name="contact_name"]').fill("Proprietario collaudo");
  await quickAdd.locator('[name="contact_phone"]').fill("0800000000");
  await quickAdd.locator('[name="priority"]').selectOption("A");
  await quickAdd.locator('[name="next_action_type"]').fill("phone_call");
  await quickAdd.locator('[name="next_action_at"]').fill(romeInput(new Date(Date.now()-3600000)));
  await quickAdd.getByRole("button",{name:"Registra notizia"}).click();
  await expect(page).toHaveURL(/\/acquisition\/[0-9a-f-]+$/);
  const leadUrl = page.url();
  await expect(page.getByRole("heading",{name:address})).toBeVisible();

  await page.goto(`${baseUrl}/acquisition/today`);
  await expect(page.getByText(address)).toBeVisible();
  await page.goto(leadUrl);

  const activity = page.locator("form").filter({has:page.getByRole("heading",{name:"Registra attività"})});
  await activity.locator('[name="activity_type"]').selectOption("phone_call");
  await activity.locator('[name="outcome"]').selectOption("conversation");
  await activity.locator('[name="next_action_type"]').fill("follow_up");
  await activity.locator('[name="next_action_at"]').fill(romeInput(new Date(Date.now()+86400000)));
  await activity.getByRole("button",{name:"Registra"}).click();
  await expect(page.locator("main > header")).toContainText("FOLLOW_UP");
  await expect(page.locator("section").filter({has:page.getByRole("heading",{name:"Timeline"})}))
    .toContainText("phone_call");

  const booking = page.locator("form").filter({has:page.getByRole("button",{name:"Fissa acquisizione"})});
  await booking.locator('[name="scheduled_at"]').fill(romeInput(new Date(Date.now()+86400000)));
  await booking.locator('[name="motivation"]').fill("Vendita dichiarata");
  await booking.getByRole("button",{name:"Fissa acquisizione"}).click();
  await expect(page.locator("main > header")).toContainText("ACQUISITION_BOOKED");

  const completion = page.locator("form").filter({has:page.getByRole("button",{name:"Registra esito"})});
  await completion.locator('[name="outcome"]').selectOption("mandate");
  await completion.getByRole("button",{name:"Registra esito"}).click();
  await expect(page.locator("main > header")).toContainText("WON");
  await page.goto(`${baseUrl}/acquisition/kpi`);
  await expect(page.getByText("Incarichi",{exact:true})).toBeVisible();
});
