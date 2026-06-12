import {
  normalizeProviderName,
  type ScraperProviderName,
} from "@/lib/scrapers/config";
import { mockProvider } from "@/lib/scrapers/providers/mock";
import { subitoProvider } from "@/lib/scrapers/providers/subito";
import type { ListingsProvider } from "@/lib/scrapers/providers/types";

const providers: Record<string, ListingsProvider> = {
  mock: mockProvider,
  subito: subitoProvider,
};

export function getProvider(name = "mock") {
  return providers[name] ?? providers.mock;
}

export function getProvidersForRun(name = process.env.SCRAPER_PROVIDER) {
  const providerName: ScraperProviderName = normalizeProviderName(name);

  if (providerName === "all") {
    return [providers.mock, providers.subito];
  }

  return [getProvider(providerName)];
}

export { mockProvider, providers, subitoProvider };
