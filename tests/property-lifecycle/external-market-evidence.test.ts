import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { fetchWikicasaInventory, historicalEvidence, normalizeExternalFacts, parseExternalHtml, publicationIdentity, type ExternalFacts } from "@/lib/property-lifecycle/external/adapters";
import { ExternalPublicHttp } from "@/lib/property-lifecycle/external/http";
import { detailRequired, evidenceIdentity, explicitDate, EXTERNAL_POLICY } from "@/lib/property-lifecycle/external/policy";
import { normalizedAgencyName } from "@/lib/property-lifecycle/external/runtime";
import { identityObservationFromListing } from "@/lib/property-lifecycle/persistence/repository";
import { decidePropertyIdentity } from "@/lib/property-lifecycle/identity/scoring";
import { decideExternalPropertyIdentity, externalReviewResolution } from "@/lib/property-lifecycle/external/identity";
import { lifecycleRetryDelayMs } from "@/lib/property-lifecycle/jobs/queue";
import real from "../fixtures/property-lifecycle/external/real-retrieval-facts.json";

const base = real.facts[0] as ExternalFacts;
function facts(overrides: Partial<ExternalFacts> = {}) { return normalizeExternalFacts({ ...base, method: "PRIMARY_HTTP", ...overrides }); }
// Synthetic DOM contract cases, deliberately NOT described as live portal HTML.
function inventory(ids: string[], total: number, next: string | null = null) {
  return `<html><head><link rel="canonical" href="https://www.wikicasa.it/vendita-case/bitonto/"></head><body><main>
    <p data-testid="results-count">${total} annunci</p>${ids.map(id => `<article><a href="/annuncio/${id}">Bitonto €155.000</a></article>`).join("")}
    ${next ? `<a rel="next" href="${next}">Avanti</a>` : ""}</main></body></html>`;
}
const response = (body: string, status = 200, extra: Record<string,string> = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...extra } });

