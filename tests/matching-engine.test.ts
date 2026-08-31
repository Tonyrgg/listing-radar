import { describe, expect, it } from "vitest";
import { calculateMatch } from "@/lib/matching/engine";
import { estimateCommercialSqm, sqmCoherenceWarnings } from "@/lib/matching/scoring";
import {
  elevatorIsRelevant,
  propertyHasElevator,
  readBooleanFeature,
  requestRequiresElevator,
} from "@/lib/matching/elevator";
import {
  propertyTypeFromText,
  resolveRequestPropertyTypes,
} from "@/lib/matching/property-types";
import type { PortfolioProperty, PropertyRequest } from "@/lib/matching/types";
import type { GeoJsonGeometry } from "@/lib/map/types";

const request: PropertyRequest = {
  id: "r", client_id: null, title: "Casa", contract_type: "sale",
  property_types: ["apartment"], municipality: "Bitonto", status: "active", priority: "normal",
  budget_ideal: 100000, budget_max: 120000, monthly_rent_ideal: null, monthly_rent_max: null,
  internal_sqm_min: 70, internal_sqm_ideal: 90, internal_sqm_max: 110,
  commercial_sqm_estimated_min: null, commercial_sqm_estimated_max: null,
  rooms_min: 3, rooms_ideal: 4, rooms_max: 5, bedrooms_min: 2, bathrooms_min: 1,
  floor_min: null, floor_max: null, building_floors_max: null, accepted_conditions: [],
  availability_requirement: null, available_by: null, notes: null,
};
const property: PortfolioProperty = {
  id: "p", title: "Appartamento", contract_type: "sale", property_type: "apartment",
  municipality: "Bitonto", address: null, internal_zone_id: null, price: 110000,
  monthly_rent: null, internal_sqm: 90, commercial_sqm: 105, rooms: 4, bedrooms: 2,
  bathrooms: 1, floor: 2, building_floors: 4, condition: null,
  availability_status: null, available_from: null, description: null, notes: null,
  mandate_status: "active",
};

