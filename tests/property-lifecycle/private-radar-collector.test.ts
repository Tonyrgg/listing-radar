import { dossierContext } from "@/lib/property-lifecycle/read-models/dossier-context";
import { expect, it } from "vitest";
import { discoverPrivateUrls, privateObservationFromCapture } from "@/lib/property-lifecycle/private-radar/collector";
const now = "2026-11-15T12:00:00Z", id = "11111111-1111-4111-8111-111111111111", url = "https://www.idealista.it/immobile/123/";
const capture = { title: "Appartamento Bitonto via Gorizia 3", addressRaw: "Via Gorizia 3, Bitonto", price: 120000, sqm: 80, sellerType: "unknown", description: "Casa in vendita", metadataDateModified: "2026-11-01" };
it("deduplicates inventory IDs, strips tracking and restricts pagination to the source search", () => {
 const page = discoverPrivateUrls(`<a href="/immobile/123/?tracking=a">A</a><a href="/immobile/123/">A</a><a href="https://evil.test/immobile/99/">bad</a><link rel="next" href="/vendita-case/bitonto-bari/pagina-2.htm">`, "https://www.idealista.it/vendita-case/bitonto-bari/", "idealista");
 expect(page.urls).toEqual([url]); expect(page.next).toContain("pagina-2");
 expect(discoverPrivateUrls('<link rel="next" href="/vendita-case/bari-bari/">', "https://www.idealista.it/vendita-case/bitonto-bari/", "idealista").next).toBeNull();
});
it("keeps uncertain sellers explicit, excludes agency/rental/out-of-scope and never uses modification as publication", () => {
 const row = privateObservationFromCapture("idealista", url, id, capture, now, now)!;
 expect(row.seller_type).toBe("unknown"); expect(row.portal_declared_date).toBeNull(); expect(row.direct).toBe(true);
 expect(privateObservationFromCapture("idealista", url, id, {...capture, sellerType: "agency"}, now, now)).toBeNull();
 expect(privateObservationFromCapture("idealista", url, id, {...capture, title: "Affitto Bitonto"}, now, now)).toBeNull();
 expect(privateObservationFromCapture("idealista", url, id, {...capture, title: "Casa Bari", addressRaw: "Via Roma, Bari"}, now, now)).toBeNull();
});
it("rejects a detail redirect to another listing and strips contacts before persistence", () => {
 expect(() => privateObservationFromCapture("idealista", url, id, {...capture, canonicalUrl: "https://www.idealista.it/immobile/999/"}, now, now)).toThrow("Identità");
 const row = privateObservationFromCapture("idealista", url, id, {...capture, description: "privato vende casa, scrivi a test@example.com, chiama 3331234567", portalDeclaredDate: "2026-03-01", phone: "3331234567"}, now, now)!;
 expect(row.seller_type).toBe("private"); expect(row.portal_declared_date).toContain("2026-03-01"); expect(JSON.stringify(row)).not.toMatch(/3331234567|test@example/);
});

it("keeps the private radar context when opening a dossier",()=>{expect(dossierContext("privati","ACTIVE","UNKNOWN").label).toBe("Radar privati");});
