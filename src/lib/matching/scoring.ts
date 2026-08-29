import type { MatchClassification, MatchingConfig, ScoreBand } from "./types";

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  thresholds: { compatible: 85, almostCompatible: 65, weak: 40 },
  budgetTolerance: { near: 0.05, weak: 0.15 },
  commercialSqm: { minimumFactor: 1.1, maximumFactor: 1.2 },
  weights: {
    // La tipologia vale poco apposta: da quando e' un filtro duro, chi arriva
    // in lista l'ha gia' superata, e un punteggio che prendono tutti non
    // ordina niente. I punti stanno dove i candidati si distinguono davvero.
    propertyType: 5, zone: 20, budget: 20, internalSqm: 25,
    rooms: 10, floor: 5, condition: 5, availability: 5,
  },
  // Costare meno della richiesta non e' un difetto, ma sotto la meta' si sta
  // guardando un altro segmento di mercato. Sopra il tetto dichiarato resta un
  // quarto di margine, che e' lo spazio della trattativa.
  budgetBands: { floorRatio: 0.4, halfRatio: 0.5, sweetRatio: 0.85, overRatio: 0.25 },
  // Scaglioni sullo scarto dalla metratura chiesta, simmetrici. La spunta si
  // ferma a 10 mq: oltre, l'immobile e' un'altra casa. Oltre i 30 non risponde
  // piu' alla domanda. La metratura pesa piu' del resto perche' e' il vincolo
  // che il cliente non tratta.
  sqmBands: [
    { upTo: 5, score: 1 }, { upTo: 10, score: 0.85 }, { upTo: 15, score: 0.65 },
    { upTo: 20, score: 0.4 }, { upTo: 30, score: 0.15 },
  ],
  sqmBeyondScore: 0.02,
  // Un vano di scarto passa, due scendono in fondo alla lista.
  roomsBands: [{ upTo: 0, score: 1 }, { upTo: 1, score: 0.8 }, { upTo: 2, score: 0.2 }],
  roomsBeyondScore: 0,
  declaredRangeFloor: 0.78,
  propertyTypeFamilyRatio: 0.85,
};

/* Le famiglie decidono cosa e' ancora la stessa domanda. Fuori dalla famiglia
 * il match non nasce proprio: chi cerca una villa non vuole vedere un box,
 * nemmeno in fondo alla lista. Villa e villetta a schiera stanno separate
 * apposta — sono due prodotti diversi, non due sfumature. */
export const PROPERTY_TYPE_FAMILIES: Record<string, string> = {
  apartment: "collettivo", penthouse: "collettivo", ground_floor: "collettivo",
  independent_house: "indipendente", villa: "indipendente",
  townhouse: "schiera",
  commercial_space: "commerciale", office: "commerciale", warehouse: "commerciale",
  entire_building: "stabile", garage: "accessorio", land: "terreno",
};

function familyOf(propertyType: string) {
  return PROPERTY_TYPE_FAMILIES[propertyType] ?? propertyType;
}

function interpolate(value: number, fromValue: number, toValue: number, fromScore: number, toScore: number) {
  if (toValue <= fromValue) return toScore;
  const ratio = Math.max(0, Math.min(1, (value - fromValue) / (toValue - fromValue)));
  return fromScore + (toScore - fromScore) * ratio;
}

