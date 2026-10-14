import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { parseExternalHtml, publicationIdentity, verifyExternalPublication } from "@/lib/property-lifecycle/external/adapters";
import { ExternalPublicHttp } from "@/lib/property-lifecycle/external/http";
import manifest from "../fixtures/property-lifecycle/external/remax/manifest.json";

async function fixture(id = "crocifisso") { return readFile(`tests/fixtures/property-lifecycle/external/remax/${id}.html`, "utf8"); }
function rewrite(html: string, change: (listing: Record<string, unknown>) => void) {
  const $ = load(html);
  $("script[type='application/ld+json']").each((_,el) => {
    const node=JSON.parse($(el).text()); if(node["@type"]==="RealEstateListing") { change(node); $(el).text(JSON.stringify(node)); }
  }); return $.html();
}
const reference = manifest[0];
describe("RE/MAX primary public evidence with real sanitized HTML", () => {
  it.each(manifest)("parses real primary capture $id with independent provenance",async capture => {
    const result=parseExternalHtml("REMAX",await fixture(capture.id),capture.url,capture.observedAt);
    expect(result.listing.source.agencyReference).toBe(publicationIdentity("REMAX",capture.url));
    expect(result.listing.commercial.priceAmount).toBe(capture.fields.price);
    expect(result.listing.source.portalPublishedAt).toBe(capture.fields.published);
    expect(result.listing.location.scope).toBe("IN_SCOPE");
    expect(result.agency.name).toBe(capture.fields.agency);
    expect(result.agent?.name).toBe(capture.fields.agent);
    expect(result.listing.assets.length).toBe(capture.fields.images);
    expect(result.claims.every(claim=>claim.metadata.source==="REMAX"&&claim.sourceUrl===capture.url)).toBe(true);
    expect(result.listing.location.precision).not.toBe("EXACT_COORDINATES");
  });
  it("keeps publication, modification, observation and price dates distinct",async()=>{
    const result=parseExternalHtml("REMAX",await fixture(),reference.url,reference.observedAt);
    expect(result.listing.source.portalModifiedAt).toBe("2026-09-22T00:00:00.000Z");
    expect(result.claims.find(c=>c.kind==="PRICE")?.sourceRecordedAt).toBeNull();
    expect(result.claims.find(c=>c.kind==="AGENT_IDENTITY")?.normalizedValue).toMatchObject({name:"Nicola Sicolo"});
    expect(JSON.stringify(result)).not.toContain("estimatedAcquisitionAt");
  });
  it("SoldOut is unavailability evidence, never a confirmed property sale",async()=>{
    const html=rewrite(await fixture(),listing=>{(listing.offers as Record<string,unknown>).availability="https://schema.org/SoldOut";});
    const result=parseExternalHtml("REMAX",html,reference.url,reference.observedAt);
    expect(result.listing.status.value).toBe("REMOVED"); expect(result.listing.source.soldAt).toBeNull();
    expect(result.claims.some(c=>c.kind==="SOLD_EXPLICIT")).toBe(false);
    expect(result.warnings).toContain("schema_soldout_is_not_sale_evidence");
  });
  it.each(["Venduto","Venduto il 12/02/2025","In trattativa"])("requires an explicit listing field for %s",async label=>{
    const html=(await fixture()).replace("</body>",`<main><span data-testid="listing-status">${label}</span></main></body>`);
    const result=parseExternalHtml("REMAX",html,reference.url,reference.observedAt);
    expect(result.listing.status.value).toBe(label==="In trattativa"?"NEGOTIATION":"SOLD");
    expect(result.listing.source.soldAt).toBe(label.includes("12/02/2025")?"2025-02-12T00:00:00.000Z":null);
  });
  it.each(["canonical","listing_url","locality","transaction","currency"])("rejects contradictory %s primary identity",async field=>{
    let html=await fixture();
    if(field==="canonical") html=html.replace(`href="${reference.url}"`,'href="https://stella-polare.remax.it/other"');
    else html=rewrite(html,listing=>{
      if(field==="listing_url") listing.url="https://stella-polare.remax.it/another-property";
      if(field==="locality") (listing.address as Record<string,unknown>).addressLocality="Modugno";
      if(field==="transaction") (listing.offers as Record<string,unknown>).businessFunction="https://schema.org/LeaseOut";
      if(field==="currency") (listing.offers as Record<string,unknown>).priceCurrency="USD";
    });
    expect(()=>parseExternalHtml("REMAX",html,reference.url,reference.observedAt)).toThrow();
  });
  it("never invents a provider or agent from related cards when primary fields are missing",async()=>{
    const html=rewrite(await fixture(),listing=>{delete listing.provider;delete listing.realEstateAgent;});
    const result=parseExternalHtml("REMAX",html,reference.url,reference.observedAt);
    expect(result.agency.name).toBeNull();expect(result.agent).toBeNull();
  });
  it("keeps malformed/future date claims out of derived dates",async()=>{
    const html=rewrite(await fixture(),listing=>{listing.datePosted="2027-01-01";});
    const result=parseExternalHtml("REMAX",html,reference.url,reference.observedAt);
    expect(result.listing.source.portalPublishedAt).toBeNull();expect(result.warnings).toContain("invalid_publication_date");
  });
  it("does not fetch outside the scoped known-publication contract",async()=>{
    const fetcher=vi.fn(); const http=new ExternalPublicHttp(fetcher,async()=>{});
    await expect(verifyExternalPublication(http,"REMAX","https://stella-polare.remax.it/vendita-appartamento/modugno/centro-123-4",reference.observedAt)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
