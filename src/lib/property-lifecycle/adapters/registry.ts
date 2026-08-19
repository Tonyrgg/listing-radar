import { IconacasaAdapter } from "@/lib/property-lifecycle/adapters/iconacasa";
import { PuntoCasaAdapter } from "@/lib/property-lifecycle/adapters/puntocasa";
import { StudiSantiAdapter } from "@/lib/property-lifecycle/adapters/studisanti";
import { VistocasaAdapter } from "@/lib/property-lifecycle/adapters/vistocasa";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";

export function createPropertyLifecycleAdapter(
  adapterKey: string,
): PropertyLifecycleAdapter {
  switch (adapterKey) {
    case "iconacasa":
      return new IconacasaAdapter();
    case "puntocasa":
      return new PuntoCasaAdapter();
    case "studisanti":
      return new StudiSantiAdapter();
    case "vistocasa":
      return new VistocasaAdapter();
    default:
      throw new Error(`Unsupported Property Lifecycle adapter: ${adapterKey}`);
  }
}
