export type AlertSource =
  | "idealista"
  | "immobiliare"
  | "subito"
  | "casa"
  | "wikicasa"
  | "casadaprivato"
  | "unknown";

export interface ParsedEmailAlert {
  source: AlertSource;
  sourceListingId: string | null;
  url: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  rooms: number | null;
  zone: string | null;
  imageUrl: string | null;
  rawPayload: Record<string, unknown>;
}

export interface EmailIngestionResult {
  enabled: boolean;
  connected: boolean;
  messagesChecked: number;
  messagesProcessed: number;
  messagesSkipped: number;
  incomingInserted: number;
  incomingUpdated: number;
  errors: Array<{
    message: string;
    messageId?: string;
  }>;
}