describe("matching engine", () => {
  it("riconosce una corrispondenza forte", () => {
    expect(calculateMatch({ request, property }).score).toBeGreaterThanOrEqual(85);
  });
  it("non elimina una feature obbligatoria mancante", () => {
    // L'ascensore ha una regola sua: qui serve una dotazione qualunque, per
    // cui restare in lista con un conflitto e' ancora il comportamento giusto.
    const result = calculateMatch({
      request, property,
      requestFeatures: [{
        feature_definition_id: "b", preference_level: "required", desired_value: true,
        custom_weight: 8, feature: { id: "b", key: "balcony", label: "Balcone", category: "esterni", field_type: "boolean", applies_to: "both", default_weight: 5, is_active: true, sort_order: 0 },
      }],
    });
    expect(result.conflicting_criteria).toContain("Balcone obbligatorio");
    expect(result.score).toBeGreaterThan(0);
  });
  it("stima la metratura commerciale e segnala incoerenze", () => {
    expect(estimateCommercialSqm(100)).toEqual({ minimum: 110, maximum: 120 });
    expect(sqmCoherenceWarnings(45, 5)).toHaveLength(1);
  });
  it("interpreta le fasce piano usate nelle richieste del gestionale", () => {
    const topFloorRequest = { ...request, requested_floor_band: "top" as const };
    const lastFloor = calculateMatch({
      request: topFloorRequest,
      property: { ...property, floor: 4, building_floors: 4 },
    });
    const middleFloor = calculateMatch({
      request: topFloorRequest,
      property: { ...property, floor: 2, building_floors: 4 },
    });
    expect(lastFloor.matched_criteria).toContain("piano");
    expect(middleFloor.missing_preferences).toContain("piano non preferito");
    expect(lastFloor.score).toBeGreaterThan(middleFloor.score);
  });
  it("non regala il pieno a un immobile che costa molto meno della richiesta", () => {
    // Il caso della richiesta Vinciguerra: 35.000 su un tetto da 130.000
    // prendeva punteggio pieno, perche' bastava stare sotto il target.
    const svenduto = calculateMatch({ request, property: { ...property, price: 35000 } });
    const giusto = calculateMatch({ request, property: { ...property, price: 98000 } });
    expect(svenduto.matched_criteria).not.toContain("budget");
    expect(svenduto.missing_preferences).toContain("budget fuori fascia");
    expect(svenduto.score).toBeLessThan(giusto.score);
    // Meta' del prezzo chiesto resta un buon punteggio, non una bocciatura.
    const metaPrezzo = calculateMatch({ request, property: { ...property, price: 50000 } });
    expect(metaPrezzo.matched_criteria).toContain("budget");
  });

  it("lascia un quarto di margine sopra il tetto dichiarato, poi chiude", () => {
    const trattabile = calculateMatch({ request, property: { ...property, price: 132000 } });
    const fuori = calculateMatch({ request, property: { ...property, price: 160000 } });
    expect(trattabile.score).toBeGreaterThan(fuori.score);
    expect(fuori.missing_preferences).toContain("budget fuori fascia");
  });

  it("misura la metratura a scaglioni invece di promuovere tutto", () => {
    const soloIdeale = { ...request, internal_sqm_min: null, internal_sqm_max: null };
    // 50 mq su 90 richiesti: prima passava, perche' il calcolo aveva un
    // pavimento a 0.75 che coincideva con la soglia della spunta.
    const piccolo = calculateMatch({ request: soloIdeale, property: { ...property, internal_sqm: 50 } });
    const vicino = calculateMatch({ request: soloIdeale, property: { ...property, internal_sqm: 82 } });
    expect(piccolo.matched_criteria).not.toContain("metratura");
    expect(vicino.matched_criteria).toContain("metratura");
    expect(vicino.score).toBeGreaterThan(piccolo.score);
  });

  it("toglie la spunta metratura gia' oltre i dieci metri di scarto", () => {
    const soloIdeale = { ...request, internal_sqm_min: null, internal_sqm_max: null };
    const dieci = calculateMatch({ request: soloIdeale, property: { ...property, internal_sqm: 80 } });
    const venti = calculateMatch({ request: soloIdeale, property: { ...property, internal_sqm: 70 } });
    expect(dieci.matched_criteria).toContain("metratura");
    expect(venti.matched_criteria).not.toContain("metratura");
    expect(venti.classification).not.toBe("compatible");
  });

  it("accetta la metratura ai bordi dell'intervallo dichiarato dal cliente", () => {
    // 110 mq distano 20 dall'ideale, ma il cliente ha scritto lui «fino a 110».
    const bordo = calculateMatch({ request, property: { ...property, internal_sqm: 110 } });
    expect(bordo.matched_criteria).toContain("metratura");
  });

  it("tollera un vano di scarto e non due", () => {
    const unoInMeno = calculateMatch({ request, property: { ...property, rooms: 3 } });
    const dueInMeno = calculateMatch({ request, property: { ...property, rooms: 2 } });
    expect(unoInMeno.matched_criteria).toContain("vani");
    expect(dueInMeno.matched_criteria).not.toContain("vani");
    expect(dueInMeno.missing_preferences).toContain("vani fuori intervallo");
    expect(unoInMeno.score).toBeGreaterThan(dueInMeno.score);
  });

  it("non propone altre famiglie di immobile a chi cerca una villa", () => {
    const villa = { ...request, property_types: ["villa"] };
    for (const tipo of ["garage", "apartment", "commercial_space", "townhouse"]) {
      const risultato = calculateMatch({ request: villa, property: { ...property, property_type: tipo } });
      expect(risultato.score, `${tipo} non deve entrare in lista`).toBe(0);
      expect(risultato.classification).toBe("not_relevant");
      expect(risultato.conflicting_criteria).toContain("tipologia incompatibile");
    }
  });

  it("tiene le tipologie affini, a punteggio ridotto", () => {
    const villa = { ...request, property_types: ["villa"] };
    const indipendente = calculateMatch({ request: villa, property: { ...property, property_type: "independent_house" } });
    const esatta = calculateMatch({ request: villa, property: { ...property, property_type: "villa" } });
    expect(indipendente.score).toBeGreaterThan(0);
    expect(indipendente.score).toBeLessThan(esatta.score);
    const attico = calculateMatch({ request, property: { ...property, property_type: "penthouse" } });
    expect(attico.matched_criteria).toContain("tipologia");
  });

  it("pesa la zona in base alla distanza reale tra i perimetri", () => {
    const centro = square(16.690, 41.107);
    const santiMedici = square(16.695, 41.112);
    const scuole = square(16.710, 41.105);
    const requestZones = [{
      zone_id: "centro",
      preference_level: "preferred" as const,
      zone: { id: "centro", zone_number: 2, name: "Centro", description: null, landmarks: [], aliases: [], associated_streets: [], geometry: centro, color: "#f97316", is_active: true },
    }];
    const near = calculateMatch({
      request,
      property: { ...property, internal_zone_id: "santi", zone: { id: "santi", name: "Santi Medici", geometry: santiMedici } },
      requestZones,
    });
    const peripheral = calculateMatch({
      request,
      property: { ...property, internal_zone_id: "scuole", zone: { id: "scuole", name: "Zona Scuole", geometry: scuole } },
      requestZones,
    });
    expect(near.score).toBeGreaterThan(peripheral.score);
    expect(near.matched_criteria).toContain("vicino a Centro");
    expect(peripheral.missing_preferences.some((item) => item.includes("km da Centro"))).toBe(true);
  });
});

