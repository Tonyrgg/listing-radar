import { mockProvider } from "@/lib/scrapers/providers/mock";
import type { ListingsProvider } from "@/lib/scrapers/providers/types";

const providers: Record<string, ListingsProvider> = {
  mock: mockProvider,
};

export function getProvider(name = "mock") {
  return providers[name] ?? providers.mock;
}

export { mockProvider, providers };
