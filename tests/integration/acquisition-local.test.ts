import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Separate opt-in variables keep this fixture from racing with Lifecycle's
// clean-database assertions when the broader integration suite runs in parallel.
const url = process.env.ACQUISITION_TEST_SUPABASE_URL;
const key = process.env.ACQUISITION_TEST_SERVICE_ROLE_KEY;

describe.skipIf(!url || !key)("Acquisition OS on local Supabase", () => {
  it("attaches private price cuts and cross-portal publications to one lead", async () => {
    const db = createClient(url!,key!,{
      auth:{persistSession:false,autoRefreshToken:false},
    });
    const token = randomUUID();
    const location = await db.from("locations").insert({
      raw_text:`Via acquisizione ${token.slice(0,8)}, Mariotto`,
      locality:"Mariotto",municipality:"Bitonto",scope_state:"IN_SCOPE",
    }).select("id").single();
    if (location.error || !location.data) throw new Error(location.error?.message ?? "Missing location");
    const property = await db.from("properties").insert({primary_location_id:location.data.id})
      .select("id").single();
    if (property.error || !property.data) throw new Error(property.error?.message ?? "Missing property");
    const propertyId = property.data.id;

    const listing = await db.from("listings").insert({
      source:"acquisition-test",source_listing_id:token,url:`https://example.invalid/${token}`,
      title:"Privato collaudo",seller_type:"private",price:150000,
    }).select("id").single();
    if (listing.error || !listing.data) throw new Error(listing.error?.message ?? "Missing fixture listing");
    const publication = await db.from("private_publications").insert({
      legacy_listing_id:listing.data.id,property_id:propertyId,source:"acquisition-test",
      source_listing_id:token,canonical_url:`https://example.invalid/${token}`,
      state:"ACTIVE",identity_outcome:"NEW_PROPERTY",title:"Privato collaudo",
      price_amount:150000,first_seen_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString(),content_hash:token,
    }).select("id").single();
    if (publication.error || !publication.data)
      throw new Error(publication.error?.message ?? "Missing private publication");
    const initial = await db.from("acquisition_leads").select("id,locality")
      .eq("property_id",propertyId);
    expect(initial.error).toBeNull();
    expect(initial.data).toHaveLength(1);
    expect(initial.data?.[0].locality).toBe("Mariotto");

    const cut = await db.from("private_publications").update({
      price_amount:140000,last_seen_at:new Date(Date.now()+1000).toISOString(),
    }).eq("id",publication.data.id);
    expect(cut.error).toBeNull();
    const signalAfterCut = await db.from("acquisition_signals").select("signal_type")
      .eq("property_id",propertyId);
    expect(signalAfterCut.error).toBeNull();
    expect(signalAfterCut.data?.map(row=>row.signal_type))
      .toEqual(expect.arrayContaining(["private_publication_new","private_price_drop"]));

    const secondToken = randomUUID();
    const secondListing = await db.from("listings").insert({
      source:"acquisition-test-second",source_listing_id:secondToken,
      url:`https://example.invalid/${secondToken}`,title:"Ripubblicato privato",
      seller_type:"private",price:140000,
    }).select("id").single();
    if (secondListing.error || !secondListing.data)
      throw new Error(secondListing.error?.message ?? "Missing second listing");
    const secondPublication = await db.from("private_publications").insert({
      legacy_listing_id:secondListing.data.id,property_id:propertyId,
      source:"acquisition-test-second",source_listing_id:secondToken,
      canonical_url:`https://example.invalid/${secondToken}`,
      state:"ACTIVE",identity_outcome:"AUTO_MATCH",title:"Ripubblicato privato",
      price_amount:140000,first_seen_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString(),content_hash:secondToken,
    });
    expect(secondPublication.error).toBeNull();
    const leads = await db.from("acquisition_leads").select("id")
      .eq("property_id",propertyId);
    expect(leads.error).toBeNull();
    expect(leads.data).toHaveLength(1);
    const queue = await db.from("acquisition_today_queue").select("id")
      .eq("id",initial.data![0].id);
    expect(queue.error).toBeNull();
    expect(queue.data).toHaveLength(1);
  });
});