function bandScore(distance: number, bands: readonly ScoreBand[], beyond: number) {
  for (const band of bands) if (distance <= band.upTo) return band.score;
  return beyond;
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyScore(score: number, config = DEFAULT_MATCHING_CONFIG): MatchClassification {
  if (score >= config.thresholds.compatible) return "compatible";
  if (score >= config.thresholds.almostCompatible) return "almost_compatible";
  if (score >= config.thresholds.weak) return "weak";
  return "not_relevant";
}

/* Il vecchio calcolo apriva con `value <= target ? 1`, senza pavimento: un box
 * da 8.000 euro prendeva il pieno su una richiesta da 130.000. Adesso il prezzo
 * ha due code, e sotto la meta' della richiesta la coda scende davvero. */
export function scoreBudget(
  value: number | null,
  ideal: number | null,
  maximum: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  if (value == null || (ideal == null && maximum == null)) return 0.65;
  const target = ideal ?? maximum!;
  const limit = Math.max(maximum ?? target, target);
  const bands = config.budgetBands;
  if (value > limit) {
    const over = (value - limit) / limit;
    return over > bands.overRatio ? 0 : interpolate(over, 0, bands.overRatio, 0.9, 0.35);
  }
  // Con il solo tetto dichiarato target e limit coincidono: centrarlo vale
  // pieno, altrimenti 129.999 varrebbe piu' di 130.000.
  if (value >= target) return limit > target ? interpolate(value, target, limit, 1, 0.9) : 1;
  const ratio = value / target;
  if (ratio >= bands.sweetRatio) return 1;
  if (ratio >= bands.halfRatio) return interpolate(ratio, bands.halfRatio, bands.sweetRatio, 0.8, 1);
  if (ratio >= bands.floorRatio) return interpolate(ratio, bands.floorRatio, bands.halfRatio, 0.3, 0.8);
  return 0.1;
}

/* Metratura e vani condividono la stessa forma: distanza dal valore chiesto,
 * letta a scaglioni. L'unico sconto e' per gli intervalli che il cliente ha
 * dichiarato lui: se ha scritto «da 70 a 110», un 110 resta accettabile anche
 * se dista 20 mq dall'ideale. */
function scoreDistance(
  value: number | null,
  minimum: number | null,
  ideal: number | null,
  maximum: number | null,
  bands: readonly ScoreBand[],
  beyond: number,
  declaredFloor: number,
) {
  if (value == null) return 0.65;
  const midpoint = minimum != null && maximum != null ? (minimum + maximum) / 2 : minimum ?? maximum;
  const target = ideal ?? midpoint;
  if (target == null) return 0.65;
  const score = bandScore(Math.abs(value - target), bands, beyond);
  const insideDeclared = (minimum != null || maximum != null)
    && (minimum == null || value >= minimum)
    && (maximum == null || value <= maximum);
  return insideDeclared ? Math.max(score, declaredFloor) : score;
}

export function scoreInternalSqm(
  value: number | null,
  minimum: number | null,
  ideal: number | null,
  maximum: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  return scoreDistance(value, minimum, ideal, maximum, config.sqmBands, config.sqmBeyondScore, config.declaredRangeFloor);
}

export function scoreRooms(
  value: number | null,
  minimum: number | null,
  ideal: number | null,
  maximum: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  return scoreDistance(value, minimum, ideal, maximum, config.roomsBands, config.roomsBeyondScore, config.declaredRangeFloor);
}

/* Restituisce null quando la tipologia e' fuori famiglia: il chiamante lo
 * legge come esclusione, non come punteggio basso. */
export function scorePropertyType(
  requested: readonly string[],
  actual: string,
  config = DEFAULT_MATCHING_CONFIG,
): number | null {
  if (!requested.length) return 1;
  if (requested.includes(actual)) return 1;
  const families = new Set(requested.map(familyOf));
  return families.has(familyOf(actual)) ? config.propertyTypeFamilyRatio : null;
}

export function scoreRange(
  value: number | null,
  minimum: number | null,
  ideal: number | null,
  maximum: number | null,
) {
  if (value == null || (minimum == null && ideal == null && maximum == null)) return 0.65;
  if (minimum != null && value < minimum) return Math.max(0, value / minimum);
  if (maximum != null && value > maximum) return Math.max(0, 1 - (value - maximum) / maximum);
  if (ideal == null) return 1;
  return Math.max(0.75, 1 - Math.abs(value - ideal) / Math.max(ideal, 1));
}

export function estimateCommercialSqm(
  internalSqm: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  if (internalSqm == null) return { minimum: null, maximum: null };
  return {
    minimum: Math.round(internalSqm * config.commercialSqm.minimumFactor),
    maximum: Math.round(internalSqm * config.commercialSqm.maximumFactor),
  };
}

export function sqmCoherenceWarnings(internalSqm: number | null, rooms: number | null) {
  if (internalSqm == null || rooms == null) return [];
  if (rooms >= 5 && internalSqm <= 45) return ["Vani elevati rispetto alla metratura interna"];
  if (rooms <= 2 && internalSqm >= 160) return ["Metratura elevata rispetto al numero di vani"];
  return [];
}

