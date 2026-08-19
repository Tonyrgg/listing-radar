import { IconacasaAdapter } from "@/lib/property-lifecycle/adapters/iconacasa";
import { PuntoCasaAdapter } from "@/lib/property-lifecycle/adapters/puntocasa";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";

export function createPropertyLifecycleAdapter(
  adapterKey: string,
): PropertyLifecycleAdapter {
  switch (adapterKey) {
    case "iconacasa":
      return new IconacasaAdapter();
    case "puntocasa":
      return new PuntoCasaAdapter();
    default:
      throw new Error(`Unsupported Property Lifecycle adapter: ${adapterKey}`);
  }
}
