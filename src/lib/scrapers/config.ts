export type ScraperProviderName =
  | "mock"
  | "admaiora"
  | "futura"
  | "iconacasa"
  | "ingegnericolapinto"
  | "immobiliaririunite"
  | "puntocasa"
  | "studisanti"
  | "vistocasa"
  | "import"
  | "feed"
  | "all";

const MIN_DETAIL_DELAY_MS = 1500;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export const SCRAPER_CONFIG = {
  monitoredCity: "Bitonto",
  monitoredProvince: "Bari",
  monitoredRegion: "Puglia",
  category: "immobili",
  contractType: "vendita",
  sources: {
    mock: {
      enabledByDefault: true,
    },
    admaiora: {
      enabledByDefault: true,
    },
    futura: {
      enabledByDefault: true,
    },
    iconacasa: {
      enabledByDefault: true,
    },
    ingegnericolapinto: {
      enabledByDefault: true,
    },
    immobiliaririunite: {
      enabledByDefault: true,
    },
    puntocasa: {
      enabledByDefault: true,
    },
    studisanti: {
      enabledByDefault: true,
    },
    vistocasa: {
      enabledByDefault: true,
    },
    import: {
      enabledByDefault: false,
      defaultPath: "data/import/listings.json",
    },
    feed: {
      enabledByDefault: false,
    },
  },
  limits: {
    maxSearchPages: 1,
    maxDetailPages: 10,
    minDetailDelayMs: MIN_DETAIL_DELAY_MS,
  },
  admaiora: {
    baseUrl: "https://www.admaioraimmobiliare.it",
    searchUrl: "https://www.admaioraimmobiliare.it/property-status/vendita/",
  },
  futura: {
    baseUrl: "https://www.futurabitonto.it",
    searchUrl:
      "https://www.futurabitonto.it/web/immobili.asp?language=ita&pagref=88306&tipo_contratto=V",
  },
  iconacasa: {
    baseUrl: "https://www.iconacasa.com",
    searchUrl:
      "https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro",
  },
  ingegnericolapinto: {
    baseUrl: "https://www.ingegnericolapinto.it",
    searchUrl: "https://www.ingegnericolapinto.it/sitemap_blog.xml",
  },
  immobiliaririunite: {
    baseUrl: "https://www.immobiliaririunite.it",
    searchUrl:
      "https://www.immobiliaririunite.it/web/immobili.asp?cod_comune=719&cod_provincia=9&cod_regione=13&language=ita&link=1",
  },
  puntocasa: {
    baseUrl: "https://www.puntocasagroup.it",
    searchUrl: "https://www.puntocasagroup.it/acquista-la-tua-casa-2/",
  },
  studisanti: {
    baseUrl: "https://studisantiimmobiliare.it",
    searchUrl: "https://studisantiimmobiliare.it/sitemap.xml",
  },
  vistocasa: {
    baseUrl: "https://www.vistocasa.com/it/",
    searchUrl: "https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56",
  },
} as const;

export const ALL_WEB_PROVIDER_NAMES = [
  "admaiora",
  "futura",
  "iconacasa",
  "ingegnericolapinto",
  "immobiliaririunite",
  "puntocasa",
  "studisanti",
  "vistocasa",
] as const;

export function normalizeProviderName(
  value: string | undefined,
): ScraperProviderName {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "admaiora" ||
    normalized === "futura" ||
    normalized === "iconacasa" ||
    normalized === "ingegnericolapinto" ||
    normalized === "immobiliaririunite" ||
    normalized === "puntocasa" ||
    normalized === "studisanti" ||
    normalized === "vistocasa" ||
    normalized === "import" ||
    normalized === "feed" ||
    normalized === "all" ||
    normalized === "mock"
  ) {
    return normalized;
  }

  return "mock";
}

export function getScraperRuntimeConfig() {
  const maxSearchPages = Math.min(
    SCRAPER_CONFIG.limits.maxSearchPages,
    parsePositiveInteger(
      process.env.SCRAPER_MAX_SEARCH_PAGES,
      SCRAPER_CONFIG.limits.maxSearchPages,
    ),
  );
  const maxDetailPages = Math.min(
    SCRAPER_CONFIG.limits.maxDetailPages,
    parsePositiveInteger(
      process.env.SCRAPER_MAX_DETAIL_PAGES,
      SCRAPER_CONFIG.limits.maxDetailPages,
    ),
  );
  const detailDelayMs = Math.max(
    SCRAPER_CONFIG.limits.minDetailDelayMs,
    parsePositiveInteger(
      process.env.SCRAPER_DETAIL_DELAY_MS,
      SCRAPER_CONFIG.limits.minDetailDelayMs,
    ),
  );

  return {
    provider: normalizeProviderName(process.env.SCRAPER_PROVIDER),
    maxSearchPages,
    maxDetailPages,
    detailDelayMs,
  };
}