describe("External Market Evidence policy and real retrieval facts", () => {
  it.each(real.facts)("preserves source identity and provenance $externalId", entry => {
    const observed = normalizeExternalFacts(entry as ExternalFacts);
    expect(observed.listing.source.externalId).toBe(entry.externalId);
    expect(observed.claims.every(c => c.metadata.source === entry.source && c.confidence <= 0.65)).toBe(true);
    expect(observed.claims.every(c => c.metadata.currentPresence === false)).toBe(true);
  });
  it("retains Crocifisso first publication and previous asking without inventing change date", () => {
    const result = facts();
    expect(result.listing.source.portalPublishedAt).toBe("2026-05-05T00:00:00.000Z");
    expect(result.listing.observedAt).toBe(base.observedAt);
    expect(result.claims.find(c => c.kind === "PRICE_HISTORY")?.normalizedValue).toMatchObject({ amount: 225000, currentAmount: 195000, changeDate: null, datePrecision: "UNKNOWN" });
    expect(result.claims.find(c => c.kind === "PRICE_HISTORY")?.sourceRecordedAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain("estimatedAcquisitionAt");
  });
  it("distinguishes the Immobiliare update claim from the price change", () => {
    const result = normalizeExternalFacts(real.facts[1] as ExternalFacts);
    expect(result.listing.source.portalPublishedAt).toBeNull();
    expect(result.listing.source.portalModifiedAt).toBe("2026-09-22T00:00:00.000Z");
    expect(result.claims.find(c => c.kind === "PRICE_HISTORY")?.sourceRecordedAt).toBeNull();
  });
  it.each(["31/02/2026", "32 mag 2026", "13/13/2026", "2026-11-01", "2026-05-05Tnot-an-instant", "not a date"])("rejects malformed/future date %s", raw => {
    expect(explicitDate(raw, base.observedAt)).toBeNull();
    expect(facts({ publishedLabel: raw }).warnings).toContain("invalid_publication_date");
    expect(facts({ publishedLabel: raw }).claims.find(c=>c.kind==="PORTAL_PUBLICATION_DATE"))
      .toMatchObject({rawValue:raw,sourceRecordedAt:null,confidence:EXTERNAL_POLICY.confidence.invalidClaim,metadata:{interpretation:"REVIEW_REQUIRED"}});
  });
  it("supports full Italian month labels and preserves day precision", () => {
    expect(explicitDate("4 Agosto 2026", base.observedAt)).toBe("2026-08-04T00:00:00.000Z");
    expect(facts().claims.find(c => c.kind === "PORTAL_PUBLICATION_DATE")?.metadata.precision).toBe("DAY");
  });
  it("retains contradictory dates and lowers the incompatible modified claim", () => {
    const result = facts({ modifiedLabel: "01/05/2026" });
    expect(result.claims.filter(c => c.kind.startsWith("PORTAL_")).length).toBe(2);
    expect(result.warnings).toContain("modified_precedes_publication");
    expect(result.claims.find(c => c.kind === "PORTAL_MODIFIED_DATE")?.confidence).toBeCloseTo(0.75);
  });
  it("recognizes explicit sold date from the real Bitonto example", () => {
    const result = normalizeExternalFacts({ ...real.facts[6], method: "PRIMARY_HTTP" } as ExternalFacts);
    expect(result.listing.status.value).toBe("SOLD");
    expect(result.listing.source.soldAt).toBe("2025-02-12T00:00:00.000Z");
    expect(result.claims.find(c => c.claimKey === "publication.soldAt")?.confidence).toBe(0.95);
  });
  it("sold without date retains only the observation date", () => {
    const result = facts({ statusLabel: "Venduto" });
    expect(result.listing.status.value).toBe("SOLD"); expect(result.listing.source.soldAt).toBeNull();
    expect(result.claims.find(c => c.kind === "SOLD_EXPLICIT")?.normalizedValue).toMatchObject({ soldAt: null });
    expect(result.claims.find(c => c.kind === "SOLD_EXPLICIT")?.observedAt).toBe(base.observedAt);
  });
  it.each(["Venduto il 31/02/2026","Venduto il 31/12/2026"])("retains invalid/future sold claim for review without confirming sale: %s",statusLabel=>{
    const result=facts({statusLabel});expect(result.listing.source.soldAt).toBeNull();expect(result.listing.status.value).toBe("UNKNOWN");
    expect(result.claims.find(c=>c.kind==="SOLD_EXPLICIT")?.metadata.interpretation).toBe("REVIEW_REQUIRED");
  });
  it.each(["Questo non è venduto", "Il vicino ha venduto", "Vendita", "Da ristrutturare"])("never derives sold from unrelated words %s", statusLabel => {
    expect(facts({ statusLabel }).listing.status.value).not.toBe("SOLD");
  });
  it("keeps under-offer evidence and explicit agent identity", () => {
    const result = facts({ statusLabel: "In trattativa", agent: { name: "Agente dichiarato", url: null } });
    expect(result.listing.status.value).toBe("NEGOTIATION");
    expect(result.claims.find(c => c.kind === "AGENT_IDENTITY")?.normalizedValue).toMatchObject({ name: "Agente dichiarato" });
  });
  it("unknown agency remains unknown and Gabetti Modugno control remains out of scope", () => {
    const result = normalizeExternalFacts(real.facts[7] as ExternalFacts);
    expect(result.listing.location.scope).toBe("OUT_OF_SCOPE");
    expect(result.agency.name).toBeNull();
  });
  it("registry normalization is exact rather than fuzzy brand matching", () => {
    expect(normalizedAgencyName("  STUDI  SANTI SRL ")).toBe("studi santi srl");
    expect(normalizedAgencyName("Tecnocasa Bari")).not.toBe(normalizedAgencyName("Tecnocasa Bitonto"));
  });
  it("identifies the same claim across repeated observations", () => {
    const left = facts().claims[0], right = facts({ observedAt: "2026-10-15T20:32:28.000Z" }).claims[0];
    expect(evidenceIdentity(left)).toBe(evidenceIdentity(right));
  });
  it("imports selected historical evidence with confidence ceiling and capture provenance", () => {
    const c = historicalEvidence({ sourceUrl: base.url, captureUrl: "https://archive.example/capture/1", observedAt: base.observedAt,
      claimedDate: "28/04/2026", rawClaim: "Data dichiarata 28/04/2026" });
    expect(c.confidence).toBe(0.65); expect(c.metadata.currentPresence).toBe(false);
    expect(c.sourceRecordedAt).toBe("2026-04-28T00:00:00.000Z");
  });
  it("keeps dated historical asking separate from simultaneous current prices", () => {
    const c = historicalEvidence({ sourceUrl: base.url, captureUrl: "https://archive.example/capture/1", observedAt: base.observedAt,
      claimedDate: "28/04/2026", rawClaim: "225.000", kind: "ASKING_PRICE", amount: 225000 });
    expect(c.claimKey).toBe("publication.askingPrice"); expect(c.sourceRecordedAt).not.toBe(c.observedAt);
    expect(facts().listing.commercial.priceAmount).toBe(195000);
    expect(normalizeExternalFacts(real.facts[1] as ExternalFacts).listing.commercial.priceAmount).toBe(155000);
  });
  it("V2 resolves Wikicasa against an agency-site candidate using explicit reference/civic and characteristics",()=>{
    const observation=identityObservationFromListing(facts().listing,[]);
    const candidate={...observation,propertyId:"existing-house",priceAmount:155000,knownAgencyReferences:["41091011-176"]};
    const decision=decidePropertyIdentity(observation,[candidate]);
    expect(decision.outcome).toBe("AUTO_MATCH");expect(decision.propertyId).toBe("existing-house");
  });
  it("V2 retains the same physical candidate across Wikicasa and Immobiliare without an aggressive merge",()=>{
    const candidate=identityObservationFromListing(facts().listing,[]);
    const observation=identityObservationFromListing(normalizeExternalFacts({...real.facts[1],method:"PRIMARY_HTTP"} as ExternalFacts).listing,[]);
    const decision=decidePropertyIdentity(observation,[{...candidate,propertyId:"existing-house",knownAgencyReferences:["41091011-176"]}]);
    expect(decision.outcome).not.toBe("NEW_PROPERTY");
    expect(decision.candidates[0]?.propertyId).toBe("existing-house");
  });
  it("the same street alone cannot merge a different-sized unit",()=>{
    const observation=identityObservationFromListing(facts({reference:null}).listing,[]);
    const candidate={...observation,propertyId:"different-unit",surfaceSqm:40,floor:"4",knownAgencyReferences:[]};
    expect(decidePropertyIdentity(observation,[candidate]).outcome).not.toBe("AUTO_MATCH");
  });
  it("a large price mismatch with identical reference and civic goes to review rather than a duplicate",()=>{
    const observation=identityObservationFromListing(facts({price:155000}).listing,[]);
    const candidate={...observation,propertyId:"existing-house",priceAmount:225000,knownAgencyReferences:["41091011-176"]};
    const decision=decideExternalPropertyIdentity(observation,[candidate]);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");expect(decision.candidates[0].contradictions).toContain("external_price_mismatch_requires_review");
  });
  it("reuses the human SAME decision only after resolution for the same agency context",()=>{
    const propertyId="11111111-1111-4111-8111-111111111111";
    const review={status:"RESOLVED",details:{agencyId:"agency-a"},resolution:{decision:"SAME",candidatePropertyId:propertyId}};
    expect(externalReviewResolution(review,"agency-a").propertyId).toBe(propertyId);
    expect(externalReviewResolution({...review,status:"IN_REVIEW"},"agency-a").propertyId).toBeNull();
    expect(externalReviewResolution(review,"agency-b").propertyId).toBeNull();
  });
  it("honors DIFFERENT decisions without allowing an invalid manual property id",()=>{
    const propertyId="11111111-1111-4111-8111-111111111111";
    const review={status:"RESOLVED",details:{agencyId:"agency-a",candidates:[{propertyId}]},resolution:{decision:"DIFFERENT"}};
    expect(externalReviewResolution(review,"agency-a").excluded).toEqual([propertyId]);
    expect(externalReviewResolution({...review,resolution:{decision:"SAME",candidatePropertyId:"not-a-uuid"}},"agency-a").propertyId).toBeNull();
  });
});

describe("External source DOM contracts and inventory safety", () => {
  it("accepts dated JSON-LD only for the primary property and preserves the extraction field",()=>{
    const ld={"@type":"RealEstateListing",url:base.url,datePublished:"2026-05-05",dateModified:"2026-09-22",offers:{price:195000}};
    const html=`<main><h1>Casa in Vendita, Bitonto</h1><dl><dt>Rif. Interno</dt><dd>29812570</dd><dt>Locali</dt><dd>3</dd></dl></main><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    const parsed=parseExternalHtml("WIKICASA",html,base.url,base.observedAt);
    expect(parsed.listing.source.portalPublishedAt).toBe("2026-05-05T00:00:00.000Z");
    expect(parsed.claims.find(c=>c.kind==="PORTAL_PUBLICATION_DATE")?.metadata.sourceField).toContain("JSON_LD");
    const unrelated=parseExternalHtml("WIKICASA",html.replace(base.url,"https://www.wikicasa.it/annuncio/999"),base.url,base.observedAt);
    expect(unrelated.listing.source.portalPublishedAt).toBeNull();
  });
  it.each(["WIKICASA","IMMOBILIARE","IDEALISTA"] as const)("parses %s explicit DOM fields while ignoring related sold and imagery",source=>{
    const url=source==="WIKICASA"?base.url:source==="IMMOBILIARE"?"https://www.immobiliare.it/annunci/128823342/":"https://www.idealista.it/immobile/123/";
    const id=publicationIdentity(source,url);
    const html=`<main><h1>Casa in Vendita, Via Crocifisso 52, Bitonto</h1><dl><dt>Comune</dt><dd>Bitonto</dd>
      <dt>Rif. Interno</dt><dd>${id}</dd><dt>Indirizzo</dt><dd>Via Crocifisso 52, Bitonto</dd><dt>Tipologia</dt><dd>Casa indipendente</dd>
      <dt>Superficie</dt><dd>106 m²</dd><dt>Locali</dt><dd>3</dd><dt>Prezzo</dt><dd>155.000 €</dd><dt>Data annuncio</dt><dd>5 mag 2026</dd>
      <dt>Annuncio aggiornato il</dt><dd>22/09/2026</dd></dl><del>195.000 €</del><span data-testid="listing-status">In trattativa</span>
      <a href="/agenzia-immobiliare/remax-123">RE/MAX</a><div data-testid="property-gallery"><img src="https://images.example/own.jpg"></div>
      <div class="related"><p>Venduto</p><img src="https://images.example/sold-related.jpg"></div></main>`;
    const parsed=parseExternalHtml(source,html,url,base.observedAt);
    expect(parsed.listing.status.value).toBe("NEGOTIATION");expect(parsed.listing.commercial.priceAmount).toBe(155000);
    expect(parsed.listing.assets.map(a=>a.url)).toEqual(["https://images.example/own.jpg"]);
    expect(parsed.listing.source.portalPublishedAt).toBe(source==="WIKICASA"?"2026-05-05T00:00:00.000Z":null);
  });
  it("parses the existing real Casa fixture without inventing publication/acquisition dates", async () => {
    const html = await readFile("tests/fixtures/property-lifecycle/studiocasa-active-detail.html", "utf8");
    const result = parseExternalHtml("CASA", html, "https://www.casa.it/immobili/54520194/", base.observedAt);
    expect(result.listing.source.portalModifiedAt).toBe("2026-08-04T00:00:00.000Z");
    expect(result.listing.source.portalPublishedAt).toBeNull();
    expect(result.listing.commercial.priceAmount).toBe(109000);
    expect(result.agency.externalId).toBe("1098672"); expect(result.listing.assets.length).toBe(1);
  });
  it("changed Casa identity fails rather than attaching evidence to the wrong property", async () => {
    const html = await readFile("tests/fixtures/property-lifecycle/studiocasa-active-detail.html", "utf8");
    expect(() => parseExternalHtml("CASA", html.replace('"id":54520194', '"id":1'), "https://www.casa.it/immobili/54520194/", base.observedAt)).toThrow();
  });
  it("rejects changed/empty/captcha detail markup", () => {
    for (const html of ["<h1>Listing</h1>", "<h1>Attention Required</h1>", "<main><h1>Bitonto</h1></main>"]) {
      expect(() => parseExternalHtml("WIKICASA", html, base.url, base.observedAt)).toThrow();
    }
  });
  it("validates stable IDs and rejects other hosts and schemes", () => {
    expect(publicationIdentity("WIKICASA", base.url)).toBe("29812570");
    expect(() => publicationIdentity("WIKICASA", "https://elsewhere.test/annuncio/29812570")).toThrow();
    expect(() => publicationIdentity("IMMOBILIARE", base.url)).toThrow();
    expect(() => publicationIdentity("WIKICASA", base.url.replace("https://","https://credential@"))).toThrow();
    expect(() => publicationIdentity("WIKICASA", base.url.replace("wikicasa.it/","wikicasa.it:8443/"))).toThrow();
  });
  it("walks all scoped pages and deduplicates repeated card links", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(inventory(["1","1"],2,"?page=2"))).mockResolvedValueOnce(response(inventory(["2"],2)));
    const result = await fetchWikicasaInventory(new ExternalPublicHttp(fetcher, async () => {}), ["https://www.wikicasa.it/vendita-case/bitonto/"]);
    expect(result.complete).toBe(true); expect(result.items.length).toBe(2); expect(result.pagesVisited).toBe(2);
  });
  it.each(["missing_count", "duplicate_page", "missing_last_page"])("fails closed for %s", async scenario => {
    const page1 = scenario === "missing_count" ? inventory(["1"],3) : inventory(["1"],2,"?page=2");
    const page2 = scenario === "duplicate_page" ? inventory(["1"],2) : "<main>No results</main>";
    const fetcher = vi.fn().mockResolvedValueOnce(response(page1)).mockResolvedValueOnce(response(page2));
    const result = await fetchWikicasaInventory(new ExternalPublicHttp(fetcher, async () => {}), ["https://www.wikicasa.it/vendita-case/bitonto/"]);
    expect(result.complete).toBe(false);
  });
  it("never fetches a national inventory outside configured geography", async () => {
    const fetcher = vi.fn();
    await expect(fetchWikicasaInventory(new ExternalPublicHttp(fetcher, async () => {}), ["https://www.wikicasa.it/vendita-case/roma/"])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("FAST confirms stable presence while price/content/status/rotation changes require details", () => {
    const input = { known:true,previousMarker:"same",marker:"same",lastDetailAt:base.observedAt,now:base.observedAt };
    expect(detailRequired(input)).toBe(false);
    for (const override of [{known:false},{marker:"different"},{marker:null},{deep:true},{exitVerification:true},{policyChanged:true},
      {now:"2026-10-22T20:32:28.000Z"}]) expect(detailRequired({...input,...override})).toBe(true);
  });
});

describe("Public source HTTP robustness", () => {
  it("serializes concurrent calls and releases the slot after a failed request", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve=>{release=resolve;});
    const fetcher=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(response("<main>valid</main>"));
    const http=new ExternalPublicHttp(fetcher,async()=>{});
    const first=http.get(base.url,"wikicasa.it"), second=http.get(base.url,"wikicasa.it");
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    release(response("unavailable",404));
    await expect(first).rejects.toMatchObject({status:404});
    expect((await second).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("a queued call cannot bypass a circuit opened by the first request", async () => {
    const fetcher=vi.fn().mockResolvedValue(response("blocked",403));
    const http=new ExternalPublicHttp(fetcher,async()=>{});
    const results=await Promise.allSettled([http.get(base.url,"wikicasa.it"),http.get(base.url,"wikicasa.it")]);
    expect(results.every(result=>result.status==="rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("403 opens the circuit and cannot become a missing observation", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("blocked",403));
    const http = new ExternalPublicHttp(fetcher, async () => {});
    await expect(http.get(base.url,"wikicasa.it")).rejects.toMatchObject({reason:"access_blocked",status:403});
    await expect(http.get(base.url,"wikicasa.it")).rejects.toMatchObject({reason:"source_circuit_open"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries 429 with Retry-After and exponential backoff", async () => {
    const sleep = vi.fn(async () => {});
    const fetcher = vi.fn().mockResolvedValueOnce(response("rate",429,{"retry-after":"4"})).mockResolvedValue(response("<main>valid</main>"));
    expect((await new ExternalPublicHttp(fetcher,sleep,()=>0).get(base.url,"wikicasa.it")).status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(4000);
  });
  it("long Retry-After yields to the job queue", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("rate",429,{"retry-after":"3600"}));
    try { await new ExternalPublicHttp(fetcher,async()=>{},()=>0).get(base.url,"wikicasa.it"); throw new Error("Expected rate limit"); }
    catch(error) { expect(error).toMatchObject({reason:"retry_after_requires_job_retry",retryAfterMs:3600000});
      expect(lifecycleRetryDelayMs(1,error)).toBe(3600000); }
  });
  it("queued concurrent calls also respect a long Retry-After",async()=>{
    const fetcher=vi.fn().mockResolvedValue(response("busy",500,{"retry-after":"3600"}));
    const http=new ExternalPublicHttp(fetcher,async()=>{},()=>0);
    const results=await Promise.allSettled([http.get(base.url,"wikicasa.it"),http.get(base.url,"wikicasa.it")]);
    expect(results.every(result=>result.status==="rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([404,410,302])("HTTP %i is not a positive or sold observation", async status => {
    await expect(new ExternalPublicHttp(vi.fn().mockResolvedValue(response("unavailable",status)),async()=>{}).get(base.url,"wikicasa.it")).rejects.toMatchObject({status});
  });
  it("does not follow an unverified redirect or access disallowed API hosts", async () => {
    const fetcher = vi.fn();
    await expect(new ExternalPublicHttp(fetcher).get("https://internal.example/data","wikicasa.it")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect(EXTERNAL_POLICY.version).toBe("external_market_evidence_v1");
    await expect(new ExternalPublicHttp(fetcher).get("https://www.wikicasa.it/api-nuxt/internal","wikicasa.it")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
