import { SCRAPER_CONFIG } from "@/lib/scrapers/config";
import { createAgestaProvider } from "@/lib/scrapers/providers/agesta";

export const immobiliariRiuniteProvider = createAgestaProvider({
  name: "immobiliaririunite",
  source: "immobiliaririunite",
  agencyName: "Immobiliari Riunite",
  baseUrl: SCRAPER_CONFIG.immobiliaririunite.baseUrl,
  searchUrl: SCRAPER_CONFIG.immobiliaririunite.searchUrl,
});