describe("regola dell'ascensore", () => {
  const elevatorFeature = {
    id: "e", key: "elevator", label: "Ascensore", category: "accessibilità",
    field_type: "boolean" as const, applies_to: "both" as const,
    default_weight: 10, is_active: true, sort_order: 10,
  };
  const requires = (level: "required" | "preferred" | "indifferent" = "required") => [{
    feature_definition_id: "e", preference_level: level, desired_value: true,
    custom_weight: null, feature: elevatorFeature,
  }];
  const hasElevator = (value: unknown) => [{ feature_definition_id: "e", value, feature: elevatorFeature }];

  it("esclude l'immobile senza ascensore quando la richiesta lo pretende", () => {
    const result = calculateMatch({
      request, property: { ...property, floor: 2 },
      requestFeatures: requires(), propertyFeatures: hasElevator(false),
    });
    expect(result.score).toBe(0);
    expect(result.classification).toBe("not_relevant");
    expect(result.conflicting_criteria).toContain("ascensore obbligatorio assente");
  });

  it("non si limita ad abbassare il punteggio: l'immobile esce dalla lista", () => {
    const senza = calculateMatch({
      request, property: { ...property, floor: 2 },
      requestFeatures: requires(), propertyFeatures: hasElevator(false),
    });
    const con = calculateMatch({
      request, property: { ...property, floor: 2 },
      requestFeatures: requires(), propertyFeatures: hasElevator(true),
    });
    expect(con.score).toBeGreaterThanOrEqual(85);
    expect(senza.score).toBe(0);
    expect(con.matched_criteria).toContain("Ascensore");
  });

  it("tiene il piano terra, dove l'ascensore non serve", () => {
    const pianoTerra = calculateMatch({
      request, property: { ...property, floor: 0 },
      requestFeatures: requires(), propertyFeatures: hasElevator(false),
    });
    expect(pianoTerra.score).toBeGreaterThan(0);
    expect(pianoTerra.classification).not.toBe("not_relevant");
    expect(pianoTerra.matched_criteria).toContain("piano terra: ascensore non necessario");
    expect(pianoTerra.conflicting_criteria).toHaveLength(0);
  });

  it("riconosce il piano terra anche dalla tipologia, quando il piano non e' compilato", () => {
    const result = calculateMatch({
      request: { ...request, property_types: ["apartment", "ground_floor"] },
      property: { ...property, property_type: "ground_floor", floor: null },
      requestFeatures: requires(), propertyFeatures: hasElevator(false),
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.matched_criteria).toContain("piano terra: ascensore non necessario");
  });

  it("esclude anche quando la riga dell'ascensore non e' stata registrata", () => {
    // Una scheda nasce con l'ascensore a «no»: un valore assente vale quanto
    // il default da cui proviene, non un dubbio da lasciare in lista.
    const result = calculateMatch({
      request, property: { ...property, floor: 2 },
      requestFeatures: requires(), propertyFeatures: [],
    });
    expect(result.score).toBe(0);
    expect(result.classification).toBe("not_relevant");
  });

  it("senza piano valorizzato lascia passare solo chi ha l'ascensore", () => {
    const senza = calculateMatch({
      request, property: { ...property, floor: null },
      requestFeatures: requires(), propertyFeatures: hasElevator(false),
    });
    const con = calculateMatch({
      request, property: { ...property, floor: null },
      requestFeatures: requires(), propertyFeatures: hasElevator(true),
    });
    expect(senza.score).toBe(0);
    expect(senza.conflicting_criteria).toContain("ascensore obbligatorio assente e piano non indicato");
    expect(con.score).toBeGreaterThan(0);
    expect(con.matched_criteria).toContain("Ascensore");
  });

  it("se la richiesta non pretende l'ascensore, propone entrambi gli immobili", () => {
    for (const preferenze of [undefined, requires("indifferent")]) {
      const con = calculateMatch({
        request, property: { ...property, floor: 2 },
        requestFeatures: preferenze, propertyFeatures: hasElevator(true),
      });
      const senza = calculateMatch({
        request, property: { ...property, floor: 2 },
        requestFeatures: preferenze, propertyFeatures: hasElevator(false),
      });
      expect(con.score).toBeGreaterThan(0);
      expect(senza.score).toBeGreaterThan(0);
      expect(senza.score).toBe(con.score);
      expect(senza.conflicting_criteria).toHaveLength(0);
    }
  });

  it("un ascensore soltanto preferito continua a pesare senza escludere", () => {
    const result = calculateMatch({
      request, property: { ...property, floor: 2 },
      requestFeatures: requires("preferred"), propertyFeatures: hasElevator(false),
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.missing_preferences).toContain("Ascensore");
    expect(result.conflicting_criteria).toHaveLength(0);
  });
});

describe("lettura del valore ascensore", () => {
  it("distingue assenza accertata e dato mancante", () => {
    expect(readBooleanFeature(true)).toBe(true);
    expect(readBooleanFeature(false)).toBe(false);
    expect(readBooleanFeature(null)).toBeNull();
    expect(readBooleanFeature(undefined)).toBeNull();
    expect(readBooleanFeature("")).toBeNull();
    expect(readBooleanFeature({})).toBeNull();
  });

  it("accetta le forme testuali e numeriche che arrivano da jsonb", () => {
    for (const value of ["true", "Si", "sì", "1", 1]) expect(readBooleanFeature(value)).toBe(true);
    for (const value of ["false", "no", "0", 0]) expect(readBooleanFeature(value)).toBe(false);
    expect(readBooleanFeature(7)).toBeNull();
  });
});

describe("rilevanza dell'ascensore", () => {
  it("non lo ritiene necessario al piano terra", () => {
    expect(elevatorIsRelevant({ ...property, floor: 0 })).toBe(false);
    expect(elevatorIsRelevant({ ...property, property_type: "ground_floor", floor: null })).toBe(false);
  });

  it("lo ritiene necessario dai piani superiori e dagli interrati", () => {
    expect(elevatorIsRelevant({ ...property, floor: 1 })).toBe(true);
    expect(elevatorIsRelevant({ ...property, floor: -1 })).toBe(true);
  });

  it("non decide quando il piano non e' noto", () => {
    expect(elevatorIsRelevant({ ...property, floor: null })).toBeNull();
  });
});

describe("etichette dell'ascensore nelle schede", () => {
  it("segnala la richiesta che lo pretende", () => {
    expect(requestRequiresElevator({
      request_feature_preferences: [{ preference_level: "required", feature: { key: "elevator" } }],
    })).toBe(true);
  });

  it("non lo segnala quando e' solo preferito o riguarda un'altra dotazione", () => {
    expect(requestRequiresElevator({
      request_feature_preferences: [{ preference_level: "preferred", feature: { key: "elevator" } }],
    })).toBe(false);
    expect(requestRequiresElevator({
      request_feature_preferences: [{ preference_level: "required", feature: { key: "balcony" } }],
    })).toBe(false);
    expect(requestRequiresElevator({})).toBe(false);
  });

  it("segnala l'incarico che ha l'ascensore", () => {
    expect(propertyHasElevator({
      property_feature_values: [{ value: true, feature: { key: "elevator" } }],
    })).toBe(true);
  });

  it("non lo segnala quando manca, e' a no, o la lista non e' stata caricata", () => {
    expect(propertyHasElevator({
      property_feature_values: [{ value: false, feature: { key: "elevator" } }],
    })).toBe(false);
    expect(propertyHasElevator({
      property_feature_values: [{ value: true, feature: { key: "balcony" } }],
    })).toBe(false);
    expect(propertyHasElevator({})).toBe(false);
  });
});

describe("tipologia presa dalla sottotipologia del gestionale", () => {
  // Il caso Terry: «Sottotipologia Immobile: Villa singola» compilata, campo
  // «Tipologia Immobile» vuoto. property_types arrivava vuoto e il motore dava
  // punteggio pieno con la spunta «tipologia» a un appartamento.
  const terry: PropertyRequest = {
    ...request,
    property_types: [],
    raw_payload: { fields: { "Sottotipologia Immobile": "Villa singola" } },
  };

  it("non propone un appartamento a chi ha chiesto una villa singola", () => {
    const appartamento = calculateMatch({ request: terry, property: { ...property, property_type: "apartment" } });
    expect(appartamento.score).toBe(0);
    expect(appartamento.classification).toBe("not_relevant");
    expect(appartamento.conflicting_criteria).toContain("tipologia incompatibile");
    expect(appartamento.matched_criteria).not.toContain("tipologia");
  });

  it("continua a proporre la villa", () => {
    const villa = calculateMatch({ request: terry, property: { ...property, property_type: "villa" } });
    expect(villa.score).toBeGreaterThan(0);
    expect(villa.matched_criteria).toContain("tipologia");
  });

  it("non spunta la tipologia quando nessuno l'ha indicata", () => {
    const senzaTipologia = calculateMatch({
      request: { ...request, property_types: [] },
      property: { ...property, property_type: "garage" },
    });
    expect(senzaTipologia.matched_criteria).not.toContain("tipologia");
    expect(senzaTipologia.missing_preferences).toContain("tipologia non indicata nella richiesta");
    // Non sapere non e' un motivo per escludere: la casa resta valutabile.
    expect(senzaTipologia.score).toBeGreaterThan(0);
  });

  it("il campo strutturato ha la precedenza sulla sottotipologia", () => {
    const dichiarata = resolveRequestPropertyTypes({
      ...terry,
      property_types: ["apartment"],
    });
    expect(dichiarata).toEqual(["apartment"]);
  });
});

describe("lettura delle dizioni del gestionale", () => {
  it("distingue la villa dalla villetta a schiera", () => {
    expect(propertyTypeFromText("Villa singola")).toBe("villa");
    expect(propertyTypeFromText("Villetta a schiera")).toBe("townhouse");
    expect(propertyTypeFromText("Bifamiliare")).toBe("townhouse");
  });

  it("riconosce le dizioni piu' comuni", () => {
    expect(propertyTypeFromText("Appartamento")).toBe("apartment");
    expect(propertyTypeFromText("Trilocale")).toBe("apartment");
    expect(propertyTypeFromText("Attico")).toBe("penthouse");
    expect(propertyTypeFromText("Piano terra")).toBe("ground_floor");
    expect(propertyTypeFromText("Box auto")).toBe("garage");
    expect(propertyTypeFromText("Negozio")).toBe("commercial_space");
  });

  it("non indovina su un testo che non riconosce", () => {
    expect(propertyTypeFromText("qualcosa di non previsto")).toBeNull();
    expect(propertyTypeFromText("")).toBeNull();
    expect(propertyTypeFromText(null)).toBeNull();
  });
});

function square(longitude: number, latitude: number): GeoJsonGeometry {
  const offset = .001;
  return { type: "Polygon", coordinates: [[
    [longitude - offset, latitude - offset],
    [longitude + offset, latitude - offset],
    [longitude + offset, latitude + offset],
    [longitude - offset, latitude + offset],
    [longitude - offset, latitude - offset],
  ]] };
}
