export const PRIVATE_PORTAL_LABELS = {
  idealista: "Idealista",
  immobiliare: "Immobiliare.it",
  casa: "Casa.it",
  subito: "Subito",
  casadaprivato: "CasaDaPrivato",
} as const;

export type SourceScanTarget = {
  kind: "agency" | "portal";
  key: string;
  name: string;
  icon?: string;
};

export const SOURCE_SCAN_ACTIVE = ["QUEUED", "RUNNING", "RETRY"] as const;
