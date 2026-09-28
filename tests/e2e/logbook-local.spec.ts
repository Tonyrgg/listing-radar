import { expect,test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const base = process.env.ACQUISITION_TEST_BASE_URL;
test.skip(!base,"Set ACQUISITION_TEST_BASE_URL for isolated local validation.");

for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  test(`operational diary and cockpit at ${viewport.width}px`,async ({page})=>{
    await page.setViewportSize(viewport);
    const errors:string[] = [];
    page.on("pageerror",error=>errors.push(error.message));
    for (const route of ["/acquisition/today","/logbook","/logbook/month",
      "/acquisition/stale","/cerca"]) {
      const response = await page.goto(`${base}${route}`);
      expect(response?.status(),route).toBe(200);
      await expect(page.locator("h1")).toBeVisible();
      const overflow = await page.evaluate(()=>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow,`${route} must fit ${viewport.width}px`).toBe(false);
    }
    await page.goto(`${base}/logbook`);
    await page.getByText("+ Registra attività").click();
    await expect(page.locator('select[name="event_type"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("CRM buyer has a person timeline and monthly focus",async ({page})=>{
  const url = process.env.ACQUISITION_TEST_SUPABASE_URL;
  const key = process.env.ACQUISITION_TEST_SERVICE_ROLE_KEY;
  test.skip(!url || !key,"Local service credentials required for isolated buyer fixture.");
  const db = createClient(url!,key!,{auth:{persistSession:false}});
  const name = `Buyer diario ${randomUUID().slice(0,8)}`;
  const person = await db.from("clients").insert({full_name:name,phone:"3331234567"})
    .select("id").single();
  expect(person.error).toBeNull();
  const request = await db.from("property_requests").insert({client_id:person.data!.id,
    title:"Casa da cercare",contract_type:"sale",needs_to_sell_first:"yes"})
    .select("id").single();
  expect(request.error).toBeNull();
  const sellerContact = await db.from("acquisition_contacts").insert({
    full_name:name,client_id:person.data!.id,role:"owner",contact_status:"reviewed",
  }).select("id").single();
  expect(sellerContact.error).toBeNull();
  const sellerLead = await db.from("acquisition_leads").insert({
    contact_id:sellerContact.data!.id,request_id:request.data!.id,
    address:"Via buyer seller 7",locality:"Bitonto",source_type:"buyer_to_seller",
  }).select("id").single();
  expect(sellerLead.error).toBeNull();
  await page.goto(`${base}/contacts/${person.data!.id}`);
  await expect(page.getByRole("heading",{name})).toBeVisible();
  await expect(page.getByRole("link",{name:/Casa da cercare/})).toBeVisible();
  await expect(page.getByRole("link",{name:/Via buyer seller 7/}).first()).toBeVisible();
  await page.getByText("+ Registra attività").click();
  const form = page.locator("details form");
  await form.locator('[name="note"]').fill("Discussa la vendita prima dell'acquisto");
  await Promise.all([
    page.waitForResponse(response=>response.request().method()==="POST"
      && response.url().includes(`/contacts/${person.data!.id}`)),
    form.getByRole("button",{name:"Registra"}).click(),
  ]);
  await page.reload();
  await expect(page.getByText("Discussa la vendita prima dell'acquisto")).toBeVisible();
  await page.getByRole("button",{name:"+ Focus del mese"}).click();
  await page.goto(`${base}/logbook/month`);
  await expect(page.getByRole("link",{name}).first()).toBeVisible();
  await page.goto(`${base}/cerca?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link",{name:new RegExp(name)}).first()).toBeVisible();
});
