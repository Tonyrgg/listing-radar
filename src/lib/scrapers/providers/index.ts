import {
  ALL_WEB_PROVIDER_NAMES,
  normalizeProviderName,
  type ScraperProviderName,
} from "@/lib/scrapers/config";
import { admaioraProvider } from "@/lib/scrapers/providers/admaiora";
import { feedProvider } from "@/lib/scrapers/providers/feed";
import { futuraProvider } from "@/lib/scrapers/providers/futura";
import { iconacasaProvider } from "@/lib/scrapers/providers/iconacasa";
import { ingegneriColapintoProvider } from "@/lib/scrapers/providers/ingegnericolapinto";
import { importFileProvider } from "@/lib/scrapers/providers/import-file";
import { immobiliariRiuniteProvider } from "@/lib/scrapers/providers/immobiliaririunite";
import { mockProvider } from "@/lib/scrapers/providers/mock";
import { puntocasaProvider } from "@/lib/scrapers/providers/puntocasa";
import { studiSantiProvider } from "@/lib/scrapers/providers/studisanti";
import type { ListingsProvider } from "@/lib/scrapers/providers/types";
import { vistocasaProvider } from "@/lib/scrapers/providers/vistocasa";

const providers: Record<string, ListingsProvider> = {
  admaiora: admaioraProvider,
  feed: feedProvider,
  futura: futuraProvider,
  iconacasa: iconacasaProvider,
  ingegnericolapinto: ingegneriColapintoProvider,
  import: importFileProvider,
  immobiliaririunite: immobiliariRiuniteProvider,
  mock: mockProvider,
  puntocasa: puntocasaProvider,
  studisanti: studiSantiProvider,
  vistocasa: vistocasaProvider,
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
  iconacasaProvider,
  ingegneriColapintoProvider,
  importFileProvider,
  immobiliariRiuniteProvider,
  mockProvider,
  puntocasaProvider,
  providers,
  studiSantiProvider,
  vistocasaProvider,
};
