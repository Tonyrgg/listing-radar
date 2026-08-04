import type {
  Client,
  CrmFieldValue,
  CrmRelatedSection,
  CrmRequestRawPayload,
  PropertyRequest,
} from "./types";

type RequestWithClient = PropertyRequest & { clients?: Partial<Client> | null };

export function requestPayload(request: PropertyRequest): CrmRequestRawPayload {
  return request.raw_payload && typeof request.raw_payload === "object"
    ? request.raw_payload
    : {};
}

export function crmField(
  payload: CrmRequestRawPayload,
  key: string,
): CrmFieldValue | undefined {
  return payload.fields?.[key] ?? payload.headerFields?.[key];
}

export function displayValue(
  value: CrmFieldValue | undefined,
  fallback = "Non indicato",
): string {
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function cleanRequestTitle(title?: string | null) {
  const cleaned = title?.replace(/^Richiesta Immobiliare\s*/i, "").trim();
  return cleaned || "Richiesta senza titolo";
}

export function requestReference(request: PropertyRequest) {
  const payload = requestPayload(request);
  return payload.externalId || request.external_crm_id || request.id.slice(0, 8).toUpperCase();
}

export function requestSourceLabel(request: PropertyRequest) {
  return request.source === "crm_archive" ? "Archivio CRM" : "Listing Radar";
}

export function requestBudget(request: PropertyRequest) {
  const raw = crmField(requestPayload(request), "Prezzo");
  if (typeof raw === "string" && raw.trim()) return raw.replace("EUR", "€").trim();
  const amount = request.contract_type === "sale"
    ? request.budget_max
    : request.monthly_rent_max;
  if (!amount) return "Da definire";
  const formatted = `€ ${Number(amount).toLocaleString("it-IT")}`;
  return request.contract_type === "rent" ? `${formatted}/mese` : formatted;
}

export function requestArea(request: PropertyRequest) {
  const raw = crmField(requestPayload(request), "Metri Quadri");
  if (raw !== null && raw !== undefined && raw !== "") return `${raw} mq`;
  if (!request.internal_sqm_min) return "Flessibile";
  return `${request.internal_sqm_min}${request.internal_sqm_max ? `–${request.internal_sqm_max}` : "+"} mq`;
}

export function requestRooms(request: PropertyRequest) {
  const raw = crmField(requestPayload(request), "Numero Locali");
  if (raw !== null && raw !== undefined && raw !== "") return String(raw);
  return request.rooms_min ? `${request.rooms_min}+` : "Non indicati";
}

export function requestActivityCount(request: PropertyRequest) {
  const sections = requestPayload(request).relatedSections ?? [];
  return sections.filter(isActivitySection).length;
}

export function requestActivities(request: PropertyRequest): CrmRelatedSection[] {
  const payload = requestPayload(request);
  const activities = (payload.relatedSections ?? []).filter(isActivitySection);
  if (payload.evolutionText?.trim()) {
    activities.unshift({ heading: "Evoluzione richiesta", text: payload.evolutionText.trim() });
  }
  return activities;
}

export function clientContact(client?: Partial<Client> | null) {
  const raw = client?.raw_payload;
  const fields = raw && typeof raw === "object"
    ? (raw.request_contact_fields as Record<string, unknown> | undefined)
    : undefined;
  return {
    phone: client?.phone || stringValue(fields?.Cellulare) || stringValue(fields?.["Telefono fisso"]),
    email: client?.email || stringValue(fields?.Email),
    address: stringValue(fields?.["Indirizzo Residenza"]),
  };
}

export function requestSearchText(request: RequestWithClient) {
  const payload = requestPayload(request);
  return [
    request.title,
    request.clients?.full_name,
    request.external_crm_id,
    payload.externalId,
    ...Object.values(payload.fields ?? {}),
    ...Object.values(payload.headerFields ?? {}),
  ].filter((value) => value !== null && value !== undefined).join(" ").toLocaleLowerCase("it");
}

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return "Non indicata";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return withTime
    ? date.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isActivitySection(section: CrmRelatedSection) {
  const heading = section.heading.trim();
  const text = section.text.trim();
  if (!text || /loading$/i.test(text)) return false;
  if (/cliente|privacy|servizi/i.test(heading)) return false;
  if (/evoluzione|eseguito|proposta|appuntamento|aggiornamento|contatto/i.test(heading)) return true;
  return /attività|appuntament|ultimo contatto|proposta/i.test(text) && !/^sezione\s*[3456]$/i.test(heading);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
