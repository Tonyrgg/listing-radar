import { SCRAPER_CONFIG } from "@/lib/scrapers/config";
import { createAgestaProvider } from "@/lib/scrapers/providers/agesta";

export const futuraProvider = createAgestaProvider({
  name: "futura",
  source: "futura",
  agencyName: "Futura Immobiliare",
  baseUrl: SCRAPER_CONFIG.futura.baseUrl,
  searchUrl: SCRAPER_CONFIG.futura.searchUrl,
});
