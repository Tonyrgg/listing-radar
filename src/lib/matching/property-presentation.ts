import type { PortfolioProperty } from "./types";

export function propertyConditionLabel(value: string | null) {
  return ({
    new: "Nuovo",
    renovated: "Ristrutturato",
    normal: "Normale",
    to_renovate: "Da ristrutturare",
    poor: "Scarso",
    excellent: "Ristrutturato",
    good: "Normale",
    habitable: "Normale",
  }[value ?? ""] ?? value ?? "Non indicato");
}

export function propertyCrmCondition(property: PortfolioProperty, field: "Stato Interno" | "Stato Esterno") {
  const raw = property.raw_payload;
  if (!raw || typeof raw !== "object") return null;
  const fields = raw.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const value = (fields as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * L'indirizzo della scheda nel gestionale.
 *
 * L'indirizzo vero lo conosce il CRM e lo abbiamo salvato quando l'incarico e'
 * stato importato: si usa quello, non uno ricostruito. Quando manca — le schede
 * inserite a mano, o importate prima che l'indirizzo venisse conservato — si
 * ripiega sull'identificativo, che porta alla stessa pagina.
 *
 * Il `raw_payload` arriva da una pagina letta da un browser, quindi non e' un
 * dato di cui fidarsi: si accettano solo indirizzi https sull'host del
 * gestionale. Un link verso altrove, in una scheda che l'operatore apre di
 * fiducia, sarebbe il posto peggiore dove trovarselo.
 */
const CRM_HOST = "tecnocasa-group.my.site.com";
const CRM_BASE = `https://${CRM_HOST}/CRMImmobiliareLightning/s`;

function trustedCrmUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== CRM_HOST) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function propertyCrmUrl(property: PortfolioProperty) {
  const raw = property.raw_payload;
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  // `sourceUrl` e' la scheda dell'incarico, `url` quella dell'immobile: la
  // prima e' il punto da cui si governa il mandato, quindi viene prima.
  return trustedCrmUrl(payload.sourceUrl)
    ?? trustedCrmUrl(payload.url)
    ?? (property.external_mandate_id
      ? `${CRM_BASE}/incarico/${encodeURIComponent(property.external_mandate_id)}`
      : null)
    ?? (property.external_crm_id
      ? `${CRM_BASE}/immobile/${encodeURIComponent(property.external_crm_id)}`
      : null);
}
