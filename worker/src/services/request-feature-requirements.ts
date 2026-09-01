import type { CrmRequestDetail } from "../adapters/crm/requests.js";

/**
 * Le dotazioni che il CRM dichiara con un campo suo.
 *
 * Il CRM tiene l'ascensore in un campo dedicato della richiesta: quando è
 * spuntato, il cliente ha detto che le scale non le fa. Fino a oggi quel campo
 * finiva soltanto dentro `raw_payload`, cioè restava testo da leggere a mano:
 * il motore non lo vedeva, la scheda stampava «ascensore no» e al cliente
 * arrivavano case senza ascensore.
 *
 * Qui il campo diventa una preferenza vera, con lo stesso significato che ha
 * nella regola dell'ascensore: chi lo chiede lo pretende, quindi
 * `required`, non `preferred`.
 *
 * Si traduce solo ciò che il CRM dichiara in modo esplicito. Un campo vuoto,
 * ambiguo o scritto a mano non diventa un obbligo per deduzione: resta da
 * guardare, e `unreadableFeatureDeclarations` lo mette in evidenza per chi
 * riallinea l'archivio.
 */

export type RequestFeatureRequirement = {
  feature_key: string;
  preference_level: "required";
  desired_value: true;
  crm_field: string;
  declared_as: string;
};

export type UnreadableFeatureDeclaration = {
  feature_key: string;
  crm_field: string;
  declared_as: string;
};

/** Campo del CRM → caratteristica dell'archivio. */
const DECLARED_FEATURE_FIELDS: ReadonlyArray<{ crm_field: string; feature_key: string }> = [
  { crm_field: "Ascensore", feature_key: "elevator" },
];

const AFFIRMATIVE = new Set([
  "si", "s", "true", "1", "yes", "y",
  "necessario", "indispensabile", "obbligatorio", "richiesto", "con ascensore",
]);

const NEGATIVE = new Set([
  "no", "n", "false", "0",
  "non necessario", "non richiesto", "indifferente", "irrilevante", "senza ascensore",
]);

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
}

type Declaration = { state: "yes" | "no" | "absent" | "unreadable"; declared_as: string };

function readDeclaration(value: string | boolean | null | undefined): Declaration {
  if (typeof value === "boolean") return { state: value ? "yes" : "no", declared_as: value ? "Sì" : "No" };
  if (value === null || value === undefined || !value.trim()) return { state: "absent", declared_as: "" };
  const normalized = normalize(value);
  if (AFFIRMATIVE.has(normalized)) return { state: "yes", declared_as: value.trim() };
  if (NEGATIVE.has(normalized)) return { state: "no", declared_as: value.trim() };
  return { state: "unreadable", declared_as: value.trim() };
}

function declaredField(detail: Pick<CrmRequestDetail, "fields" | "headerFields">, label: string) {
  return detail.fields?.[label] ?? detail.headerFields?.[label] ?? null;
}

type FeatureSource = Pick<CrmRequestDetail, "fields"> & Partial<Pick<CrmRequestDetail, "headerFields">>;

/** Le caratteristiche che questa richiesta pretende, secondo il CRM. */
export function crmRequestFeatureRequirements(detail: FeatureSource): RequestFeatureRequirement[] {
  const requirements: RequestFeatureRequirement[] = [];
  for (const { crm_field, feature_key } of DECLARED_FEATURE_FIELDS) {
    const declaration = readDeclaration(declaredField({ headerFields: {}, ...detail }, crm_field));
    if (declaration.state !== "yes") continue;
    requirements.push({
      feature_key,
      preference_level: "required",
      desired_value: true,
      crm_field,
      declared_as: declaration.declared_as,
    });
  }
  return requirements;
}

/**
 * I campi compilati con parole che non sappiamo leggere. Non diventano
 * obblighi da soli: vanno guardati da una persona.
 */
export function unreadableFeatureDeclarations(detail: FeatureSource): UnreadableFeatureDeclaration[] {
  const unreadable: UnreadableFeatureDeclaration[] = [];
  for (const { crm_field, feature_key } of DECLARED_FEATURE_FIELDS) {
    const declaration = readDeclaration(declaredField({ headerFields: {}, ...detail }, crm_field));
    if (declaration.state !== "unreadable") continue;
    unreadable.push({ feature_key, crm_field, declared_as: declaration.declared_as });
  }
  return unreadable;
}
