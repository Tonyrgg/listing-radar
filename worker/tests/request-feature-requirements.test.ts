import { describe, expect, it } from "vitest";

import { WorkerRepository } from "../src/services/repository.js";
import {
  crmRequestFeatureRequirements,
  unreadableFeatureDeclarations,
} from "../src/services/request-feature-requirements.js";

describe("dotazioni dichiarate nella richiesta CRM", () => {
  it("traduce l'ascensore spuntato in una preferenza indispensabile", () => {
    expect(crmRequestFeatureRequirements({ fields: { Ascensore: true } })).toEqual([{
      feature_key: "elevator",
      preference_level: "required",
      desired_value: true,
      crm_field: "Ascensore",
      declared_as: "Sì",
    }]);
  });

  it("accetta anche le forme scritte che il CRM usa al posto della spunta", () => {
    for (const value of ["Sì", "SI", " si ", "Indispensabile", "Obbligatorio"]) {
      expect(crmRequestFeatureRequirements({ fields: { Ascensore: value } })).toHaveLength(1);
    }
  });

  it("legge il campo anche quando sta nell'intestazione della scheda", () => {
    expect(crmRequestFeatureRequirements({ fields: {}, headerFields: { Ascensore: true } })).toHaveLength(1);
  });

  it("non pretende l'ascensore quando il CRM dice di no o non dice niente", () => {
    const negati: Array<Record<string, string | boolean | null>> = [
      { Ascensore: false }, { Ascensore: "No" }, { Ascensore: "" }, { Ascensore: null }, {},
    ];
    for (const fields of negati) {
      expect(crmRequestFeatureRequirements({ fields })).toEqual([]);
    }
  });

  it("non deduce un obbligo da un valore che non sa leggere, ma lo segnala", () => {
    const fields = { Ascensore: "Se possibile, da valutare" };
    expect(crmRequestFeatureRequirements({ fields })).toEqual([]);
    expect(unreadableFeatureDeclarations({ fields })).toEqual([{
      feature_key: "elevator",
      crm_field: "Ascensore",
      declared_as: "Se possibile, da valutare",
    }]);
  });

  it("non segnala niente quando il campo è leggibile o assente", () => {
    const leggibili: Array<Record<string, string | boolean | null>> = [
      { Ascensore: true }, { Ascensore: "No" }, {},
    ];
    for (const fields of leggibili) {
      expect(unreadableFeatureDeclarations({ fields })).toEqual([]);
    }
  });
});

describe("salvataggio delle dotazioni dichiarate", () => {
  const requirement = {
    feature_key: "elevator",
    preference_level: "required" as const,
    desired_value: true as const,
    crm_field: "Ascensore",
    declared_as: "Sì",
  };

  function repositoryWith(existing: Array<{ feature_definition_id: string }>) {
    const inserted: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [{ id: "feature-ascensore", key: "elevator" }], error: null }),
          eq: async () => ({ data: existing, error: null }),
        }),
        insert: async (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows);
          return { error: null };
        },
      }),
    };
    const repository = Object.create(WorkerRepository.prototype) as WorkerRepository;
    Object.defineProperty(repository, "client", { value: client });
    return { repository, inserted };
  }

  it("crea la preferenza che mancava", async () => {
    const { repository, inserted } = repositoryWith([]);
    await expect(repository.applyRequestFeatureRequirements("richiesta", [requirement])).resolves.toBe(1);
    expect(inserted).toEqual([{
      request_id: "richiesta",
      feature_definition_id: "feature-ascensore",
      preference_level: "required",
      desired_value: true,
    }]);
  });

  it("non tocca la preferenza già decisa da una persona", async () => {
    const { repository, inserted } = repositoryWith([{ feature_definition_id: "feature-ascensore" }]);
    await expect(repository.applyRequestFeatureRequirements("richiesta", [requirement])).resolves.toBe(0);
    expect(inserted).toEqual([]);
  });

  it("non scrive niente quando il CRM non dichiara dotazioni", async () => {
    const { repository, inserted } = repositoryWith([]);
    await expect(repository.applyRequestFeatureRequirements("richiesta", [])).resolves.toBe(0);
    expect(inserted).toEqual([]);
  });
});
