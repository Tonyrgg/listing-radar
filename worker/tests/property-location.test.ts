import { describe, expect, it } from "vitest";

import {
  cleanImportedPropertyAddress,
  NominatimPropertyGeocoder,
  parsePropertyAddress,
  resolvePropertyLocation,
  type PropertyLocationZone,
} from "../src/services/property-location.js";

const zone: PropertyLocationZone = {
  id: "zone-3",
  zone_number: 3,
  name: "Zona Villa",
  associated_streets: ["Via Cesare Battisti"],
  geometry: { type: "Polygon", coordinates: [[[16.69, 41.1], [16.71, 41.1], [16.71, 41.12], [16.69, 41.12], [16.69, 41.1]]] },
};

describe("localizzazione incarichi", () => {
  it("pulisce il formato CRM senza duplicare comune e civico", () => {
    expect(cleanImportedPropertyAddress(
      "Via Cesare Battisti, 2B BITONTO (BA) 70032",
      "BITONTO",
      "Via Cesare Battisti",
      "2B",
      ".",
    )).toBe("Via Cesare Battisti, 2B");
    expect(parsePropertyAddress("Via Cesare Battisti, 2B int. 4", "BITONTO")).toMatchObject({
      streetName: "Via Cesare Battisti",
      civicNumber: "2B",
    });
  });

  it("assegna il perimetro che contiene il civico geocodificato", async () => {
    const geocoder = new NominatimPropertyGeocoder({
      minimumDelayMs: 0,
      fetchImpl: async () => new Response(JSON.stringify([{ lat: "41.11", lon: "16.70", address: { house_number: "2B" } }]), { status: 200 }),
    });
    const result = await resolvePropertyLocation({ address: "Via Cesare Battisti, 2B", municipality: "BITONTO" }, [zone], geocoder);
    expect(result).toMatchObject({ status: "resolved", confidence: "exact", zone_id: "zone-3", zone_number: 3 });
  });

  it("usa l'indice delle vie solo quando la corrispondenza è univoca", async () => {
    const geocoder = new NominatimPropertyGeocoder({
      minimumDelayMs: 0,
      fetchImpl: async () => new Response("[]", { status: 200 }),
    });
    const result = await resolvePropertyLocation({ address: "Via Cesare Battisti", municipality: "BITONTO" }, [zone], geocoder);
    expect(result).toMatchObject({ status: "street_match", source: "zone_street_index", zone_id: "zone-3" });
  });

  it("normalizza le varianti CRM note prima della ricerca", () => {
    expect(parsePropertyAddress("Viale Giovanni XXIII, 159/Q", "BITONTO")).toMatchObject({
      streetName: "Via Papa Giovanni XXIII",
      civicNumber: "159/Q",
    });
  });

  it("non assegna zone di Bitonto agli incarichi fuori comune", async () => {
    let calls = 0;
    const geocoder = new NominatimPropertyGeocoder({ minimumDelayMs: 0, fetchImpl: async () => { calls += 1; return new Response("[]"); } });
    const result = await resolvePropertyLocation({ address: "Via Carso, 17", municipality: "GIOVINAZZO" }, [zone], geocoder);
    expect(result.status).toBe("outside_municipality");
    expect(calls).toBe(0);
  });

  it("considera Palombaio e Mariotto parte del territorio di Bitonto", async () => {
    let calls = 0;
    const geocoder = new NominatimPropertyGeocoder({ minimumDelayMs: 0, fetchImpl: async () => { calls += 1; return new Response("[]"); } });
    const result = await resolvePropertyLocation({ address: "Via della frazione", municipality: "PALOMBAIO" }, [zone], geocoder);
    expect(result.status).toBe("not_found");
    expect(calls).toBe(1);
  });
});
