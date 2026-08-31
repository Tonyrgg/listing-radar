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
 * L'unica eccezione e' il piano terra: li' l'ascensore non serve, quindi non
 * averlo non e' un difetto e l'immobile prende comunque il punteggio pieno.
 *
 * Fuori da quel caso passa solo l'ascensore dichiarato presente. Una scheda
 * nasce con l'ascensore a «no» e viene corretta dopo, quindi un valore assente
 * o illeggibile vale «no» come il default da cui proviene. Vale anche quando il
 * piano non e' compilato: senza il piano non si puo' dire che l'ascensore sia
 * superfluo, e chi lo ha chiesto non deve vedere quell'immobile.
 */

export const ELEVATOR_FEATURE_KEY = "elevator";

export type ElevatorVerdict =
  /** La richiesta non pretende l'ascensore: la regola non si applica. */
  | { kind: "not_requested" }
  /** L'ascensore c'e', oppure non serve perche' l'immobile e' al piano terra. */
  | { kind: "satisfied"; label: string }
  /** Ascensore non dichiarato presente dove servirebbe: l'immobile esce. */
  | { kind: "excluded"; reason: string };

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

/**
 * Le due letture che servono alle schede per mostrare l'ascensore fra le
 * etichette. Lavorano sulle righe come arrivano dalle liste, che portano la
 * chiave della caratteristica e non l'identificativo.
 */
export function requestRequiresElevator(request: {
  request_feature_preferences?: readonly {
    preference_level: string;
    feature?: { key?: string | null } | null;
  }[] | null;
}) {
  return (request.request_feature_preferences ?? []).some(
    (item) => item.feature?.key === ELEVATOR_FEATURE_KEY && item.preference_level === "required",
  );
}

export function propertyHasElevator(property: {
  property_feature_values?: readonly {
    value: unknown;
    feature?: { key?: string | null } | null;
  }[] | null;
}) {
  const stored = (property.property_feature_values ?? []).find(
    (item) => item.feature?.key === ELEVATOR_FEATURE_KEY,
  );
  return stored ? readBooleanFeature(stored.value) === true : false;
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
  if (stored && readBooleanFeature(stored.value) === true) {
    return { kind: "satisfied", label: "Ascensore" };
  }

  // Il piano mancante non attenua l'esclusione, ma cambia cosa deve correggere
  // l'operatore: compilare il piano puo' riportare l'immobile in lista.
  return relevant == null
    ? { kind: "excluded", reason: "ascensore obbligatorio assente e piano non indicato" }
    : { kind: "excluded", reason: "ascensore obbligatorio assente" };
}
