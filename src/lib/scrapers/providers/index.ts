import {
  ALL_WEB_PROVIDER_NAMES,
  normalizeProviderName,
  type ScraperProviderName,
} from "@/lib/scrapers/config";
import { admaioraProvider } from "@/lib/scrapers/providers/admaiora";
import { feedProvider } from "@/lib/scrapers/providers/feed";
import { futuraProvider } from "@/lib/scrapers/providers/futura";
import { importFileProvider } from "@/lib/scrapers/providers/import-file";
import { immobiliariRiuniteProvider } from "@/lib/scrapers/providers/immobiliaririunite";
import { mockProvider } from "@/lib/scrapers/providers/mock";
import { subitoProvider } from "@/lib/scrapers/providers/subito";
import type { ListingsProvider } from "@/lib/scrapers/providers/types";

const providers: Record<string, ListingsProvider> = {
  admaiora: admaioraProvider,
  feed: feedProvider,
  futura: futuraProvider,
  import: importFileProvider,
  immobiliaririunite: immobiliariRiuniteProvider,
  mock: mockProvider,
  subito: subitoProvider,
};

export function getProvider(name = "mock") {
  return providers[name] ?? providers.mock;
}

export function getProvidersForRun(name = process.env.SCRAPER_PROVIDER) {
  const providerName: ScraperProviderName = normalizeProviderName(name);

  if (providerName === "all") {
    return ALL_WEB_PROVIDER_NAMES.map((provider) => providers[provider]);
  }

  return [getProvider(providerName)];
}

export {
  admaioraProvider,
  feedProvider,
  futuraProvider,
  importFileProvider,
  immobiliariRiuniteProvider,
  mockProvider,
  providers,
  subitoProvider,
};
