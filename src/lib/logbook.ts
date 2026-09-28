import { lifecycleEventLabel } from "@/lib/property-lifecycle/read-models/presentation";

export type LogbookEvent = {
  id: string;
  event_category: string;
  event_type: string;
  source_type: string | null;
  property_id: string | null;
  contact_id: string | null;
  client_id: string | null;
  lead_id: string | null;
  request_id: string | null;
  occurred_at: string;
  title: string;
  description: string | null;
  outcome: string | null;
  importance: string;
  requires_action: boolean;
  next_action_type: string | null;
  next_action_at: string | null;
  address: string | null;
  locality: string | null;
  person_name: string | null;
  automatic: boolean;
  sensitive: boolean;
};

const labels: Record<string,string> = {
  private_publication_new: "Nuovo annuncio privato",
  private_price_drop: "Ribasso privato",
  opportunity_created: "Nuova opportunità",
  buyer_request_created: "Nuova richiesta cliente",
  appointment_booked: "Acquisizione fissata",
  phone_call: "Telefonata",
  whatsapp: "WhatsApp registrato",
  sms: "SMS registrato",
  email: "Email registrata",
  in_person: "Conversazione di persona",
  zone_visit: "Attività in zona",
  verification: "Verifica",
  note: "Nota",
  acquisition: "Acquisizione svolta",
  status_change: "Stato aggiornato",
  private_sign: "Cartello privato",
  property_check: "Verifica immobile",
  referral: "Segnalazione",
};

export function eventLabel(row: LogbookEvent): string {
  if (row.event_category === "MARKET") {
    return labels[row.event_type] ?? lifecycleEventLabel(row.event_type.toUpperCase());
  }
  return labels[row.event_type] ?? (row.title && !/^[A-Z_]+$/.test(row.title)
    ? row.title : "Attività registrata");
}

export const categoryLabel: Record<string,string> = {
  MARKET:"Mercato", INTELLIGENCE:"Notizia", CONTACT:"Contatto",
  FIELD:"Zona", PIPELINE:"Pipeline", SYSTEM:"Sistema",
};

export function eventHref(row: LogbookEvent): string | null {
  if (row.lead_id) return `/acquisition/${row.lead_id}`;
  if (row.contact_id) return `/contacts/${row.contact_id}`;
  if (row.client_id) return `/contacts/${row.client_id}`;
  if (row.property_id) return `/casa/${row.property_id}#diario`;
  if (row.request_id) return `/requests/${row.request_id}`;
  return null;
}

export function formatEventTime(value: string, full = false): string {
  return new Intl.DateTimeFormat("it-IT",{
    timeZone:"Europe/Rome",day:"2-digit",month:"short",
    ...(full ? {year:"numeric"} : {}),hour:"2-digit",minute:"2-digit",
  }).format(new Date(value));
}

export function parseMonth(raw?: string): string {
  const today = new Intl.DateTimeFormat("sv-SE",{
    timeZone:"Europe/Rome",year:"numeric",month:"2-digit",
  }).format(new Date());
  if (!raw) return today;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : today;
}

export function adjacentMonth(month: string, offset: number): string {
  const [year,number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year,number-1+offset,1));
  return date.toISOString().slice(0,7);
}

export function monthTitle(month: string): string {
  const [year,number] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat("it-IT",{month:"long",year:"numeric"})
    .format(new Date(Date.UTC(year,number-1,15)));
  return title.charAt(0).toUpperCase()+title.slice(1);
}
