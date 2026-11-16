import {isRentalOnlyOffer} from "@/lib/property-lifecycle/private-radar/transaction";
import {privateGalleryImages} from "@/lib/property-lifecycle/read-models/private-images";
import { dossierContext } from "@/lib/property-lifecycle/read-models/dossier-context";
import { expect, it } from "vitest";
import { privateEvidenceDate, discoverPrivateUrls, privateObservationFromCapture } from "@/lib/property-lifecycle/private-radar/collector";
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

it("drops a portal's no-photo illustration while retaining usable gallery images",()=>{
 expect(privateGalleryImages(["https://www.casadaprivato.it/no_photo.svg","https://example.test/home.jpg","https://example.test/home.jpg","javascript:alert(1)"])).toEqual(["https://example.test/home.jpg"]);
});

it("rejects an explicit rental offer even when miscategorized as a sale, without rejecting a leased investment for sale",()=>{
 expect(isRentalOnlyOffer({title:"Tre posti letto",description:"Affitto open-space 40 mq. Canone 350 euro."})).toBe(true);
 expect(privateObservationFromCapture("idealista",url,id,{...capture,description:"Affitto open-space 40 mq",transaction:"s"},now,now)).toBeNull();
 expect(isRentalOnlyOffer({title:"Appartamento in vendita",description:"Vendesi immobile attualmente in affitto."})).toBe(false);
 expect(isRentalOnlyOffer({title:"Ampio locale",description:"Locale disponibile, prezzo 550 euro"})).toBe(false);
});

it('parses Italian dates without US month/day reversal and rejects rollover or future dates',()=>{
 expect(privateEvidenceDate('10/08/2026',now)).toBe('2026-08-10T00:00:00.000Z');
 expect(privateEvidenceDate('17/10/2026',now)).toBe('2026-10-17T00:00:00.000Z');
 expect(privateEvidenceDate('2026-11-08 21:07:01',now)).toBe('2026-11-08T00:00:00.000Z');
 expect(privateEvidenceDate('al 18 mag 2026',now)).toBe('2026-05-18T00:00:00.000Z');
 expect(privateEvidenceDate('8 nov 2026',now)).toBe('2026-11-08T00:00:00.000Z');
 expect(privateEvidenceDate('2026-02-31',now)).toBeNull();
 expect(privateEvidenceDate('31/02/2026',now)).toBeNull();
 expect(privateEvidenceDate('2027-01-01',now)).toBeNull();
 const row=privateObservationFromCapture('idealista',url,id,{...capture,portalDeclaredDate:'10/08/2026',metadataDateModified:'17/10/2026'},now,now)!;
 expect(row.portal_declared_date).toBe('2026-08-10T00:00:00.000Z');expect(row.metadata_date_modified).toBe('2026-10-17T00:00:00.000Z');
});
