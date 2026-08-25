import { describe, expect, it } from "vitest";

import {
  cleanPropertyTitle,
  cleanRequestTitle,
  clientContact,
  requestActivities,
  requestArea,
  requestBudget,
  requestSearchText,
} from "@/lib/matching/request-presentation";
import type { PropertyRequest } from "@/lib/matching/types";

const request = {
  id: "request-1",
  client_id: "client-1",
  title: "Richiesta Immobiliare RR - Test",
  contract_type: "sale",
  property_types: ["apartment"],
  municipality: "Bitonto",
  status: "active",
  priority: "normal",
  budget_ideal: null,
  budget_max: 50000,
  monthly_rent_ideal: null,
  monthly_rent_max: null,
  internal_sqm_min: 60,
  internal_sqm_ideal: null,
  internal_sqm_max: null,
  commercial_sqm_estimated_min: null,
  commercial_sqm_estimated_max: null,
  rooms_min: 2,
  rooms_ideal: null,
  rooms_max: null,
  bedrooms_min: null,
  bathrooms_min: null,
  floor_min: null,
  floor_max: null,
  building_floors_max: null,
  accepted_conditions: [],
  availability_requirement: null,
  available_by: null,
  notes: null,
  raw_payload: {
    fields: {
      Prezzo: "EUR 60.000,00",
      "Metri Quadri": "70",
      Cliente: "Franco Test",
    },
    evolutionText: "Richiesta aggiornata dopo la chiamata.",
    relatedSections: [
      { heading: "Proposta - Eseguito", text: "Immobile proposto" },
      { heading: "Cliente", text: "Privacy: Scritta" },
      { heading: "Sezione 5", text: "Attività e appuntamenti Loading" },
    ],
  },
} satisfies PropertyRequest;

describe("request presentation", () => {
  it("uses the richer CRM values before normalized fallbacks", () => {
    expect(requestBudget(request)).toBe("€ 60.000,00");
    expect(requestArea(request)).toBe("70 mq");
    expect(cleanRequestTitle(request.title)).toBe("RR - Test");
  });

  it("keeps only usable CRM activities", () => {
    expect(requestActivities(request)).toEqual([
      { heading: "Evoluzione richiesta", text: "Richiesta aggiornata dopo la chiamata." },
      { heading: "Proposta - Eseguito", text: "Immobile proposto" },
    ]);
  });

  it("searches normalized and imported request information", () => {
    expect(requestSearchText({ ...request, clients: { full_name: "Cliente Test" } })).toContain("franco test");
    expect(requestSearchText({ ...request, clients: { full_name: "Cliente Test" } })).toContain("cliente test");
  });

  it("reads imported contact fallbacks", () => {
    expect(clientContact({
      phone: null,
      email: null,
      raw_payload: {
        request_contact_fields: {
          Cellulare: "3331234567",
          Email: "cliente@example.it",
          "Indirizzo Residenza": "Via Roma 1",
        },
      },
    })).toEqual({
      phone: "3331234567",
      email: "cliente@example.it",
      address: "Via Roma 1",
    });
  });
});

describe("il nome di un immobile del portafoglio", () => {
  it("toglie il gergo del gestionale", () => {
    expect(cleanPropertyTitle("Incarico IN - Fanfulla - Vendita")).toBe("Fanfulla");
    expect(cleanPropertyTitle("Incarico OUT – Pafetta – Locazione")).toBe("Pafetta");
  });

  it("lascia stare i nomi che non hanno gergo", () => {
    expect(cleanPropertyTitle("Villa con giardino")).toBe("Villa con giardino");
  });

  it("dice quando un nome non c'è", () => {
    expect(cleanPropertyTitle(null)).toBe("Immobile senza nome");
  });
});
