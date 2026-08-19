import { describe, expect, it } from "vitest";

import {
  canonicalBuildingAddress,
  splitCivicNumbers,
} from "@/lib/property-lifecycle/buildings/address";
import {
  classifyBuildingIntervention,
  normalizeBuildingPracticeRows,
  parseBuildingPracticeCsv,
} from "@/lib/property-lifecycle/buildings/practices";

describe("Property Lifecycle building addresses", () => {
  it("creates a stable civic-level identity for exact in-scope addresses", () => {
    expect(
      canonicalBuildingAddress({
        scope: "IN_SCOPE",
        precision: "EXACT_ADDRESS",
        municipality: "Bitonto",
        locality: "Palombaio",
        streetName: "Corso Vittorio Emanuele",
        streetNumber: "051 A",
      }),
    ).toEqual({
      normalizedKey:
        "it|ba|bitonto|palombaio|corso vittorio emanuele|51a",
      displayName: "Corso Vittorio Emanuele 51a, Palombaio (Bitonto)",
      municipality: "Bitonto",
      locality: "Palombaio",
      streetName: "Corso Vittorio Emanuele",
      streetNumber: "51a",
    });
  });

  it.each(["STREET_ONLY", "APPROXIMATE_AREA", "UNKNOWN"] as const)(
    "never collapses %s locations into a building",
    (precision) => {
      expect(
        canonicalBuildingAddress({
          scope: "IN_SCOPE",
          precision,
          municipality: "Bitonto",
          locality: "Bitonto",
          streetName: "Via Mazzini",
          streetNumber: "10",
        }),
      ).toBeNull();
    },
  );

  it("never creates a building outside the monitored municipality", () => {
    expect(
      canonicalBuildingAddress({
        scope: "OUT_OF_SCOPE",
        precision: "EXACT_ADDRESS",
        municipality: "Bari",
        locality: "Santo Spirito",
        streetName: "Via Napoli",
        streetNumber: "10",
      }),
    ).toBeNull();
  });

  it("splits multi-civic public-practice values deterministically", () => {
    expect(splitCivicNumbers("26/28/030 A; 28")).toEqual(["26", "28", "30a"]);
  });
});

describe("Comune di Bitonto building-practice normalization", () => {
  const csv = [
    "Applicazione,Numero Pratica,Oggetto,Data Protocollo,Numero Protocollo,Anno,Tipo Pratica,Via,Civico,Lettera,Cognome,Nome,Ragione Sociale,Situazione Pratica,Comune,Tipo Catasto,Foglio,Particella,Subalterno,Sezione,Lotto",
    'ape,P-1,"FRAZIONAMENTO, manutenzione straordinaria",15/02/2026,100,2026,CILA,Via Luigi Galvani,26/28/30,,Rossi,Mario,,Aperta,Bitonto,Fabbricati,50,2279,2,,',
    'ape,P-1,"FRAZIONAMENTO, manutenzione straordinaria",15/02/2026,100,2026,CILA,Via Luigi Galvani,26/28/30,,Bianchi,Anna,Impresa privata,Aperta,Bitonto,Fabbricati,50,2279,3,,',
    'ape,P-2,"Cambio destinazione d uso da laboratorio a residenza",2026-03-01,101,2026,SCIA,"Palombaio - Corso Vittorio Emanuele",51,,,Persona,,"Chiusa",Bitonto,Fabbricati,51,100,1,,',
    "ape,P-3,Fine lavori,04/03/2026,102,2026,CILA,Via Mazzini,,,,,,,Chiusa,Bitonto,Fabbricati,52,101,,,",
    "sue,P-4,Nuova costruzione,05/03/2026,103,2026,PDC,Via Verdi,10,,,,,Aperta,Bitonto,Fabbricati,53,102,1,,",
  ].join("\n");

  it("parses quoted CSV, aggregates duplicate referent rows, and prioritizes APE", () => {
    const result = normalizeBuildingPracticeRows(parseBuildingPracticeCsv(csv));
    expect(result).toMatchObject({
      inputRows: 5,
      eligibleRows: 4,
      skippedApplicationRows: 1,
      duplicateRows: 1,
      unmatchedRecords: 1,
    });
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      sourceRecordKey: "ape:2026:p 1",
      interventionType: "FRAZIONAMENTO",
      occurredAt: "2026-02-15T00:00:00.000Z",
    });
    expect(result.records[0]?.addresses.map((address) => address.streetNumber)).toEqual([
      "26",
      "28",
      "30",
    ]);
    expect(result.records[0]?.cadastralReferences).toHaveLength(2);
  });

  it("keeps direct personal and company fields out of the sanitized projection", () => {
    const result = normalizeBuildingPracticeRows(parseBuildingPracticeCsv(csv));
    const serialized = JSON.stringify(
      result.records.map((record) => record.sanitizedPayload),
    );
    expect(serialized).not.toMatch(/Rossi|Mario|Bianchi|Anna|Impresa privata|Persona/);
    expect(result.records[1]).toMatchObject({
      interventionType: "CAMBIO_DESTINAZIONE_USO",
      addresses: [
        {
          locality: "Palombaio",
          streetName: "Corso Vittorio Emanuele",
          streetNumber: "51",
        },
      ],
    });
  });

  it("classifies the approved intervention vocabulary deterministically", () => {
    expect(classifyBuildingIntervention("fusione e accorpamento")).toBe(
      "FUSIONE_ACCOPPIAMENTO",
    );
    expect(classifyBuildingIntervention("Segnalazione certificata di agibilità")).toBe(
      "AGIBILITA",
    );
    expect(classifyBuildingIntervention("descrizione non classificabile")).toBe("OTHER");
  });
});
