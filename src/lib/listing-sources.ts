export const FILTERABLE_LISTING_SOURCE_OPTIONS = [
  "admaiora",
  "futura",
  "iconacasa",
  "ingegnericolapinto",
  "immobiliaririunite",
  "puntocasa",
  "studisanti",
  "vistocasa",
  "subito",
  "casa",
  "idealista",
  "immobiliare",
  "wikicasa",
  "casadaprivato",
  "bakeca",
] as const;

const SOURCE_ALIASES: Record<string, string> = {
  "ad maiora": "admaiora",
  admaiora: "admaiora",
  "admaioraimmobiliare.it": "admaiora",
  futura: "futura",
  "futurabitonto.it": "futura",
  iconacasa: "iconacasa",
  "iconacasa bitonto": "iconacasa",
  "iconacasa.com": "iconacasa",
  ingegnericolapinto: "ingegnericolapinto",
  "ingegneri colapinto": "ingegnericolapinto",
  "ingegnericolapinto.it": "ingegnericolapinto",
  immobiliaririunite: "immobiliaririunite",
  "immobiliari riunite": "immobiliaririunite",
  "immobiliaririunite.it": "immobiliaririunite",
  puntocasa: "puntocasa",
  "punto casa": "puntocasa",
  puntocasagroup: "puntocasa",
  "puntocasa group": "puntocasa",
  "puntocasagroup.it": "puntocasa",
  studisanti: "studisanti",
  "studi santi": "studisanti",
  "studi santi immobiliare": "studisanti",
  "studisantiimmobiliare.it": "studisanti",
  vistocasa: "vistocasa",
  "vistocasa bitonto": "vistocasa",
  "vistocasa.com": "vistocasa",
  subito: "subito",
  "subito.it": "subito",
  casa: "casa",
  "casa.it": "casa",
  idealista: "idealista",
  "idealista.it": "idealista",
  immobiliare: "immobiliare",
  "immobiliare.it": "immobiliare",
  wikicasa: "wikicasa",
  "wikicasa.it": "wikicasa",
  casadaprivato: "casadaprivato",
  casedaprivato: "casadaprivato",
  "casa da privato": "casadaprivato",
  "casadaprivato.it": "casadaprivato",
  bakeca: "bakeca",
  "bakeca.it": "bakeca",
  browserextension: "browser-extension",
  "browser extension": "browser-extension",
};

const GENERIC_IMPORT_SOURCES = new Set([
  "browser",
  "browser-extension",
  "feed",
  "import",
]);

const STORAGE_SOURCE_ALIASES: Record<string, string[]> = {
  subito: ["Subito", "SUBITO", "subito.it", "Subito.it"],
  casa: ["Casa.it", "casa.it"],
  idealista: ["Idealista", "idealista.it"],
  immobiliare: ["Immobiliare.it", "immobiliare.it"],
  wikicasa: ["Wikicasa", "wikicasa.it"],
  casadaprivato: [
    "CasaDaPrivato",
    "casadaprivato.it",
    "casedaprivato",
    "Casa Da Privato",
  ],
  bakeca: ["Bakeca", "bakeca.it"],
};

function sourceKey(value: string) {
  return value.trim().toLowerCase();
}

function compactSourceKey(value: string) {
  return sourceKey(value).replace(/[\s_-]+/g, "");
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function normalizeListingSource(value: string) {
  const normalized = sourceKey(value);
  const compact = compactSourceKey(value);

  return SOURCE_ALIASES[normalized] ?? SOURCE_ALIASES[compact] ?? normalized;
}

export function inferListingSourceFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();

    if (hostMatches(hostname, "casadaprivato.it")) return "casadaprivato";
    if (hostMatches(hostname, "subito.it")) return "subito";
    if (hostMatches(hostname, "casa.it")) return "casa";
    if (hostMatches(hostname, "idealista.it")) return "idealista";
    if (hostMatches(hostname, "immobiliare.it")) return "immobiliare";
    if (hostMatches(hostname, "wikicasa.it")) return "wikicasa";
    if (hostMatches(hostname, "bakeca.it")) return "bakeca";
    if (hostMatches(hostname, "admaioraimmobiliare.it")) return "admaiora";
    if (hostMatches(hostname, "futurabitonto.it")) return "futura";
    if (hostMatches(hostname, "iconacasa.com")) return "iconacasa";
    if (hostMatches(hostname, "ingegnericolapinto.it")) {
      return "ingegnericolapinto";
    }
    if (hostMatches(hostname, "immobiliaririunite.it")) {
      return "immobiliaririunite";
    }
    if (hostMatches(hostname, "puntocasagroup.it")) return "puntocasa";
    if (hostMatches(hostname, "studisantiimmobiliare.it")) {
      return "studisanti";
    }
    if (hostMatches(hostname, "vistocasa.com")) return "vistocasa";
  } catch {
    return null;
  }

  return null;
}

export function isGenericListingSource(value: string | null | undefined) {
  return value ? GENERIC_IMPORT_SOURCES.has(normalizeListingSource(value)) : false;
}

export function resolveListingSource(input: {
  source?: string | null;
  url?: string | null;
  defaultSource?: string | null;
  provider?: string | null;
}) {
  const source = input.source ? normalizeListingSource(input.source) : null;

  if (source && !isGenericListingSource(source)) {
    return source;
  }

  const inferred = inferListingSourceFromUrl(input.url);

  if (inferred) {
    return inferred;
  }

  if (source) {
    return source;
  }

  if (input.defaultSource) {
    return normalizeListingSource(input.defaultSource);
  }

  return input.provider ? normalizeListingSource(input.provider) : "unknown";
}

export function getListingSourceStorageAliases(source: string) {
  const canonical = normalizeListingSource(source);
  return [
    ...new Set([
      source,
      canonical,
      ...(STORAGE_SOURCE_ALIASES[canonical] ?? []),
    ]),
  ];
}
