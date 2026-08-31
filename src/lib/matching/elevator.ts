import type { MatchingContext } from "./types";

/**
 * Regola dell'ascensore.
 *
 * Chi chiede l'ascensore non sta esprimendo una preferenza: sta dicendo che le
 * scale non le fa. Un immobile senza ascensore non e' un match debole, e' un
 * immobile che quel cliente non puo' comprare, e mostrarlo in fondo alla lista
 * fa perdere tempo a tutti. Per questo la regola esclude invece di togliere
 * punti, come gia' fanno contratto e tipologia.
 *
 * Con due eccezioni che contano quanto la regola:
 *
 * 1. al piano terra l'ascensore non serve, quindi non averlo non e' un difetto;
 * 2. quando il dato non c'e', non si esclude. Una riga mai compilata non prova
 *    l'assenza dell'ascensore, e far sparire un immobile per un campo vuoto
 *    sarebbe un errore silenzioso. In quel caso il match resta visibile con un
 *    conflitto che dice all'operatore cosa andare a verificare.
 */

export const ELEVATOR_FEATURE_KEY = "elevator";

export type ElevatorVerdict =
  /** La richiesta non pretende l'ascensore: la regola non si applica. */
  | { kind: "not_requested" }
  /** L'ascensore c'e', oppure non serve perche' l'immobile e' al piano terra. */
  | { kind: "satisfied"; label: string }
  /** Assenza accertata dove l'ascensore serve davvero: l'immobile esce. */
  | { kind: "excluded"; reason: string }
  /** Dato insufficiente per decidere: si segnala, non si esclude. */
  | { kind: "unverified"; reason: string };

const TRUTHY = new Set(["true", "si", "sì", "yes", "y", "1", "presente"]);
const FALSY = new Set(["false", "no", "n", "0", "assente"]);

/**
 * Legge un valore `jsonb` come booleano a tre stati. `null` significa
 * "non lo sappiamo", che non e' la stessa cosa di "non c'e'".
 */
export function readBooleanFeature(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase("it");
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
    return null;
  }
  return null;
}

/**
 * Dice se per questo immobile l'ascensore serve. `null` quando il piano non e'
 * noto: senza il piano non si puo' affermare ne' che serva ne' che non serva.
 */
export function elevatorIsRelevant(property: MatchingContext["property"]): boolean | null {
  // La tipologia «piano terra» e' un'informazione esplicita e vale anche
  // quando il campo piano e' rimasto vuoto.
  if (property.property_type === "ground_floor") return false;
  if (property.floor == null) return null;
  // Solo il piano terra esatto e' esente. Un interrato ha comunque le sue
  // scale, e chi ha chiesto l'ascensore non le vuole fare in nessun verso.
  return property.floor !== 0;
}

export function evaluateElevatorRequirement(context: MatchingContext): ElevatorVerdict {
  const preference = (context.requestFeatures ?? []).find(
    (item) => item.feature?.key === ELEVATOR_FEATURE_KEY && item.preference_level === "required",
  );
  if (!preference) return { kind: "not_requested" };

  const relevant = elevatorIsRelevant(context.property);
  if (relevant === false) {
    return { kind: "satisfied", label: "piano terra: ascensore non necessario" };
  }

  const stored = (context.propertyFeatures ?? []).find(
    (item) => item.feature_definition_id === preference.feature_definition_id,
  );
  const present = stored ? readBooleanFeature(stored.value) : null;

  if (present === true) return { kind: "satisfied", label: "Ascensore" };
  if (present == null) {
    return { kind: "unverified", reason: "ascensore obbligatorio: dato non disponibile, da verificare" };
  }
  if (relevant == null) {
    return { kind: "unverified", reason: "ascensore assente ma piano non indicato, da verificare" };
  }
  return { kind: "excluded", reason: "ascensore obbligatorio assente" };
}
